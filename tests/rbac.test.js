'use strict';
// Role x action matrix: for every admin action and method, assert exactly who is allowed (CMS-ARCHITECTURE section 3).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, boot, client, makeUser, ROLE_LIST } = require('./_helpers');
setupEnv();
const { getStore } = require('../lib/store');
const { PERMISSIONS } = require('../lib/auth/guard');
const { ACTIONS } = require('../api/admin/[action]');

let srv; let clients;
test.before(async () => {
  srv = await boot();
  const store = getStore();
  clients = { none: client(srv.base) };
  for (const role of ROLE_LIST) {
    const u = await makeUser(store, { email: `matrix-${role}@example.com`, role });
    clients[role] = client(srv.base);
    assert.equal((await clients[role].login(u.email)).status, 200);
  }
});
test.after(async () => { await srv.close(); });

const ANY = ['admin', 'editor', 'sales']; const ED = ['admin', 'editor']; const AD = ['admin'];
const UUID = '00000000-0000-4000-8000-000000000000';
// [method, action+query, body, roles allowed]. Bodies are deliberately harmless: allowed roles get a 2xx/4xx, never 401/403.
const MATRIX = [
  ['POST', 'password', {}, ANY],
  ['PATCH', 'account', {}, ANY],
  ['GET', 'enquiries', undefined, ANY],
  ['PATCH', 'enquiries', {}, ANY],
  ['GET', 'export', undefined, ANY],
  ['GET', 'content', undefined, ED],
  ['PUT', 'content', {}, ED],
  ['POST', 'publish', {}, ED],
  ['GET', 'revisions', undefined, ED],
  ['GET', 'revision?id=1', undefined, ED],
  ['POST', 'rollback', {}, ED],
  ['POST', 'discard', {}, ED],
  ['GET', 'media', undefined, ED],
  ['POST', 'media', undefined, ED],
  ['PATCH', 'media', {}, ED],
  ['DELETE', `media?id=${UUID}`, undefined, ED],
  ['GET', 'users', undefined, AD],
  ['POST', 'users', {}, AD],
  ['PATCH', 'users', {}, AD],
  ['GET', 'audit', undefined, AD],
];

for (const [method, action, body, allowed] of MATRIX) {
  test(`role matrix: ${method} ${action}`, async () => {
    for (const who of ['none', ...ROLE_LIST]) {
      const opts = body === undefined ? {} : { body };
      if (action === 'media' && method === 'POST') opts.raw = Buffer.from('x'), opts.headers = { 'content-type': 'image/png' };
      const r = await clients[who].req(method, `/api/admin/${action}`, opts);
      if (who === 'none') assert.equal(r.status, 401, `${who} must be 401`);
      else if (allowed.includes(who)) assert.ok(![401, 403].includes(r.status) && r.status < 500 || r.status === 503, `${who} should be allowed, got ${r.status}`);
      else assert.equal(r.status, 403, `${who} must be 403`);
      if (r.status === 403 && who !== 'none') assert.equal((await r.json()).code, 'forbidden');
      if (r.status === 401) assert.equal((await r.json()).code, 'unauthenticated');
    }
  });
}

test('role matrix: unauthenticated-by-design actions (login, logout, session)', async () => {
  assert.equal((await clients.none.get('/api/admin/session')).status, 200);
  assert.equal((await clients.none.post('/api/admin/logout', {})).status, 200);
  assert.equal((await clients.none.post('/api/admin/login', {})).status, 401);
});

test('role matrix: the table in guard.js covers every handler action and nothing else', () => {
  const open = new Set(['login', 'logout', 'session']);
  assert.deepEqual(Object.keys(ACTIONS).filter((a) => !open.has(a)).sort(), Object.keys(PERMISSIONS).sort());
  for (const [action, perms] of Object.entries(PERMISSIONS)) {
    assert.deepEqual(Object.keys(perms).sort(), [...ACTIONS[action].methods].sort(), action);
  }
  // spot-check the documented capabilities
  assert.deepEqual(PERMISSIONS.enquiries.GET, ANY);
  assert.deepEqual(PERMISSIONS.content.PUT, ED);
  assert.deepEqual(PERMISSIONS.users.POST, AD);
  assert.deepEqual(PERMISSIONS.audit.GET, AD);
});

test('role matrix: GET /api/content?draft=1 is editor/admin only (401 anonymous, 403 sales)', async () => {
  assert.equal((await clients.none.get('/api/content?draft=1')).status, 401);
  assert.equal((await clients.sales.get('/api/content?draft=1')).status, 403);
  assert.equal((await clients.editor.get('/api/content?draft=1')).status, 200);
  assert.equal((await clients.admin.get('/api/content?draft=1')).status, 200);
  assert.equal((await clients.none.get('/api/content')).status, 200, 'published content is public');
});

test('role matrix: CSRF header is required on every non-GET admin action (403 csrf, even for allowed roles)', async () => {
  for (const [method, action, body] of MATRIX.filter((m) => m[0] !== 'GET')) {
    const r = await clients.admin.req(method, `/api/admin/${action}`, { body, csrf: false });
    assert.equal(r.status, 403, `${method} ${action}`);
    assert.equal((await r.json()).code, 'csrf');
  }
});

test('IDOR: ids from other roles cannot be reached; sales cannot read revisions, media, users or audit', async () => {
  for (const a of ['revisions', 'revision?id=1', 'media', 'users', 'audit', 'content']) assert.equal((await clients.sales.get(`/api/admin/${a}`)).status, 403, a);
  for (const a of ['users', 'audit']) assert.equal((await clients.editor.get(`/api/admin/${a}`)).status, 403, a);
  assert.equal((await clients.editor.patch('/api/admin/users', { id: UUID, role: 'admin' })).status, 403, 'editors cannot promote');
  assert.equal((await clients.sales.patch('/api/admin/users', { id: UUID, role: 'admin' })).status, 403);
});
