'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv } = require('./_helpers');
const dir = setupEnv();
const path = require('path');
const { createStore } = require('../lib/store');
const { createMemoryStore } = require('../lib/store/memory');
const { defineStoreSuite } = require('./store-suite');

let n = 0;
defineStoreSuite('memory store', async () => createMemoryStore({ ENQUIRY_DATA_FILE: path.join(dir, `store-${++n}.json`) }));

test('createStore: memory without DATABASE_URL (dev), unavailable in production without it', async () => {
  assert.equal(createStore({}).kind, 'memory');
  const origErr = console.error; console.error = () => {};
  try {
    for (const env of [{ NODE_ENV: 'production' }, { VERCEL: '1' }]) {
      const s = createStore(env);
      assert.equal(s.kind, 'unavailable');
      for (const m of ['getPublished', 'getUserById', 'submitEnquiry', 'listAudit']) {
        await assert.rejects(s[m]({}), { code: 'unavailable' });
      }
    }
  } finally { console.error = origErr; }
});

test('memory store: bootstrap admin only when users is empty and both vars are set; password never stored in clear', async () => {
  const { verifyPassword } = require('../lib/auth/password');
  const s = createMemoryStore({ BOOTSTRAP_ADMIN_EMAIL: 'Boss@Example.com', BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-password-1' });
  const users = await s.listUsers();
  assert.equal(users.length, 1);
  assert.equal(users[0].email, 'boss@example.com'); assert.equal(users[0].role, 'admin'); assert.equal(users[0].must_change_password, true);
  const full = await s.getUserByEmail('boss@example.com');
  assert.ok(await verifyPassword('bootstrap-password-1', full.password_hash));
  assert.ok(!full.password_hash.includes('bootstrap-password-1'));
  assert.equal((await createMemoryStore({ BOOTSTRAP_ADMIN_EMAIL: 'x@example.com' }).listUsers()).length, 0);
  assert.equal((await createMemoryStore({ BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-password-1' }).listUsers()).length, 0);
});
