'use strict';
// Postgres integration tests. Run only when TEST_DATABASE_URL points at a throwaway database
// (the public schema is DROPPED and recreated before every test). Skipped otherwise, so `npm test` works offline.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv } = require('./_helpers');
setupEnv();

const URL_ = process.env.TEST_DATABASE_URL;
if (!URL_) {
  test('postgres integration (skipped: TEST_DATABASE_URL not set)', { skip: true }, () => {});
} else {
  const { getPool, closePools } = require('../lib/db/pool');
  const { createPgStore } = require('../lib/db/store');
  const { prepareDatabase, listMigrations } = require('../lib/db/migrate');
  const { verifyPassword } = require('../lib/auth/password');
  const { loadDefaultContent } = require('../lib/content/defaults');
  const { defineStoreSuite } = require('./store-suite');

  const reset = async () => {
    await getPool(URL_).query('drop schema if exists public cascade; create schema public;');
  };
  test.after(async () => { await closePools(); });

  defineStoreSuite('postgres store', async () => { await reset(); return createPgStore({ DATABASE_URL: URL_ }); });

  test('postgres: migration applies to an empty database, is recorded, and is safe to run twice', async () => {
    await reset();
    const pool = getPool(URL_);
    const first = await prepareDatabase(pool, {});
    assert.deepEqual(first.applied, listMigrations().map((m) => m.version));
    assert.equal(first.seeded, true);
    const second = await prepareDatabase(pool, {});
    assert.deepEqual(second.applied, []);
    assert.equal(second.seeded, false);
    const tables = (await pool.query(`select table_name from information_schema.tables where table_schema = 'public' order by 1`)).rows.map((r) => r.table_name);
    for (const t of ['users', 'login_attempts', 'enquiries', 'content_state', 'content_revisions', 'media', 'audit_log', 'schema_migrations']) assert.ok(tables.includes(t), t);
    assert.equal((await pool.query('select count(*)::int as n from schema_migrations')).rows[0].n, listMigrations().length);
  });

  test('postgres: four concurrent instances start together without double-applying, double-seeding or double-bootstrapping', async () => {
    await reset();
    const pool = getPool(URL_);
    const env = { BOOTSTRAP_ADMIN_EMAIL: 'boss@example.com', BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-password-1' };
    const results = await Promise.all([1, 2, 3, 4].map(() => prepareDatabase(pool, env)));
    assert.equal(results.filter((r) => r.applied.length > 0).length, 1);
    assert.equal(results.filter((r) => r.seeded).length, 1);
    assert.equal(results.filter((r) => r.bootstrapped).length, 1);
    assert.equal((await pool.query('select count(*)::int as n from users')).rows[0].n, 1);
    assert.equal((await pool.query('select count(*)::int as n from content_state')).rows[0].n, 1);
    assert.equal((await pool.query('select count(*)::int as n from content_revisions')).rows[0].n, 1);
  });

  test('postgres: bootstrap admin only when users is empty; must_change_password; scrypt hash; seed equals default.json', async () => {
    await reset();
    const pool = getPool(URL_);
    const s = createPgStore({ DATABASE_URL: URL_, BOOTSTRAP_ADMIN_EMAIL: 'Boss@Example.com', BOOTSTRAP_ADMIN_PASSWORD: 'bootstrap-password-1' });
    const u = await s.getUserByEmail('boss@example.com');
    assert.equal(u.role, 'admin'); assert.equal(u.must_change_password, true); assert.equal(u.active, true);
    assert.match(u.password_hash, /^scrypt\$16384\$8\$1\$/);
    assert.ok(await verifyPassword('bootstrap-password-1', u.password_hash));
    // a second start with different bootstrap vars does not add or change anyone
    await prepareDatabase(pool, { BOOTSTRAP_ADMIN_EMAIL: 'other@example.com', BOOTSTRAP_ADMIN_PASSWORD: 'another-password-22' });
    assert.equal((await s.listUsers()).length, 1);
    const rev = (await pool.query('select data from content_revisions where id = 1')).rows[0].data;
    assert.deepEqual(rev, loadDefaultContent());
    assert.equal((await pool.query('select published_revision from content_state')).rows[0].published_revision, 1);
    // only one of the two env vars: nothing created
    await reset();
    await prepareDatabase(pool, { BOOTSTRAP_ADMIN_EMAIL: 'x@example.com' });
    assert.equal((await pool.query('select count(*)::int as n from users')).rows[0].n, 0);
  });

  test('postgres: pruneOld deletes login_attempts > 30 days and audit_log > 365 days only; login/revision indexes exist', async () => {
    const s = createPgStore({ DATABASE_URL: URL_ });
    await s.ensureReady();
    const pool = getPool(URL_);
    await pool.query(`insert into login_attempts (ip_hash, email, ok, at) values ('a','', false, now() - interval '31 days'), ('b','', false, now() - interval '29 days'), ('c','', true, now() - interval '400 days')`);
    await pool.query(`insert into audit_log (action, at) values ('old', now() - interval '366 days'), ('mid', now() - interval '300 days'), ('new', now())`);
    const r = await s.pruneOld();
    assert.deepEqual(r, { login_attempts: 2, audit_log: 1 });
    assert.deepEqual((await pool.query('select ip_hash from login_attempts')).rows.map((x) => x.ip_hash), ['b']);
    assert.deepEqual((await pool.query('select action from audit_log order by at')).rows.map((x) => x.action), ['mid', 'new']);
    const idx = (await pool.query(`select indexname from pg_indexes where tablename = 'login_attempts'`)).rows.map((x) => x.indexname);
    for (const i of ['login_attempts_at', 'login_attempts_email_ip_at']) assert.ok(idx.includes(i), i);
  });

  test('postgres: concurrent publishes with the same base_updated_at: exactly one wins, the rest conflict or have nothing to publish', async () => {
    const s = createPgStore({ DATABASE_URL: URL_ });
    const st = await s.getContentState();
    const saved = await s.saveDraft({ data: { ...st.draft, settings: { ...st.draft.settings, siteName: 'Race' } }, base_updated_at: st.draft_updated_at, user_id: null });
    const rs = await Promise.allSettled([1, 2, 3, 4].map((n) => s.publish({ user_id: null, note: 'p' + n, base_updated_at: saved.draft_updated_at })));
    assert.equal(rs.filter((x) => x.status === 'fulfilled').length, 1);
    assert.deepEqual(rs.filter((x) => x.status === 'rejected').map((x) => x.reason.code), ['nothing_to_publish', 'nothing_to_publish', 'nothing_to_publish']);
    assert.equal((await s.listRevisions({})).total, 2);
  });

  test('postgres: db errors surface as code "unavailable" without leaking SQL or hosts', async () => {
    const origErr = console.error; console.error = () => {};
    try {
      const bad = createPgStore({ DATABASE_URL: 'postgres://nobody:secretpw@127.0.0.1:1/none' });
      await assert.rejects(bad.getPublished(), (e) => e.code === 'unavailable' && !/secretpw|127\.0\.0\.1/.test(e.message));
    } finally { console.error = origErr; await closePools(); }
  });
}
