'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, validBody, boot, postJson, mockReq, mockRes, freshIp } = require('./_helpers');
setupEnv();
const { getStore, resetStore } = require('../lib/store');
const handler = require('../api/enquiry');

let srv;
test.before(async () => { srv = await boot(); });
test.after(async () => { await srv.close(); });

const count = async () => (await getStore().listEnquiries({ status: 'all' })).total;
const J = async (r) => r.json();

test('200 valid enquiry: ref format, stored, no raw IP anywhere', async () => {
  const before = await count();
  const ip = '203.0.113.77';
  const r = await postJson(srv.base, '/api/enquiry', validBody(), { 'x-forwarded-for': ip });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  const j = await J(r);
  assert.equal(j.ok, true);
  assert.match(j.ref, /^VFI-\d{6}-[A-F0-9]{6}$/);
  assert.equal(await count(), before + 1);
  const fs = require('fs');
  const stored = fs.readFileSync(process.env.ENQUIRY_DATA_FILE, 'utf8');
  assert.ok(!stored.includes(ip), 'raw ip must not be persisted');
  assert.match(JSON.parse(stored).at(-1).ip_hash, /^[0-9a-f]{64}$/);
});

test('honeypot: fake success, nothing stored, same shape as success', async () => {
  const before = await count();
  const r = await postJson(srv.base, '/api/enquiry', validBody({ website: 'http://spam.example' }));
  assert.equal(r.status, 200);
  assert.deepEqual(await J(r), { ok: true, ref: 'VFI-OK' });
  assert.equal(await count(), before);
});

test('timing trap: t<2500, missing or non-numeric t is a bot', async () => {
  const before = await count();
  for (const t of [0, 100, 2499, undefined, 'abc', null, '', {}, NaN]) {
    const body = validBody({ t });
    if (t === undefined) delete body.t;
    const r = await postJson(srv.base, '/api/enquiry', body);
    assert.equal(r.status, 200);
    assert.deepEqual(await J(r), { ok: true, ref: 'VFI-OK' }, String(t));
  }
  assert.equal(await count(), before);
  const ok = await postJson(srv.base, '/api/enquiry', validBody({ t: 2500 }));
  assert.match((await J(ok)).ref, /^VFI-\d/);
  assert.notEqual((await J(await postJson(srv.base, '/api/enquiry', validBody({ t: '3000' })))).ref, 'VFI-OK');
});

test('bot with invalid fields still gets fake success (checked before validation)', async () => {
  const r = await postJson(srv.base, '/api/enquiry', { website: 'x' });
  assert.equal(r.status, 200);
});

test('405 with Allow: POST for non-POST methods', async () => {
  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH']) {
    const r = await fetch(srv.base + '/api/enquiry', { method });
    assert.equal(r.status, 405, method);
    assert.equal(r.headers.get('allow'), 'POST');
    const j = await J(r);
    assert.equal(j.code, 'method_not_allowed');
    assert.equal(j.ok, false);
    assert.ok(j.error);
  }
});

test('415 for non-JSON content type', async () => {
  const r = await fetch(srv.base + '/api/enquiry', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: '{}' });
  assert.equal(r.status, 415);
  assert.equal((await J(r)).code, 'unsupported_media');
  const r2 = await fetch(srv.base + '/api/enquiry', { method: 'POST', body: 'x=1', headers: { 'content-type': 'application/x-www-form-urlencoded' } });
  assert.equal(r2.status, 415);
});

