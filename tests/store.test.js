'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupEnv, validBody } = require('./_helpers');
const dir = setupEnv();
const { createStore } = require('../lib/store');
const { createMemoryStore } = require('../lib/store/memory');
const { createSupabaseStore, mapPgError } = require('../lib/store/supabase');
const { validateEnquiry } = require('../lib/validate');

const SECRET = 'admin-secret-xyz';
const URL_ = 'https://proj.supabase.co';
const KEY = 'sb_publishable_testkey';

const input = (over = {}) => ({ ...validateEnquiry(validBody(over)).value, ip_hash: over.ip_hash || '', user_agent: 'UA' });

const PG = { rate_limited: ['P0429', 'rate_limited'], invalid_input: ['22023', 'invalid_input'], forbidden: ['P0403', 'forbidden'], not_found: ['P0404', 'not_found'] };

/** fetch double that behaves like PostgREST in front of the SQL functions, backed by a memory store. */
function fakeSupabase(mem) {
  const calls = [];
  const fetchFn = async (url, opts) => {
    calls.push({ url, opts });
    assert.equal(opts.headers.apikey, KEY);
    assert.equal(opts.headers.Authorization, `Bearer ${KEY}`);
    assert.ok(opts.signal, 'abort signal present');
    const fn = String(url).split('/rest/v1/rpc/')[1];
    const a = JSON.parse(opts.body);
    const reply = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body) });
    try {
      if (fn === 'submit_enquiry') return reply(200, await mem.submitEnquiry(a.p));
      if (a.p_secret !== SECRET) { const e = new Error('forbidden'); e.code = 'forbidden'; throw e; }
      if (fn === 'admin_list_enquiries') return reply(200, await mem.listEnquiries({ status: a.p_status, q: a.p_q, limit: a.p_limit, offset: a.p_offset }));
      if (fn === 'admin_update_enquiry') return reply(200, await mem.updateEnquiry({ id: a.p_id, status: a.p_status, notes: a.p_notes }));
      if (fn === 'admin_export_enquiries') return reply(200, await mem.exportEnquiries({ status: a.p_status, q: a.p_q }));
      return reply(404, { code: 'PGRST202', message: 'no function' });
    } catch (e) {
      const [code, message] = PG[e.code] || ['XX000', 'boom'];
      return reply(400, { code, message });
    }
  };
  return { fetchFn, calls };
}

