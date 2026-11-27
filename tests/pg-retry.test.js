'use strict';
// Transient-failure handling in the Postgres store, using a fake pool (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv } = require('./_helpers');
setupEnv();
const { createPgStore, isTransientError, describeError } = require('../lib/db/store');

const TERMINATED = () => new Error('Connection terminated unexpectedly');

/** Fake pool. script.connectFails: errors thrown by successive connect() calls; onQuery(text, n) may throw. */
function fakePool({ connectFails = [], onQuery } = {}) {
  const log = { connects: 0, queries: [], released: [] };
  return {
    log,
    async connect() {
      const f = connectFails[log.connects++];
      if (f) throw f;
      return {
        async query(text) {
          log.queries.push(text);
          if (onQuery) { const r = onQuery(text, log.queries.length); if (r) return r; }
          if (/schema_migrations/.test(text) && /select version/.test(text)) return { rows: [] };
          if (/select 1 from content_state where id = 1$/.test(text)) return { rows: [{}] };
          return { rows: [{ n: 1 }], rowCount: 1 };
        },
        release(destroy) { log.released.push(!!destroy); },
      };
    },
  };
}
// Skip migrations/seed work: make prepareDatabase trivial by pretending everything exists.
const mk = (pool) => createPgStore({}, { pool, backoffMs: [1, 1, 1] });
const quiet = async (fn) => { const o = console.error; const lines = []; console.error = (...a) => lines.push(a.join(' ')); try { return await fn(lines); } finally { console.error = o; } };

test('isTransientError classification', () => {
  assert.ok(isTransientError(new Error('Connection terminated unexpectedly')));
  assert.ok(isTransientError(new Error('timeout exceeded when trying to connect')));
  assert.ok(isTransientError(Object.assign(new Error('x'), { code: 'ECONNRESET' })));
  assert.ok(isTransientError(Object.assign(new Error('x'), { code: '57P01' })));
  assert.ok(!isTransientError(Object.assign(new Error('timeout in sql'), { code: '23505' })));
  assert.ok(!isTransientError(Object.assign(new Error('conflict'), { code: 'conflict' })));
  assert.ok(!isTransientError(new Error('syntax error')));
});

test('first connect fails with Connection terminated, then succeeds: request succeeds', async () => {
  const pool = fakePool({ connectFails: [TERMINATED()] });
  const st = mk(pool);
  const r = await st.listUsers();
  assert.ok(Array.isArray(r));
  assert.ok(pool.log.connects >= 2);
});

test('a write that fails after BEGIN is not retried', async () => {
  let inserts = 0;
  const pool = fakePool({
    onQuery(text) {
      if (/insert into enquiries|pg_advisory_xact_lock\(hashtext/.test(text) && !/schema/.test(text)) { inserts++; throw TERMINATED(); }
      return null;
    },
  });
  const st = mk(pool);
  await quiet(async () => {
    await assert.rejects(st.submitEnquiry({ ip_hash: 'h', name: 'a', company: 'b', email: 'c@d.e', message: 'm', type: 'general' }), { code: 'unavailable' });
  });
  assert.equal(inserts, 1);
  assert.ok(pool.log.released.includes(true), 'broken client destroyed');
});

test('a write whose BEGIN fails is retried', async () => {
  let begins = 0;
  const pool = fakePool({
    onQuery(text) { if (text === 'begin' && ++begins === 2) throw TERMINATED(); return null; }, // 1st begin = startup migration, 2nd = the write (fails)
  });
  const st = mk(pool);
  await st.updateUser('00000000-0000-4000-8000-000000000000', {}).catch(() => {});
  assert.ok(begins >= 3, 'begin attempted again after transient failure');
});

test('migration is retried after a transient failure and not cached as failed', async () => {
  const pool = fakePool({ connectFails: [TERMINATED(), TERMINATED(), TERMINATED(), TERMINATED()] }); // exhausts retries of request 1
  const st = mk(pool);
  await quiet(async () => { await assert.rejects(st.listUsers(), { code: 'unavailable' }); });
  const before = pool.log.connects;
  const r = await st.listUsers(); // database is back: next request retries the startup step
  assert.ok(Array.isArray(r));
  assert.ok(pool.log.queries.some((x) => /advisory_xact_lock/.test(x)), 'migration ran');
  assert.ok(pool.log.connects > before);
});

test('logging includes code, name and (sanitised, truncated) message', async () => {
  const e = Object.assign(new Error('boom postgres://user:secret@host/db ' + 'x'.repeat(400)), { name: 'DatabaseError', code: '42P01' });
  const d = describeError(e);
  assert.match(d, /code=42P01/);
  assert.match(d, /name=DatabaseError/);
  assert.match(d, /message=boom \[url\]/);
  assert.ok(!/secret/.test(d));
  assert.ok(d.length < 300);
  const pool = fakePool({ onQuery(text) { if (/from users/.test(text)) throw e; return null; } });
  await quiet(async (lines) => {
    await assert.rejects(mk(pool).listUsers(), { code: 'unavailable' });
    assert.ok(lines.some((l) => /message=boom/.test(l) && /code=42P01/.test(l)));
  });
});
