import http from 'node:http';
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createSmtpMailer } from './mail.js';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const profileFile = path.join(projectRoot, 'frontend', 'assets', 'profile.json');
const mimeTypes = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp' };

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
function json(response, status, payload, extraHeaders = {}) {
  const body = JSON.stringify(payload);
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extraHeaders });
  response.end(body);
}
function readJson(request, maxBytes = 32768) {
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0; let tooLarge = false;
    request.on('data', chunk => {
      length += chunk.length;
      if (length > maxBytes) { tooLarge = true; chunks.length = 0; reject(new HttpError(413, 'Your message is too large. Please shorten it.')); }
      else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new HttpError(400, 'Please submit a valid JSON message.')); }
    });
    request.on('error', reject);
    request.on('aborted', () => reject(new HttpError(400, 'The request was interrupted.')));
  });
}
function validateContact(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Please complete all message fields.');
  const contact = {};
  for (const key of ['name', 'email', 'subject', 'message']) {
    if (typeof data[key] !== 'string') throw new HttpError(400, 'Please complete all message fields.');
    contact[key] = data[key].trim();
  }
  if (contact.name.length < 2 || contact.name.length > 100) throw new HttpError(400, 'Your name must contain between 2 and 100 characters.');
  if (contact.email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) throw new HttpError(400, 'Please enter a valid email address.');
  if (!contact.subject || contact.subject.length > 160) throw new HttpError(400, 'Please add a subject of up to 160 characters.');
  if (contact.message.length < 10 || contact.message.length > 5000) throw new HttpError(400, 'Your message must contain between 10 and 5,000 characters.');
  if ([contact.name, contact.email, contact.subject].some(value => /[\r\n\x00]/.test(value)) || contact.message.includes('\x00')) throw new HttpError(400, 'Please remove invalid characters from the message.');
  return contact;
}
function validateProject(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new HttpError(400, 'Enter the project details.');
  const title = typeof data.title === 'string' ? data.title.trim() : '';
  const description = typeof data.description === 'string' ? data.description.trim() : '';
  if (data.technologies !== undefined && (!Array.isArray(data.technologies) || data.technologies.length > 12 || data.technologies.some(item => typeof item !== 'string'))) {
    throw new HttpError(400, 'Add up to 12 technologies as text.');
  }
  const technologies = (data.technologies || []).map(item => item.trim()).filter(Boolean);
  if (title.length < 2 || title.length > 100) throw new HttpError(400, 'Project title must be 2–100 characters.');
  if (description.length < 10 || description.length > 2000) throw new HttpError(400, 'Project description must be 10–2,000 characters.');
  if (technologies.some(item => item.length > 40)) throw new HttpError(400, 'Each technology must be 40 characters or fewer.');
  const project = { title, description, technologies };
  for (const field of ['github', 'live']) {
    const value = typeof data[field] === 'string' ? data[field].trim() : '';
    if (!value) { project[field] = ''; continue; }
    let parsed;
    try { parsed = new URL(value); } catch { throw new HttpError(400, `Enter a valid ${field} URL.`); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new HttpError(400, `Enter a valid ${field} URL.`);
    project[field] = parsed.href;
  }
  return project;
}
function isValidImage(buffer, type) {
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  if (type === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  return false;
}

export async function createPortfolioApp(options = {}) {
  const frontendRoot = options.frontendRoot || path.join(projectRoot, 'frontend', process.argv.includes('--dist') ? 'dist' : '');
  let mongoClient = null;
  let database = null;
  let messages = options.messagesCollection || null;
  if (!messages) {
    mongoClient = new MongoClient(options.mongoUri || process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017', { serverSelectionTimeoutMS: 5000 });
    await mongoClient.connect();
    database = mongoClient.db(options.mongoDatabase || process.env.MONGODB_DB || 'portfolio');
    messages = database.collection(process.env.MONGODB_MESSAGES_COLLECTION || 'messages');
  }
  const projects = options.projectsCollection || database?.collection('projects') || {
    async find() { return { sort() { return this; }, async toArray() { return []; } }; },
    async insertOne() { throw new Error('Project storage is not configured.'); },
    async updateOne() { return { matchedCount: 0 }; },
    async deleteOne() { return { deletedCount: 0 }; },
    async countDocuments() { return 0; }
  };
  const settings = options.settingsCollection || database?.collection('settings') || null;
  const smtpHost = options.smtpHost || process.env.SMTP_HOST;
  const smtpPort = Number(options.smtpPort || process.env.SMTP_PORT || 587);
  const smtpUser = options.smtpUser || process.env.SMTP_USER;
  const smtpPass = options.smtpPass || process.env.SMTP_PASS;
  let mailer = options.mailer || null;
  if (!mailer && smtpHost) {
    if (!Number.isInteger(smtpPort) || smtpPort < 1 || smtpPort > 65535) throw new Error('SMTP_PORT must be a valid port number.');
    if (Boolean(smtpUser) !== Boolean(smtpPass)) throw new Error('Set both SMTP_USER and SMTP_PASS, or leave both empty.');
    mailer = createSmtpMailer({
      host: smtpHost,
      port: smtpPort,
      secure: options.smtpSecure ?? (process.env.SMTP_SECURE === 'true' || smtpPort === 465),
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
      ...(smtpUser ? { auth: { user: smtpUser, pass: smtpPass } } : {})
    });
  }
  const smtpFrom = options.smtpFrom || process.env.SMTP_FROM || smtpUser;
  const contactEmail = options.contactEmail || process.env.CONTACT_EMAIL_TO ||
    JSON.parse(await readFile(options.profileFile || profileFile, 'utf8')).email;
  const rateLimit = options.rateLimit ?? 5;
  const windowMs = options.windowMs ?? 10 * 60 * 1000;
  const clients = new Map();
  const cleanup = setInterval(() => { const now = Date.now(); for (const [key, bucket] of clients) if (bucket.resetAt <= now) clients.delete(key); }, 60000);
  cleanup.unref();

  const server = http.createServer(async (request, response) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    response.setHeader('X-Frame-Options', 'DENY');
    response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
    try {
      const url = new URL(request.url, 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      if (pathname === '/api/health' && request.method === 'GET') { json(response, 200, { status: 'ok' }); return; }
      if (pathname === '/api/profile/photo' && request.method === 'GET') {
        const photo = await settings?.findOne({ _id: 'profile-photo' }, { promoteBuffers: true });
        if (!photo) { response.writeHead(404, { 'Cache-Control': 'no-store' }).end(); return; }
        response.writeHead(200, { 'Content-Type': photo.contentType, 'Content-Length': photo.data.length, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        response.end(photo.data); return;
      }
      if (['/api/profile', '/api/projects'].includes(pathname) && request.method === 'GET') {
        const profile = JSON.parse(await readFile(options.profileFile || profileFile, 'utf8'));
        const projectRows = await projects.find({}, { projection: { _id: 1, title: 1, description: 1, technologies: 1, github: 1, live: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray();
        profile.projects = projectRows.length ? projectRows.map(({ _id, ...project }) => ({ id: _id, ...project })) : profile.projects || [];
        const skillSettings = await settings?.findOne({ _id: 'portfolio-skills' });
        if (skillSettings) profile.skills = skillSettings.skills;
        if (pathname === '/api/projects') json(response, 200, profile.projects);
        else {
          const photo = await settings?.findOne({ _id: 'profile-photo' }, { projection: { _id: 1 } });
          profile.photoUrl = photo ? '/api/profile/photo' : '';
          json(response, 200, profile);
        }
        return;
      }
      if (pathname === '/api/contact') {
        if (request.method !== 'POST') { json(response, 405, { error: 'Use POST to send a message.' }, { Allow: 'POST' }); return; }
        const origin = request.headers.origin;
        const allowedOrigin = options.publicOrigin || process.env.PUBLIC_ORIGIN || `http://${request.headers.host}`;
        if (origin && origin !== allowedOrigin) throw new HttpError(403, 'This request is not allowed from this website.');
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '')) throw new HttpError(415, 'Please submit your message as JSON.');
        const client = request.socket.remoteAddress || 'unknown';
        const now = Date.now();
        let bucket = clients.get(client);
        if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + windowMs }; clients.set(client, bucket); }
        if (bucket.count >= rateLimit) {
          json(response, 429, { error: 'You’ve sent several messages. Please wait a few minutes before trying again.' }, { 'Retry-After': String(Math.ceil((bucket.resetAt - now) / 1000)) }); return;
        }
        bucket.count++;
        const data = await readJson(request);
        if (typeof data?.companyWebsite === 'string' && data.companyWebsite.trim()) { json(response, 200, { message: 'Your message has been received.' }); return; }
        const contact = validateContact(data);
        const id = randomUUID();
        await messages.insertOne({ _id: id, ...contact, createdAt: new Date() });
        let emailNotification = 'not_configured';
        if (mailer) {
          try {
            await mailer.sendMail({
              from: smtpFrom || contactEmail,
              to: contactEmail,
              replyTo: contact.email,
              subject: `Portfolio contact: ${contact.subject}`,
              text: `Name: ${contact.name}\nEmail: ${contact.email}\nSubject: ${contact.subject}\n\n${contact.message}`
            });
            emailNotification = 'sent';
          } catch (error) {
            emailNotification = 'failed';
            console.error('Contact email delivery failed:', error.message);
          }
        }
        json(response, 201, { id, message: 'Your message has been received.', emailNotification }); return;
      }
      if (pathname.startsWith('/api/admin/')) {
        const dashboardKey = process.env.DASHBOARD_KEY;
        if (!dashboardKey) { json(response, 503, { error: 'Dashboard access is not configured.' }); return; }
        if (request.headers['x-dashboard-key'] !== dashboardKey) { json(response, 401, { error: 'A valid dashboard key is required.' }); return; }
        if (pathname === '/api/admin/projects' && request.method === 'GET') {
          const rows = await projects.find({}, { projection: { _id: 1, title: 1, description: 1, technologies: 1, github: 1, live: 1, createdAt: 1 } }).sort({ createdAt: 1 }).toArray();
          json(response, 200, rows.map(({ _id, ...project }) => ({ id: _id, ...project }))); return;
        }
        if (pathname === '/api/admin/projects' && request.method === 'POST') {
          const project = validateProject(await readJson(request));
          const id = randomUUID();
          await projects.insertOne({ _id: id, ...project, createdAt: new Date() });
          json(response, 201, { id, ...project }); return;
        }
        if (pathname === '/api/admin/skills' && request.method === 'GET') {
          const profile = JSON.parse(await readFile(options.profileFile || profileFile, 'utf8'));
          const skillSettings = await settings?.findOne({ _id: 'portfolio-skills' });
          json(response, 200, skillSettings?.skills || profile.skills || []); return;
        }
        if (pathname === '/api/admin/skills' && request.method === 'PUT') {
          if (!settings) throw new HttpError(503, 'Skill storage is not configured.');
          const data = await readJson(request);
          if (!Array.isArray(data?.skills) || data.skills.length > 40 || data.skills.some(skill => typeof skill !== 'string' || !skill.trim() || skill.trim().length > 40)) {
            throw new HttpError(400, 'Add up to 40 skills, each 1–40 characters long.');
          }
          const skills = [...new Set(data.skills.map(skill => skill.trim()))];
          await settings.updateOne({ _id: 'portfolio-skills' }, { $set: { skills, updatedAt: new Date() } }, { upsert: true });
          json(response, 200, skills); return;
        }
        const projectRoute = pathname.match(/^\/api\/admin\/projects\/([a-f\d-]+)$/i);
        if (projectRoute && request.method === 'PUT') {
          const project = validateProject(await readJson(request));
          const result = await projects.updateOne({ _id: projectRoute[1] }, { $set: project });
          if (!result.matchedCount) { json(response, 404, { error: 'Project not found.' }); return; }
          json(response, 200, { id: projectRoute[1], ...project }); return;
        }
        if (projectRoute && request.method === 'DELETE') {
          const result = await projects.deleteOne({ _id: projectRoute[1] });
          if (!result.deletedCount) { json(response, 404, { error: 'Project not found.' }); return; }
          json(response, 200, { message: 'Project deleted.' }); return;
        }
        if (pathname === '/api/admin/profile-photo' && request.method === 'GET') {
          const photo = await settings?.findOne({ _id: 'profile-photo' }, { projection: { _id: 1, contentType: 1, updatedAt: 1 } });
          json(response, 200, { photoUrl: photo ? '/api/profile/photo' : '', updatedAt: photo?.updatedAt || null }); return;
        }
        if (pathname === '/api/admin/profile-photo' && request.method === 'POST') {
          if (!settings) throw new HttpError(503, 'Profile photo storage is not configured.');
          const data = await readJson(request, 3 * 1024 * 1024);
          const types = { 'image/png': 'image/png', 'image/jpeg': 'image/jpeg', 'image/webp': 'image/webp' };
          const contentType = types[data?.contentType];
          if (!contentType || typeof data.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(data.data)) throw new HttpError(400, 'Upload a PNG, JPEG, or WebP image.');
          const image = Buffer.from(data.data, 'base64');
          if (!image.length || image.length > 2 * 1024 * 1024 || !isValidImage(image, contentType)) throw new HttpError(400, 'Image is invalid or exceeds the 2 MB limit.');
          await settings.updateOne({ _id: 'profile-photo' }, { $set: { contentType, data: image, updatedAt: new Date() } }, { upsert: true });
          json(response, 200, { photoUrl: '/api/profile/photo' }); return;
        }
        if (pathname === '/api/admin/profile-photo' && request.method === 'DELETE') {
          if (!settings) throw new HttpError(503, 'Profile photo storage is not configured.');
          await settings.deleteOne({ _id: 'profile-photo' });
          json(response, 200, { message: 'Profile photo removed.' }); return;
        }
        if (pathname === '/api/admin/messages' && request.method === 'GET') {
          const requestedLimit = Number(url.searchParams.get('limit') ?? 50);
          if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new HttpError(400, 'Message limit must be a positive integer.');
          const limit = Math.min(100, requestedLimit);
          const rows = await messages.find({}, { projection: { _id: 1, name: 1, email: 1, subject: 1, message: 1, createdAt: 1 } }).sort({ createdAt: -1 }).limit(limit).toArray();
          json(response, 200, rows.map(row => ({ id: row._id, name: row.name, email: row.email, subject: row.subject, message: row.message, createdAt: row.createdAt }))); return;
        }
        if (pathname === '/api/admin/stats') {
          if (request.method !== 'GET') { json(response, 405, { error: 'Use GET for dashboard stats.' }, { Allow: 'GET' }); return; }
          const total = await messages.countDocuments({});
          const projectCount = await projects.countDocuments({});
          json(response, 200, { total, projectCount }); return;
        }
        json(response, 404, { error: 'This endpoint was not found.' }); return;
      }
      if (pathname.startsWith('/api/')) { json(response, 404, { error: 'This endpoint was not found.' }); return; }
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
      if (!['/', '/index.html', '/dashboard', '/dashboard.html'].includes(pathname) && !pathname.startsWith('/assets/')) { response.writeHead(404).end('Not found'); return; }
      if (pathname.includes('\\') || pathname.includes('\0')) { response.writeHead(403).end('Forbidden'); return; }
      const requestedFile = pathname === '/' ? '/index.html' : pathname === '/dashboard' ? '/dashboard.html' : pathname;
      const compiledStyles = path.join(projectRoot, 'frontend', 'dist', 'assets', 'styles.css');
      const useCompiledStyles = pathname === '/assets/styles.css' && path.resolve(frontendRoot) === path.resolve(projectRoot, 'frontend');
      const target = useCompiledStyles ? compiledStyles : path.resolve(frontendRoot, `.${requestedFile}`);
      const allowedRoot = useCompiledStyles ? path.join(projectRoot, 'frontend', 'dist', 'assets') : pathname.startsWith('/assets/') ? path.join(frontendRoot, 'assets') : frontendRoot;
      const relative = path.relative(allowedRoot, target);
      if (relative.startsWith('..') || path.isAbsolute(relative)) { response.writeHead(403).end('Forbidden'); return; }
      const file = await stat(target);
      if (!file.isFile()) { response.writeHead(404).end('Not found'); return; }
      response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(target)] || 'application/octet-stream', 'Content-Length': file.size, 'Cache-Control': 'no-cache' });
      if (request.method === 'HEAD') response.end();
      else createReadStream(target).on('error', () => response.destroy()).pipe(response);
    } catch (error) {
      if (response.headersSent || response.destroyed) return;
      const status = error.status || (error.code === 'ENOENT' ? 404 : error instanceof URIError ? 400 : 500);
      if (status === 500) console.error('Portfolio request failed:', error.message);
      json(response, status, { error: status === 500 ? 'Something went wrong. Please try again or contact me by email.' : status === 404 ? 'Not found' : status === 400 && error instanceof URIError ? 'Invalid URL' : error.message });
    }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 15000;
  server.on('close', () => { clearInterval(cleanup); if (mongoClient) mongoClient.close().catch(() => {}); });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 5173);
  createPortfolioApp().then(app => {
    app.listen(port, host, () => {
      console.log(`Farid's portfolio: http://${host}:${port}`);
      console.log('Frontend + API ready. Contact messages are saved to MongoDB.');
      console.log(process.env.SMTP_HOST ? 'Contact email notifications are enabled.' : 'Contact email notifications are disabled; configure SMTP_HOST to enable them.');
    });
    app.on('error', error => { console.error(error.message); app.close(); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { app.close(() => process.exit(0)); app.closeIdleConnections(); });
  }).catch(error => { console.error('Unable to connect to MongoDB:', error.message); process.exitCode = 1; });
}