function suite(name, make) {
  test(`${name}: submit returns ref+id with correct format`, async () => {
    const s = make();
    const r = await s.submitEnquiry(input());
    assert.match(r.ref, /^VFI-\d{6}-[A-F0-9]{6}$/);
    assert.ok(r.id);
  });

  test(`${name}: 6th submit from same ip_hash is rate limited; other ip unaffected`, async () => {
    const s = make();
    for (let i = 0; i < 5; i++) await s.submitEnquiry(input({ ip_hash: 'h1' }));
    await assert.rejects(s.submitEnquiry(input({ ip_hash: 'h1' })), { code: 'rate_limited' });
    await s.submitEnquiry(input({ ip_hash: 'h2' }));
  });

  test(`${name}: list default excludes spam, 'all' includes it, counts have all keys, no ip_hash`, async () => {
    const s = make();
    const a = await s.submitEnquiry(input({ name: 'Alpha', ip_hash: 'x' }));
    await s.submitEnquiry(input({ name: 'Beta' }));
    await s.updateEnquiry({ id: a.id, status: 'spam' });
    const def = await s.listEnquiries({ status: '', limit: 25, offset: 0 });
    assert.equal(def.total, 1);
    assert.equal(def.rows[0].name, 'Beta');
    assert.deepEqual(def.counts, { new: 1, in_progress: 0, contacted: 0, closed: 0, spam: 1 });
    const all = await s.listEnquiries({ status: 'all' });
    assert.equal(all.total, 2);
    assert.equal((await s.listEnquiries({ status: 'spam' })).total, 1);
    for (const r of all.rows) assert.equal('ip_hash' in r, false);
  });

  test(`${name}: search is case-insensitive across fields and escapes % and _`, async () => {
    const s = make();
    const e1 = await s.submitEnquiry(input({ name: 'Zed Person', company: 'Acme_Corp', country: 'Norway', msg: 'Needs FOAM sheets' }));
    await s.submitEnquiry(input({ name: 'Other', company: 'AcmeXCorp', email: 'o@example.org' }));
    const find = async (q) => (await s.listEnquiries({ status: 'all', q })).total;
    assert.equal(await find('zed'), 1);
    assert.equal(await find('ACME_CORP'), 1);
    assert.equal(await find('acme_'), 1, 'underscore is literal');
    assert.equal(await find('acme%'), 0, 'percent is literal');
    assert.equal(await find('norway'), 1);
    assert.equal(await find('foam'), 1);
    assert.equal(await find('o@example'), 1);
    assert.equal(await find(e1.ref.toLowerCase()), 1);
    assert.equal(await find('nomatch'), 0);
  });

  test(`${name}: limit clamped 1..100, offset paging, newest first`, async () => {
    const s = make();
    for (let i = 0; i < 7; i++) await s.submitEnquiry(input({ name: 'N' + i }));
    const p1 = await s.listEnquiries({ status: 'all', limit: 3, offset: 0 });
    const p3 = await s.listEnquiries({ status: 'all', limit: 3, offset: 6 });
    assert.deepEqual(p1.rows.map((r) => r.name), ['N6', 'N5', 'N4']);
    assert.equal(p1.total, 7);
    assert.deepEqual(p3.rows.map((r) => r.name), ['N0']);
    assert.equal((await s.listEnquiries({ status: 'all', limit: 0 })).rows.length, 1);
    assert.equal((await s.listEnquiries({ status: 'all', limit: -5 })).rows.length, 1);
    assert.equal((await s.listEnquiries({ status: 'all', limit: 100000 })).rows.length, 7);
  });

  test(`${name}: update changes fields, null leaves unchanged, bumps updated_at`, async () => {
    const s = make();
    const e = await s.submitEnquiry(input());
    const before = (await s.listEnquiries({ status: 'all' })).rows[0];
    await new Promise((r) => setTimeout(r, 5));
    const u1 = await s.updateEnquiry({ id: e.id, status: 'contacted', notes: 'called\nback' });
    assert.equal(u1.status, 'contacted');
    assert.equal(u1.notes, 'called\nback');
    assert.ok(u1.updated_at > before.updated_at);
    assert.equal('ip_hash' in u1, false);
    const u2 = await s.updateEnquiry({ id: e.id, status: null, notes: null });
    assert.equal(u2.status, 'contacted');
    assert.equal(u2.notes, 'called\nback');
    const u3 = await s.updateEnquiry({ id: e.id, notes: '' });
    assert.equal(u3.notes, '');
  });

  test(`${name}: update errors: not_found and invalid_input`, async () => {
    const s = make();
    const e = await s.submitEnquiry(input());
    await assert.rejects(s.updateEnquiry({ id: '00000000-0000-4000-8000-000000000000', status: 'closed' }), { code: 'not_found' });
    await assert.rejects(s.updateEnquiry({ id: e.id, status: 'bogus' }), { code: 'invalid_input' });
    await assert.rejects(s.updateEnquiry({ id: e.id, notes: 'x'.repeat(5001) }), { code: 'invalid_input' });
  });

  test(`${name}: export honours filters and strips ip_hash`, async () => {
    const s = make();
    const a = await s.submitEnquiry(input({ name: 'Keep', ip_hash: 'q' }));
    await s.submitEnquiry(input({ name: 'Drop' }));
    await s.updateEnquiry({ id: a.id, status: 'closed' });
    const rows = await s.exportEnquiries({ status: 'closed', q: '' });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].name, 'Keep');
    assert.equal('ip_hash' in rows[0], false);
    assert.equal((await s.exportEnquiries({ status: 'all' })).length, 2);
  });
}

suite('memory', () => createMemoryStore({ ENQUIRY_DATA_FILE: path.join(dir, `m${Math.random()}.json`) }));

suite('supabase(mock fetch)', () => {
  const { fetchFn } = fakeSupabase(createMemoryStore({ VERCEL: '1' }));
  globalThis.fetch = fetchFn;
  return createSupabaseStore({ SUPABASE_URL: URL_ + '/', SUPABASE_ANON_KEY: KEY, SUPABASE_ADMIN_SECRET: SECRET });
});

// ---- supabase specifics
const realFetch = globalThis.fetch;
const sb = () => createSupabaseStore({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: KEY, SUPABASE_ADMIN_SECRET: SECRET });
const rejectsWith = async (p, code) => {
  try { await p; } catch (e) {
    assert.equal(e.code, code);
    const text = e.message + JSON.stringify(e);
    for (const secretish of [URL_, KEY, SECRET, 'supabase.co']) assert.ok(!text.includes(secretish), 'error text leaks ' + secretish);
    return;
  }
  assert.fail('expected rejection');
};

test('supabase: request shape (url, method, headers, body)', async () => {
  const mem = createMemoryStore({ VERCEL: '1' });
  const { fetchFn, calls } = fakeSupabase(mem);
  globalThis.fetch = fetchFn;
  await sb().submitEnquiry(input());
  assert.equal(calls[0].url, `${URL_}/rest/v1/rpc/submit_enquiry`);
  assert.equal(calls[0].opts.method, 'POST');
  assert.ok(JSON.parse(calls[0].opts.body).p.name);
  await sb().listEnquiries({ status: '', q: '', limit: 10, offset: 0 });
  const a = JSON.parse(calls[1].opts.body);
  assert.deepEqual(a, { p_secret: SECRET, p_status: null, p_q: null, p_limit: 10, p_offset: 0 });
});

