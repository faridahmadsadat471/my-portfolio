import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createPortfolioApp } from '../server.js';

const validMessage = { name: 'Test Visitor', email: 'visitor@example.com', subject: 'A web development project', message: 'I would like to discuss building a small business website.' };

function createMessageStore() {
  const rows = [];
  return {
    async insertOne(row) { rows.push(row); },
    async countDocuments() { return rows.length; },
    find() {
      return {
        sort() { return this; },
        limit(limit) {
          const chain = this;
          return { async toArray() { return [...rows].sort((a, b) => b.createdAt - a.createdAt).slice(0, limit); } };
        }
      };
    }
  };
}

function createProjectStore() {
  const rows = [];
  return {
    async insertOne(row) { rows.push(row); },
    async countDocuments() { return rows.length; },
    async updateOne(filter, update) {
      const row = rows.find(item => item._id === filter._id);
      if (!row) return { matchedCount: 0 };
      Object.assign(row, update.$set);
      return { matchedCount: 1 };
    },
    async deleteOne(filter) {
      const index = rows.findIndex(item => item._id === filter._id);
      if (index < 0) return { deletedCount: 0 };
      rows.splice(index, 1);
      return { deletedCount: 1 };
    },
    find() {
      return {
        sort() { return this; },
        async toArray() { return [...rows]; }
      };
    }
  };
}

function createSettingsStore() {
  const rows = new Map();
  return {
    async findOne(filter) { return rows.get(filter._id) || null; },
    async updateOne(filter, update) { rows.set(filter._id, { _id: filter._id, ...update.$set }); },
    async deleteOne(filter) { rows.delete(filter._id); }
  };
}

async function start(options = {}) {
  const server = await createPortfolioApp({ messagesCollection: createMessageStore(), projectsCollection: createProjectStore(), settingsCollection: createSettingsStore(), rateLimit: 100, ...options });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}
async function stop(server) { server.closeIdleConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
function submit(url, data, headers = {}) { return fetch(`${url}/api/contact`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: typeof data === 'string' ? data : JSON.stringify(data) }); }

test('serves the personalized frontend and public APIs without exposing private files', async () => {
  const { server, url } = await start();
  try {
    const html = await (await fetch(url)).text();
    assert.match(html, /Farid Ahmad Sadat/); assert.match(html, /Bost University/);
    for (const route of ['/assets/styles.css', '/assets/main.js', '/assets/favicon.svg', '/assets/profile.json']) assert.equal((await fetch(url + route)).status, 200);
    assert.equal((await fetch(url + '/dashboard')).status, 200);
    const profile = await (await fetch(url + '/api/profile')).json();
    assert.equal(profile.semester, 7); assert.equal(profile.email, 'faridahmadsadat471@gmail.com');
    assert.deepEqual(await (await fetch(url + '/api/projects')).json(), []);
    assert.equal((await fetch(url + '/api/messages')).status, 404);
    assert.equal((await fetch(url + '/api/contact')).status, 405);
  } finally { await stop(server); }
});

test('valid contact messages are inserted and survive a server restart', async () => {
  const store = createMessageStore();
  let app = await start({ messagesCollection: store });
  try {
    const response = await submit(app.url, validMessage); assert.equal(response.status, 201);
    const saved = await response.json(); assert.ok(saved.id); assert.equal(saved.emailNotification, 'not_configured');
    await stop(app.server);
    app = await start({ messagesCollection: store });
    assert.equal((await fetch(app.url + '/api/health')).status, 200);
    assert.equal(await store.countDocuments(), 1);
  } finally { await stop(app.server); }
});

test('sends an owner notification through the configured mailer and reports delivery failures', async () => {
  const sent = [];
  const mailer = {
    async sendMail(message) { sent.push(message); }
  };
  const app = await start({ mailer, contactEmail: 'owner@example.com', smtpFrom: 'portfolio@example.com' });
  try {
    const response = await submit(app.url, validMessage);
    assert.equal(response.status, 201);
    assert.equal((await response.json()).emailNotification, 'sent');
    assert.equal(sent.length, 1);
    assert.equal(sent[0].to, 'owner@example.com');
    assert.equal(sent[0].from, 'portfolio@example.com');
    assert.equal(sent[0].replyTo, validMessage.email);
    assert.match(sent[0].text, /Test Visitor/);
  } finally { await stop(app.server); }

  const failingApp = await start({
    mailer: { async sendMail() { throw new Error('SMTP service unavailable'); } },
    contactEmail: 'owner@example.com'
  });
  try {
    const response = await submit(failingApp.url, validMessage);
    assert.equal(response.status, 201);
    const data = await response.json();
    assert.equal(data.emailNotification, 'failed');
    assert.ok(data.id);
  } finally { await stop(failingApp.server); }
});

test('rejects invalid, oversized, and cross-origin submissions; ignores honeypot spam', async () => {
  const { server, url } = await start();
  try {
    for (const data of [{ ...validMessage, email: 'invalid' }, { ...validMessage, message: 'short' }, { ...validMessage, name: ' ' }, { ...validMessage, subject: '' }, [], null]) assert.equal((await submit(url, data)).status, 400);
    assert.equal((await submit(url, '{broken')).status, 400);
    assert.equal((await submit(url, validMessage, { Origin: 'https://another-site.example' })).status, 403);
    assert.equal((await submit(url, validMessage, { 'Content-Type': 'text/plain' })).status, 415);
    assert.equal((await submit(url, { ...validMessage, message: 'x'.repeat(40000) })).status, 413);
    assert.equal((await submit(url, { ...validMessage, companyWebsite: 'spam.example' })).status, 200);
  } finally { await stop(server); }
});

