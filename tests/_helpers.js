'use strict';
// Shared test helpers. Sets a temp data file so tests never write ./data in the repo, points the content loaders at
// small fixtures, and removes every variable that could make a test touch the network or a real database.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const FIXTURES = path.join(__dirname, 'fixtures');
const PASSWORD = 'correct horse battery staple';

function setupEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfi-test-'));
  Object.assign(process.env, {
    ENQUIRY_DATA_FILE: path.join(dir, 'enquiries.json'),
    IP_SALT: 'test-salt',
    TRUST_PROXY: '1', // tests seed X-Forwarded-For; individual tests override to exercise the untrusted path
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
  }, extra);
  for (const k of ['DATABASE_URL', 'BLOB_READ_WRITE_TOKEN', 'BOOTSTRAP_ADMIN_EMAIL', 'BOOTSTRAP_ADMIN_PASSWORD', 'SMTP_HOST', 'ENQUIRY_TO', 'VERCEL', 'NODE_ENV']) {
    if (!(k in extra)) delete process.env[k];
  }
  require('../lib/content/defaults').setPaths({ content: path.join(FIXTURES, 'content.json'), schema: path.join(FIXTURES, 'schema.json') });
  require('../api/admin/[action]').settings.failDelayMs = 0; // keep failed-login tests fast (the delay itself has its own test)
  return dir;
}

function validBody(over = {}) {
  return {
    type: 'OEM manufacturing', name: 'Asha Rao', company: 'Sleepwell Retail', email: 'asha@example.com',
    country: 'India', volume: 'Exploring options', msg: 'We would like a quote.', page: '/contact',
    website: '', t: 5000, ...over,
  };
}

let ipCounter = 0;
const freshIp = () => `10.0.${Math.floor(++ipCounter / 250)}.${(ipCounter % 250) + 1}`;

/** Boot the Express app on an ephemeral port. */
async function boot() {
  const { createApp } = require('../server');
  const server = createApp().listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, close: () => new Promise((r) => { server.closeAllConnections && server.closeAllConnections(); server.close(r); }) };
}

async function postJson(base, p, body, headers = {}) {
  return fetch(base + p, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp(), ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

/** Minimal req/res doubles for calling handlers directly (Vercel style). */
function mockReq({ method = 'POST', headers = {}, body, query, url = '/' } = {}) {
  const req = new EventEmitter();
  Object.assign(req, { method, headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])), url, socket: { remoteAddress: '127.0.0.1' } });
  if (body !== undefined) req.body = body;
  if (query) req.query = query;
  return req;
}
function mockRes() {
  const res = { headers: {}, statusCode: 200, body: '', headersSent: false };
  res.setHeader = (k, v) => { res.headers[k.toLowerCase()] = v; };
  res.getHeader = (k) => res.headers[k.toLowerCase()];
  res.end = (b) => { res.body = b === undefined ? '' : String(b); res.headersSent = true; res.done = true; };
  res.json = () => res.body && JSON.parse(res.body);
  return res;
}

// ---------------------------------------------------------------- CMS helpers
const CSRF = { 'x-requested-with': 'vfi-admin' };
const ROLE_LIST = ['admin', 'editor', 'sales'];

/** Create a user directly in the store (bypasses the API). */
async function makeUser(store, { email, role = 'editor', name = '', password = PASSWORD, must_change_password = false } = {}) {
  const { hashPassword } = require('../lib/auth/password');
  return store.createUser({ email: email || `${role}-${Math.random().toString(36).slice(2, 8)}@example.com`, name: name || role, role, password_hash: await hashPassword(password), must_change_password });
}

/** HTTP client against a booted server; keeps a cookie per instance. */
function client(base) {
  const c = { cookie: '' };
  c.req = async (method, p, { body, headers = {}, raw, csrf = true } = {}) => {
    const h = { ...(csrf && method !== 'GET' ? CSRF : {}), 'x-forwarded-for': freshIp(), ...(c.cookie ? { cookie: c.cookie } : {}), ...headers };
    let payload;
    if (raw !== undefined) payload = raw;
    else if (body !== undefined) { h['content-type'] = h['content-type'] || 'application/json'; payload = typeof body === 'string' ? body : JSON.stringify(body); }
    const r = await fetch(base + p, { method, headers: h, body: payload });
    const sc = r.headers.get('set-cookie');
    if (sc) c.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    return r;
  };
  c.get = (p, o) => c.req('GET', p, o);
  c.post = (p, body, o) => c.req('POST', p, { body, ...o });
  c.put = (p, body, o) => c.req('PUT', p, { body, ...o });
  c.patch = (p, body, o) => c.req('PATCH', p, { body, ...o });
  c.del = (p, o) => c.req('DELETE', p, o);
  c.login = async (email, password = PASSWORD) => c.post('/api/admin/login', { email, password });
  return c;
}

// Tiny valid images (real magic bytes, real dimensions).
const PNG_1x1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
function jpegOf(w, h) {
  // SOI, APP0, SOF0 with the given size, EOI: enough for magic-byte and dimension parsing.
  const sof = Buffer.from([0xff, 0xc0, 0x00, 0x0b, 0x08, h >> 8, h & 255, w >> 8, w & 255, 0x01, 0x01, 0x11, 0x00]);
  return Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]), sof, Buffer.from([0xff, 0xd9])]);
}
function webpOf(w, h) {
  const b = Buffer.alloc(30);
  b.write('RIFF', 0, 'latin1'); b.writeUInt32LE(22, 4); b.write('WEBP', 8, 'latin1'); b.write('VP8X', 12, 'latin1'); b.writeUInt32LE(10, 16);
  b.writeUIntLE(w - 1, 24, 3); b.writeUIntLE(h - 1, 27, 3);
  return b;
}

/** Fake Blob uploader that records calls. */
function fakeUploader() {
  const calls = { put: [], del: [] };
  return {
    calls, failDel: false, failPut: false,
    async put(pathname, body, contentType) {
      if (this.failPut) throw new Error('boom');
      calls.put.push({ pathname, size: body.length, contentType });
      return { url: `https://fake123.public.blob.vercel-storage.com/${pathname}`, pathname };
    },
    async del(url) { if (this.failDel) throw new Error('boom'); calls.del.push(url); },
  };
}

module.exports = { setupEnv, validBody, freshIp, boot, postJson, mockReq, mockRes, makeUser, client, CSRF, PASSWORD, ROLE_LIST, PNG_1x1, jpegOf, webpOf, fakeUploader, FIXTURES };
