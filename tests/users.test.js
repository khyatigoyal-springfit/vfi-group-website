'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, boot, client, makeUser, PASSWORD } = require('./_helpers');
setupEnv();
const { getStore } = require('../lib/store');
const { verifyPassword } = require('../lib/auth/password');

let srv; let store;
test.before(async () => { srv = await boot(); store = getStore(); });
test.after(async () => { await srv.close(); });

let n = 0;
async function adminClient(name = 'Root') {
  const u = await makeUser(store, { email: `users-admin-${++n}@example.com`, role: 'admin', name });
  const c = client(srv.base);
  assert.equal((await c.login(u.email)).status, 200);
  return { u, c };
}
const usersOf = async (c) => (await (await c.get('/api/admin/users')).json()).users;

test('users: list never exposes password hashes; shape is stable', async () => {
  const { c } = await adminClient();
  const r = await c.get('/api/admin/users');
  assert.equal(r.status, 200);
  const text = await r.text();
  assert.ok(!/password_hash|scrypt|session_version/.test(text));
  const u = JSON.parse(text).users[0];
  assert.deepEqual(Object.keys(u).sort(), ['active', 'created_at', 'email', 'id', 'last_login_at', 'must_change_password', 'name', 'role']);
});

test('create user: validation errors per field; success forces a password change; the new user can log in and sees only their role', async () => {
  const { c } = await adminClient();
  const bad = await c.post('/api/admin/users', { email: 'not-an-email', name: 'x'.repeat(121), role: 'superuser', password: 'short' });
  assert.equal(bad.status, 422);
  assert.deepEqual(Object.keys((await bad.json()).errors).sort(), ['email', 'name', 'password', 'role']);
  assert.equal((await c.post('/api/admin/users', { email: 'ok@example.com', role: 'editor', password: 'x'.repeat(11) })).status, 422, '11-char password');
  const ok = await c.post('/api/admin/users', { email: `New.Editor${n}@Example.com`, name: 'New Editor', role: 'editor', password: 'initial password 1' });
  assert.equal(ok.status, 200);
  const u = (await ok.json()).user;
  assert.equal(u.email, `new.editor${n}@example.com`); assert.equal(u.role, 'editor'); assert.equal(u.must_change_password, true); assert.equal(u.active, true);
  assert.ok(!JSON.stringify(u).includes('password_hash'));
  assert.ok(await verifyPassword('initial password 1', (await store.getUserById(u.id)).password_hash));
  // duplicate (case-insensitive)
  const dup = await c.post('/api/admin/users', { email: `NEW.EDITOR${n}@example.com`, role: 'sales', password: 'initial password 1' });
  assert.equal(dup.status, 409);
  assert.equal((await dup.json()).code, 'email_taken');
  // the new user: forced change, then editor-only access
  const nc = client(srv.base);
  assert.equal((await nc.login(u.email, 'initial password 1')).status, 200);
  assert.equal((await nc.get('/api/admin/content')).status, 403, 'blocked until the password is changed');
  assert.equal((await nc.post('/api/admin/password', { current: 'initial password 1', next: 'my own new password' })).status, 200);
  assert.equal((await nc.get('/api/admin/content')).status, 200);
  assert.equal((await nc.get('/api/admin/users')).status, 403);
});

test('update user: role, name, deactivate and reactivate; deactivation revokes the target session immediately', async () => {
  const { c } = await adminClient();
  const t = await makeUser(store, { email: `target-${++n}@example.com`, role: 'sales' });
  const tc = client(srv.base); await tc.login(t.email);
  assert.equal((await tc.get('/api/admin/enquiries')).status, 200);
  const r = await c.patch('/api/admin/users', { id: t.id, role: 'editor', name: 'Renamed' });
  assert.equal(r.status, 200);
  const u = (await r.json()).user;
  assert.equal(u.role, 'editor'); assert.equal(u.name, 'Renamed');
  assert.equal((await tc.get('/api/admin/media')).status, 200, 'new role applies without logging in again');
  assert.equal((await c.patch('/api/admin/users', { id: t.id, active: false })).status, 200);
  assert.equal((await tc.get('/api/admin/enquiries')).status, 401);
  assert.equal((await client(srv.base).login(t.email)).status, 401, 'deactivated users cannot log in');
  assert.equal((await c.patch('/api/admin/users', { id: t.id, active: true })).status, 200);
  assert.equal((await client(srv.base).login(t.email)).status, 200);
  assert.equal((await tc.get('/api/admin/enquiries')).status, 401, 'the old session stays dead after reactivation');
});