test('supabase: error mapping by SQLSTATE and message', async () => {
  const mk = (status, body) => async () => ({ ok: false, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) });
  const cases = [
    [{ code: 'P0429', message: 'rate_limited' }, 'rate_limited'],
    [{ code: 'P0001', message: 'rate_limited' }, 'rate_limited'],
    [{ code: '22023', message: 'invalid_input' }, 'invalid_input'],
    [{ code: 'P0403', message: 'forbidden' }, 'forbidden'],
    [{ code: 'P0404', message: 'not_found' }, 'not_found'],
    [{ code: 'PGRST202', message: 'Could not find the function' }, 'unavailable'],
    [{ code: '42501', message: 'permission denied' }, 'unavailable'],
    ['<html>bad gateway</html>', 'unavailable'],
    ['', 'unavailable'],
  ];
  for (const [body, code] of cases) {
    globalThis.fetch = mk(400, body);
    await rejectsWith(sb().submitEnquiry(input()), code);
  }
  globalThis.fetch = mk(502, 'upstream');
  await rejectsWith(sb().submitEnquiry(input()), 'unavailable');
  assert.equal(mapPgError(null), 'unavailable');
});

test('supabase: network error and invalid success body map to unavailable', async () => {
  globalThis.fetch = async () => { throw new TypeError(`fetch failed ${URL_} ${KEY}`); };
  await rejectsWith(sb().submitEnquiry(input()), 'unavailable');
  globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => 'not json' });
  await rejectsWith(sb().submitEnquiry(input()), 'unavailable');
});

test('supabase: timeout aborts after 8 s and maps to unavailable', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let aborted = false;
  globalThis.fetch = (url, opts) => new Promise((_, reject) => {
    opts.signal.addEventListener('abort', () => { aborted = true; const e = new Error('aborted'); e.name = 'AbortError'; reject(e); });
  });
  const p = sb().submitEnquiry(input());
  const settled = rejectsWith(p, 'unavailable');
  await Promise.resolve();
  t.mock.timers.tick(7999);
  assert.equal(aborted, false);
  t.mock.timers.tick(2);
  await settled;
  assert.equal(aborted, true);
});

test('supabase: missing admin secret => forbidden without calling fetch', async () => {
  let called = false;
  globalThis.fetch = async () => { called = true; };
  const s = createSupabaseStore({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: KEY });
  await rejectsWith(s.listEnquiries({}), 'forbidden');
  assert.equal(called, false);
});

test('supabase: wrong admin secret is rejected as forbidden', async () => {
  globalThis.fetch = fakeSupabase(createMemoryStore({ VERCEL: '1' })).fetchFn;
  const s = createSupabaseStore({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: KEY, SUPABASE_ADMIN_SECRET: 'nope' });
  await rejectsWith(s.listEnquiries({}), 'forbidden');
});

// ---- store selection and memory persistence
test('createStore picks supabase iff SUPABASE_URL is set', () => {
  assert.equal(createStore({}).kind, 'memory');
  assert.equal(createStore({ VERCEL: '1' }).kind, 'memory');
  assert.equal(createStore({ SUPABASE_URL: URL_, SUPABASE_ANON_KEY: KEY }).kind, 'supabase');
});

test('memory store persists to file, ignores corrupt file, and does not persist on Vercel', async () => {
  const file = path.join(dir, 'nested', 'persist.json');
  const a = createMemoryStore({ ENQUIRY_DATA_FILE: file });
  await a.submitEnquiry(input({ name: 'Persisted' }));
  assert.ok(fs.existsSync(file));
  const b = createMemoryStore({ ENQUIRY_DATA_FILE: file });
  assert.equal((await b.listEnquiries({ status: 'all' })).rows[0].name, 'Persisted');
  assert.deepEqual(fs.readdirSync(path.dirname(file)).filter((f) => f.endsWith('.tmp')), []);
  fs.writeFileSync(file, '{corrupt');
  assert.equal((await createMemoryStore({ ENQUIRY_DATA_FILE: file }).listEnquiries({ status: 'all' })).total, 0);
  const vfile = path.join(dir, 'vercel.json');
  await createMemoryStore({ ENQUIRY_DATA_FILE: vfile, VERCEL: '1' }).submitEnquiry(input());
  assert.equal(fs.existsSync(vfile), false);
});

test('memory store: export cap is 5000', async () => {
  const s = createMemoryStore({ VERCEL: '1' });
  for (let i = 0; i < 5003; i++) await s.submitEnquiry(input());
  assert.equal((await s.exportEnquiries({ status: 'all' })).length, 5000);
});

test.after(() => { globalThis.fetch = realFetch; });
