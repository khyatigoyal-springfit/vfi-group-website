'use strict';
// Shared test helpers. Sets a temp data file so tests never write ./data in the repo.
const os = require('os');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

function setupEnv(extra = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vfi-test-'));
  Object.assign(process.env, {
    ENQUIRY_DATA_FILE: path.join(dir, 'enquiries.json'),
    IP_SALT: 'test-salt',
    SESSION_SECRET: 'test-session-secret-0123456789abcdef',
    ADMIN_PASSWORD: 'correct horse battery staple',
  }, extra);
  for (const k of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_ADMIN_SECRET', 'SMTP_HOST', 'ENQUIRY_TO', 'VERCEL']) {
    if (!(k in extra)) delete process.env[k];
  }
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

module.exports = { setupEnv, validBody, freshIp, boot, postJson, mockReq, mockRes };
