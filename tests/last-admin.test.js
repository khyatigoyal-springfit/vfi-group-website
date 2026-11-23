'use strict';
// Last-active-admin protection through the HTTP API (own file: it needs a user table with no other admins).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, boot, client, makeUser } = require('./_helpers');
setupEnv();
const { getStore } = require('../lib/store');

let srv; let store;
test.before(async () => { srv = await boot(); store = getStore(); });
test.after(async () => { await srv.close(); });
let n = 0;

test('last admin: cannot be demoted or deactivated (409 last_admin); allowed once there are two admins', async () => {
  assert.equal((await store.listUsers()).length, 0, 'this file starts with an empty user table');
  const a1 = await makeUser(store, { email: `last-1-${++n}@example.com`, role: 'admin' });
  const c1 = client(srv.base); await c1.login(a1.email);
  for (const body of [{ id: a1.id, role: 'editor' }, { id: a1.id, role: 'sales' }, { id: a1.id, active: false }, { id: a1.id, role: 'editor', active: false }]) {
    const r = await c1.patch('/api/admin/users', body);
    assert.equal(r.status, 409, JSON.stringify(body));
    assert.equal((await r.json()).code, 'last_admin');
  }
  assert.equal((await store.getUserById(a1.id)).role, 'admin');
  assert.equal((await c1.get('/api/admin/users')).status, 200, 'still signed in');
  // name changes and password resets of the last admin are fine
  assert.equal((await c1.patch('/api/admin/users', { id: a1.id, name: 'Still admin' })).status, 200);
  // second admin -> allowed, and then the survivor is protected
  const create = await c1.post('/api/admin/users', { email: `last-2-${n}@example.com`, role: 'admin', password: 'second admin pass 1' });
  assert.equal(create.status, 200);
  const a2 = (await create.json()).user;
  assert.equal((await c1.patch('/api/admin/users', { id: a2.id, active: false })).status, 200);
  assert.equal((await c1.patch('/api/admin/users', { id: a2.id, active: true })).status, 200);
  assert.equal((await c1.patch('/api/admin/users', { id: a1.id, role: 'editor' })).status, 200, 'with two admins, demotion works');
  const c2 = client(srv.base); await c2.login(a2.email, 'second admin pass 1');
  await c2.post('/api/admin/password', { current: 'second admin pass 1', next: 'second admin pass 2' });
  assert.equal((await c2.patch('/api/admin/users', { id: a2.id, active: false })).status, 409, 'a2 is now the last admin');
  assert.equal((await c2.patch('/api/admin/users', { id: a1.id, role: 'admin' })).status, 200);
  assert.equal((await c2.patch('/api/admin/users', { id: a2.id, active: false })).status, 200, 'and with a1 back it works again');
});