test('update user: validation and unknown ids', async () => {
  const { c } = await adminClient();
  const t = await makeUser(store, { email: `val-${++n}@example.com`, role: 'sales' });
  for (const body of [{}, { id: t.id }, { id: 'nope', role: 'admin' }, { id: t.id, role: 'root' }, { id: t.id, active: 'yes' }, { id: t.id, name: 'x'.repeat(121) }, { id: t.id, resetPassword: 'yes' }]) {
    assert.equal((await c.patch('/api/admin/users', body)).status, 422, JSON.stringify(body));
  }
  assert.equal((await c.patch('/api/admin/users', { id: '00000000-0000-4000-8000-000000000000', role: 'admin' })).status, 404);
});

test('reset password: returns a temporary password once, sets must_change_password, invalidates sessions; the hash is not exposed', async () => {
  const { c } = await adminClient();
  const t = await makeUser(store, { email: `reset-${++n}@example.com`, role: 'editor' });
  const tc = client(srv.base); await tc.login(t.email);
  const r = await c.patch('/api/admin/users', { id: t.id, resetPassword: true });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.match(j.temporary_password, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
  assert.equal(j.user.must_change_password, true);
  assert.ok(!JSON.stringify(j).includes('scrypt'));
  assert.equal((await tc.get('/api/admin/enquiries')).status, 401, 'old session invalidated');
  assert.equal((await client(srv.base).login(t.email, PASSWORD)).status, 401, 'old password dead');
  const nc = client(srv.base);
  const lr = await nc.login(t.email, j.temporary_password);
  assert.equal(lr.status, 200);
  assert.equal((await lr.json()).user.must_change_password, true);
  assert.equal((await nc.get('/api/admin/enquiries')).status, 403);
  assert.equal((await nc.post('/api/admin/password', { current: j.temporary_password, next: 'a permanent password 1' })).status, 200);
  assert.equal((await nc.get('/api/admin/enquiries')).status, 200);
  // listing never shows it again; audit has no password
  assert.ok(!JSON.stringify(await usersOf(c)).includes(j.temporary_password));
  assert.ok(!JSON.stringify((await store.listAudit({ limit: 500 })).rows).includes(j.temporary_password));
  assert.notEqual((await (await c.patch('/api/admin/users', { id: t.id, resetPassword: true })).json()).temporary_password, j.temporary_password);
});

test('audit log: admin only, newest first, paged; records user and target; never holds secrets', async () => {
  const { u, c } = await adminClient('Auditor');
  await c.post('/api/admin/users', { email: `audited-${++n}@example.com`, role: 'sales', password: 'super secret pass 1' });
  const r = await c.get('/api/admin/audit?pageSize=5');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.pageSize, 5); assert.equal(j.rows.length, 5); assert.ok(j.total > 5);
  assert.equal(j.rows[0].action, 'user_create');
  assert.equal(j.rows[0].user_name, 'Auditor'); assert.equal(j.rows[0].user_email, u.email); assert.match(j.rows[0].target, /^audited-/);
  assert.deepEqual(j.rows[0].detail, { role: 'sales' });
  const ids = j.rows.map((x) => x.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
  const p2 = await (await c.get('/api/admin/audit?pageSize=5&page=2')).json();
  assert.ok(p2.rows[0].id < j.rows[4].id);
  const all = JSON.stringify((await store.listAudit({ limit: 200 })).rows);
  for (const secret of ['super secret pass', PASSWORD, 'scrypt$']) assert.ok(!all.includes(secret), secret);
  assert.ok((await c.get('/api/admin/audit?pageSize=100000')).status === 200);
  assert.equal((await (await c.get('/api/admin/audit?pageSize=100000')).json()).pageSize, 200);
});

test('audit log: user create/update/reset/deactivate, account and password changes all leave entries', async () => {
  const { c } = await adminClient();
  const t = await makeUser(store, { email: `audit-t-${++n}@example.com`, role: 'sales' });
  await c.patch('/api/admin/users', { id: t.id, role: 'editor' });
  await c.patch('/api/admin/users', { id: t.id, resetPassword: true });
  await c.patch('/api/admin/users', { id: t.id, active: false });
  const rows = (await store.listAudit({ limit: 500 })).rows.filter((x) => x.target === t.email).map((x) => x.action);
  assert.deepEqual(rows, ['user_update', 'user_reset_password', 'user_update']);
  const detail = (await store.listAudit({ limit: 500 })).rows.filter((x) => x.target === t.email);
  assert.deepEqual(detail[0].detail.changes, ['deactivate']);
  assert.deepEqual(detail[1].detail.changes, ['reset_password']);
});
