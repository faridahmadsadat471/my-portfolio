import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { MongoClient } from 'mongodb';
import { createPortfolioApp } from '../server.js';

test('real MongoDB persists contact messages, projects, skills, and exact photo bytes', async () => {
  const databaseName = `portfolio_check_${randomUUID().replaceAll('-', '')}`;
  const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017';
  const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000 });
  const originalKey = process.env.DASHBOARD_KEY;
  process.env.DASHBOARD_KEY = randomUUID();
  const headers = { 'x-dashboard-key': process.env.DASHBOARD_KEY, 'Content-Type': 'application/json' };
  const sent = [];
  let app;
  let base;
  async function start() {
    app = await createPortfolioApp({ mongoUri: uri, mongoDatabase: databaseName, mailer: { async sendMail(message) { sent.push(message); } } });
    app.listen(0, '127.0.0.1');
    await once(app, 'listening');
    base = `http://127.0.0.1:${app.address().port}`;
  }
  async function stop() {
    if (!app) return;
    app.closeIdleConnections();
    await new Promise((resolve, reject) => app.close(error => error ? reject(error) : resolve()));
    app = null;
  }
  async function request(route, method = 'GET', body) {
    return fetch(base + route, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  }
  try {
    await client.connect();
    await client.db(databaseName).command({ ping: 1 });
    await start();
    const project = { title: 'Disposable integration project', description: 'Temporary database verification only.', technologies: ['Node.js', 'MongoDB'], github: '', live: '' };
    const created = await request('/api/admin/projects', 'POST', project);
    assert.equal(created.status, 201);
    const { id } = await created.json();
    assert.equal((await request(`/api/admin/projects/${id}`, 'PUT', { ...project, title: 'Updated integration project' })).status, 200);
    const skills = ['HTML', 'JavaScript', 'MongoDB'];
    assert.equal((await request('/api/admin/skills', 'PUT', { skills })).status, 200);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/rV8AAAAASUVORK5CYII=', 'base64');
    assert.equal((await request('/api/admin/profile-photo', 'POST', { contentType: 'image/png', data: png.toString('base64') })).status, 200);
    const contact = { name: 'Integration Test', email: 'test@example.com', subject: 'Disposable database check', message: 'This message exists only in the temporary test database.' };
    const saved = await request('/api/contact', 'POST', contact);
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).emailNotification, 'sent');
    assert.equal(sent.length, 1); // A stub mailer; no external message is sent.
    await stop();
    await start();
    const profile = await (await request('/api/profile')).json();
    assert.equal(profile.projects[0].title, 'Updated integration project');
    assert.deepEqual(profile.skills, skills);
    assert.equal(profile.photoUrl, '/api/profile/photo');
    const photo = await request(profile.photoUrl);
    assert.equal(photo.status, 200);
    assert.equal(Number(photo.headers.get('content-length')), png.length);
    assert.deepEqual(Buffer.from(await photo.arrayBuffer()), png);
    assert.equal((await (await request('/api/admin/messages')).json())[0].subject, contact.subject);
    assert.deepEqual(await (await request('/api/admin/stats')).json(), { total: 1, projectCount: 1 });
    assert.equal((await request(`/api/admin/projects/${id}`, 'DELETE')).status, 200);
    assert.deepEqual(await (await request('/api/projects')).json(), []);
    assert.equal((await request('/api/admin/profile-photo', 'DELETE')).status, 200);
    assert.equal((await request('/api/profile/photo')).status, 404);
  } finally {
    await stop();
    // The generated name cannot be the configured portfolio database.
    if (client.topology?.isConnected()) await client.db(databaseName).dropDatabase();
    await client.close();
    if (originalKey === undefined) delete process.env.DASHBOARD_KEY;
    else process.env.DASHBOARD_KEY = originalKey;
  }
});