test('throttles repeated contact attempts and protects dashboard API', async () => {
  const { server, url } = await start({ rateLimit: 2 });
  try {
    assert.equal((await submit(url, validMessage)).status, 201);
    assert.equal((await submit(url, validMessage)).status, 201);
    const response = await submit(url, validMessage);
    assert.equal(response.status, 429); assert.ok(Number(response.headers.get('retry-after')) > 0);
  } finally { await stop(server); }
  process.env.DASHBOARD_KEY = 'test-dashboard-key';
  const app = await start();
  try {
    assert.equal((await fetch(app.url + '/api/admin/stats')).status, 401);
    assert.equal((await fetch(app.url + '/api/admin/stats', { headers: { 'x-dashboard-key': 'test-dashboard-key' } })).status, 200);
  } finally { await stop(app.server); delete process.env.DASHBOARD_KEY; }
});

test('creates, edits, deletes, and publishes portfolio projects through protected dashboard APIs', async () => {
  process.env.DASHBOARD_KEY = 'test-dashboard-key';
  const projectStore = createProjectStore();
  const app = await start({ projectsCollection: projectStore });
  const headers = { 'x-dashboard-key': 'test-dashboard-key', 'Content-Type': 'application/json' };
  try {
    const project = { title: 'Portfolio site', description: 'A personal site showcasing projects and learning.', technologies: ['Node.js', 'MongoDB'], github: 'https://github.com/example/site', live: '' };
    const createdResponse = await fetch(app.url + '/api/admin/projects', { method: 'POST', headers, body: JSON.stringify(project) });
    assert.equal(createdResponse.status, 201);
    const created = await createdResponse.json();
    assert.ok(created.id);
    assert.equal((await (await fetch(app.url + '/api/projects')).json())[0].title, project.title);
    const changed = { ...project, title: 'Updated portfolio' };
    assert.equal((await fetch(app.url + `/api/admin/projects/${created.id}`, { method: 'PUT', headers, body: JSON.stringify(changed) })).status, 200);
    assert.equal((await (await fetch(app.url + '/api/projects')).json())[0].title, changed.title);
    assert.equal((await fetch(app.url + `/api/admin/projects/${created.id}`, { method: 'DELETE', headers })).status, 200);
    assert.deepEqual(await (await fetch(app.url + '/api/projects')).json(), []);
    assert.equal((await fetch(app.url + '/api/admin/projects', { method: 'POST', headers, body: JSON.stringify({ ...project, github: 'javascript:alert(1)' }) })).status, 400);
    for (const technologies of ['Node.js', [null], Array.from({ length: 13 }, () => 'JavaScript')]) {
      assert.equal((await fetch(app.url + '/api/admin/projects', { method: 'POST', headers, body: JSON.stringify({ ...project, technologies }) })).status, 400);
    }
    assert.equal((await fetch(app.url + '/api/admin/messages?limit=invalid', { headers })).status, 400);
    assert.equal((await fetch(app.url + '/api/admin/messages?limit=1.5', { headers })).status, 400);
  } finally { await stop(app.server); delete process.env.DASHBOARD_KEY; }
});

test('uploads profile photos securely and serves them on the public portfolio', async () => {
  process.env.DASHBOARD_KEY = 'test-dashboard-key';
  const settingsStore = createSettingsStore();
  const app = await start({ settingsCollection: settingsStore });
  const headers = { 'x-dashboard-key': 'test-dashboard-key', 'Content-Type': 'application/json' };
  try {
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rV8AAAAASUVORK5CYII=';
    const response = await fetch(app.url + '/api/admin/profile-photo', { method: 'POST', headers, body: JSON.stringify({ contentType: 'image/png', data: png }) });
    assert.equal(response.status, 200);
    const profile = await (await fetch(app.url + '/api/profile')).json();
    assert.equal(profile.photoUrl, '/api/profile/photo');
    const photo = await fetch(app.url + profile.photoUrl);
    assert.equal(photo.status, 200);
    assert.equal(photo.headers.get('content-type'), 'image/png');
    assert.equal((await fetch(app.url + '/api/admin/profile-photo', { method: 'POST', headers, body: JSON.stringify({ contentType: 'image/svg+xml', data: 'PHN2Zz4=' }) })).status, 400);
    assert.equal((await fetch(app.url + '/api/admin/profile-photo', { method: 'DELETE', headers })).status, 200);
    assert.equal((await fetch(app.url + '/api/profile/photo')).status, 404);
  } finally { await stop(app.server); delete process.env.DASHBOARD_KEY; }
});

test('updates protected profile skills and publishes them on the public profile', async () => {
  process.env.DASHBOARD_KEY = 'test-dashboard-key';
  const app = await start();
  const headers = { 'x-dashboard-key': 'test-dashboard-key', 'Content-Type': 'application/json' };
  try {
    const initial = await (await fetch(app.url + '/api/profile')).json();
    assert.ok(initial.skills.includes('JavaScript'));
    const skills = [...initial.skills, 'TypeScript'];
    const update = await fetch(app.url + '/api/admin/skills', { method: 'PUT', headers, body: JSON.stringify({ skills }) });
    assert.equal(update.status, 200);
    assert.deepEqual(await update.json(), skills);
    assert.deepEqual((await (await fetch(app.url + '/api/admin/skills', { headers })).json()), skills);
    assert.deepEqual((await (await fetch(app.url + '/api/profile')).json()).skills, skills);
    assert.equal((await fetch(app.url + '/api/admin/skills', { method: 'PUT', headers, body: JSON.stringify({ skills: Array.from({ length: 41 }, (_, index) => `Skill ${index}`) }) })).status, 400);
    assert.equal((await fetch(app.url + '/api/admin/skills', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ skills }) })).status, 401);
  } finally { await stop(app.server); delete process.env.DASHBOARD_KEY; }
});