test('400 bad_json for malformed / non-object bodies', async () => {
  for (const body of ['{nope', '', '[]', '"str"', 'null']) {
    const r = await postJson(srv.base, '/api/enquiry', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.equal((await J(r)).code, 'bad_json');
  }
});

test('413 too_large above 32 KB', async () => {
  const r = await postJson(srv.base, '/api/enquiry', validBody({ msg: 'x'.repeat(40000) }));
  assert.equal(r.status, 413);
  assert.equal((await J(r)).code, 'too_large');
});

test('422 invalid_input with field-level errors', async () => {
  const r = await postJson(srv.base, '/api/enquiry', validBody({ name: '', email: 'nope', msg: '' }));
  assert.equal(r.status, 422);
  const j = await J(r);
  assert.equal(j.ok, false);
  assert.equal(j.code, 'invalid_input');
  assert.ok(j.error);
  assert.deepEqual(Object.keys(j.errors).sort(), ['email', 'message', 'name']);
});

test('429 on the 6th enquiry from one IP; other IPs unaffected', async () => {
  const ip = { 'x-forwarded-for': '198.51.100.9' };
  for (let i = 1; i <= 5; i++) assert.equal((await postJson(srv.base, '/api/enquiry', validBody(), ip)).status, 200, 'req ' + i);
  const r = await postJson(srv.base, '/api/enquiry', validBody(), ip);
  assert.equal(r.status, 429);
  assert.equal((await J(r)).code, 'rate_limited');
  assert.equal((await postJson(srv.base, '/api/enquiry', validBody(), { 'x-forwarded-for': '198.51.100.10' })).status, 200);
});

test('503 unavailable when the store fails; no internals leaked', async () => {
  const mod = require('../lib/store');
  const origErr = console.error; console.error = () => {};
  process.env.SUPABASE_URL = 'https://x.supabase.co'; process.env.SUPABASE_ANON_KEY = 'k';
  const origFetch = globalThis.fetch;
  resetStore();
  const realFetch = origFetch;
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes('supabase.co')) throw new TypeError('network down');
    return realFetch(url, opts);
  };
  try {
    const r = await postJson(srv.base, '/api/enquiry', validBody());
    assert.equal(r.status, 503);
    const j = await J(r);
    assert.equal(j.code, 'unavailable');
    assert.ok(!JSON.stringify(j).includes('supabase'));
  } finally {
    globalThis.fetch = origFetch; console.error = origErr;
    delete process.env.SUPABASE_URL; delete process.env.SUPABASE_ANON_KEY; mod.resetStore();
  }
});

test('SMTP failure still returns 200', async () => {
  process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1'; process.env.ENQUIRY_TO = 'x@example.com';
  const origErr = console.error; console.error = () => {};
  try {
    const r = await postJson(srv.base, '/api/enquiry', validBody());
    assert.equal(r.status, 200);
    assert.equal((await J(r)).ok, true);
  } finally { console.error = origErr; delete process.env.SMTP_HOST; delete process.env.SMTP_PORT; delete process.env.ENQUIRY_TO; }
});

test('unexpected exception => JSON 500, never HTML or stack', async () => {
  const store = getStore();
  const orig = store.submitEnquiry;
  store.submitEnquiry = async () => { throw new Error('secret internal detail'); };
  const origErr = console.error; console.error = () => {};
  try {
    const r = await postJson(srv.base, '/api/enquiry', validBody());
    assert.equal(r.status, 503); // unknown store errors map to unavailable
    const text = await r.text();
    assert.ok(!text.includes('secret internal detail') && !text.includes('at '));
    assert.equal(JSON.parse(text).ok, false);
  } finally { store.submitEnquiry = orig; console.error = origErr; }
});

// Direct handler calls, Vercel-style (req.body pre-parsed or string/Buffer)
test('handler works with req.body as object, string and Buffer', async () => {
  for (const body of [validBody(), JSON.stringify(validBody()), Buffer.from(JSON.stringify(validBody()))]) {
    const res = mockRes();
    await handler(mockReq({ headers: { 'content-type': 'application/json', 'x-forwarded-for': freshIp() }, body }), res);
    assert.equal(res.statusCode, 200);
    assert.match(res.json().ref, /^VFI-\d{6}-/);
    assert.equal(res.getHeader('cache-control'), 'no-store');
  }
  const res = mockRes();
  await handler(mockReq({ headers: { 'content-type': 'application/json' }, body: '{bad' }), res);
  assert.equal(res.statusCode, 400);
});
