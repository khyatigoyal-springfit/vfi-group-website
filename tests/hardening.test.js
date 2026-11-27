'use strict';
// Regression tests for the security/QA hardening pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupEnv, validBody, boot, postJson, mockReq, mockRes } = require('./_helpers');
setupEnv();
const { readJson, clientIp, ipHash, normalizeIp } = require('../lib/http');
const mail = require('../lib/mail');
const { getStore } = require('../lib/store');
const { isEmail, validateEnquiry } = require('../lib/validate');
const enquiryHandler = require('../api/enquiry');

const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};
const JSON_CT = { 'content-type': 'application/json' };
const CSRF = { 'x-requested-with': 'vfi-admin' };

// ---------------------------------------------------------------- mail bound
test('enquiry: a slow notifier never delays the response beyond ~3 s; request still 200', async () => {
  const orig = mail.notify;
  mail.notify = () => new Promise((r) => setTimeout(() => r(true), 20000).unref());
  try {
    const res = mockRes();
    const t0 = Date.now();
    await quiet(() => enquiryHandler(mockReq({ headers: { ...JSON_CT }, body: validBody() }), res));
    const dt = Date.now() - t0;
    assert.equal(res.statusCode, 200);
    assert.match(res.json().ref, /^VFI-/);
    assert.ok(dt >= 2900 && dt < 4500, `took ${dt} ms`);
  } finally { mail.notify = orig; }
});

test('enquiry: a rejecting or throwing notifier still returns 200', async () => {
  const orig = mail.notify;
  try {
    for (const fake of [() => Promise.reject(new Error('smtp down')), () => { throw new Error('sync boom'); }]) {
      mail.notify = fake;
      const res = mockRes();
      await quiet(() => enquiryHandler(mockReq({ headers: { ...JSON_CT }, body: validBody() }), res));
      assert.equal(res.statusCode, 200);
    }
  } finally { mail.notify = orig; }
});

test('mail.js uses ~3 s SMTP timeouts and vercel maxDuration is 15', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'mail.js'), 'utf8');
  for (const k of ['connectionTimeout', 'greetingTimeout', 'socketTimeout']) assert.match(src, new RegExp(k + ': 3000'));
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(v.functions['api/**/*.js'].maxDuration, 15);
});

// ---------------------------------------------------------------- client IP
test('clientIp: not on Vercel, X-Forwarded-For is ignored unless TRUST_PROXY=1', async () => {
  await withEnv({ VERCEL: undefined, TRUST_PROXY: undefined }, () => {
    const req = mockReq({ headers: { 'x-forwarded-for': '9.9.9.9', 'x-real-ip': '8.8.8.8', 'x-vercel-forwarded-for': '7.7.7.7' } });
    assert.equal(clientIp(req), '127.0.0.1');
  });
  await withEnv({ VERCEL: undefined, TRUST_PROXY: '0' }, () => {
    assert.equal(clientIp(mockReq({ headers: { 'x-forwarded-for': '9.9.9.9' } })), '127.0.0.1');
  });
  await withEnv({ VERCEL: undefined, TRUST_PROXY: '1' }, () => {
    assert.equal(clientIp(mockReq({ headers: { 'x-forwarded-for': '9.9.9.9, 5.5.5.5' } })), '9.9.9.9');
    assert.equal(clientIp(mockReq({ headers: { 'x-real-ip': '8.8.8.8' } })), '127.0.0.1', 'x-real-ip is never trusted off Vercel');
  });
});

test('clientIp: on Vercel prefers x-vercel-forwarded-for, then x-real-ip; x-forwarded-for is never trusted', async () => {
  await withEnv({ VERCEL: '1', TRUST_PROXY: undefined }, () => {
    const all = { 'x-vercel-forwarded-for': '7.7.7.7, 1.1.1.1', 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '9.9.9.9, 2.2.2.2' };
    assert.equal(clientIp(mockReq({ headers: all })), '7.7.7.7');
    delete all['x-vercel-forwarded-for'];
    assert.equal(clientIp(mockReq({ headers: all })), '8.8.8.8');
    delete all['x-real-ip'];
    assert.equal(clientIp(mockReq({ headers: all })), '127.0.0.1', 'client-controlled x-forwarded-for is ignored on Vercel');
    assert.equal(clientIp(mockReq({})), '127.0.0.1');
  });
});

test('ipHash: IPv6 reduced to /64, IPv4-mapped treated as IPv4', () => {
  assert.equal(ipHash('2001:db8:abcd:12:1:2:3:4'), ipHash('2001:db8:abcd:12:ffff:eeee:dddd:cccc'));
  assert.equal(ipHash('2001:db8:abcd:12::1'), ipHash('2001:DB8:ABCD:0012:0:0:0:99'));
  assert.notEqual(ipHash('2001:db8:abcd:12::1'), ipHash('2001:db8:abcd:13::1'));
  assert.equal(ipHash('2001:db8::1'), ipHash('2001:db8:0:0:5:6:7:8'), '::-compressed expands before truncating');
  assert.equal(ipHash('::ffff:1.2.3.4'), ipHash('1.2.3.4'));
  assert.equal(ipHash('::ffff:0102:0304'), ipHash('1.2.3.4'));
  assert.notEqual(ipHash('1.2.3.4'), ipHash('1.2.3.5'));
  assert.equal(normalizeIp('::1'), '0:0:0:0::/64');
  assert.match(ipHash('2001:db8::1'), /^[0-9a-f]{64}$/);
});

test('rate limit follows the trusted client IP; spoofed X-Forwarded-For does not evade it when untrusted', async () => {
  const { resetStore } = require('../lib/store');
  process.env.ENQUIRY_DATA_FILE = path.join(path.dirname(process.env.ENQUIRY_DATA_FILE), 'ratelimit-' + Date.now() + '.json');
  resetStore(); // fresh store: earlier tests already used the 127.0.0.1 budget
  const srv = await boot();
  try {
    await withEnv({ TRUST_PROXY: undefined, VERCEL: undefined }, async () => {
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push((await postJson(srv.base, '/api/enquiry', validBody(), { 'x-forwarded-for': `203.0.113.${i + 1}` })).status);
      assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
    });
    await withEnv({ TRUST_PROXY: '1', VERCEL: undefined }, async () => {
      const codes = [];
      for (let i = 0; i < 6; i++) codes.push((await postJson(srv.base, '/api/enquiry', validBody(), { 'x-forwarded-for': '198.18.0.7' })).status);
      assert.deepEqual(codes, [200, 200, 200, 200, 200, 429]);
      assert.equal((await postJson(srv.base, '/api/enquiry', validBody(), { 'x-forwarded-for': '198.18.0.8' })).status, 200);
    });
  } finally { await srv.close(); }
});

// ---------------------------------------------------------------- body parsing
test('readJson: req.body getter that throws, or null, is bad_json', async () => {
  const thrower = mockReq({ headers: JSON_CT });
  Object.defineProperty(thrower, 'body', { get() { throw new Error('parser error'); } });
  await assert.rejects(readJson(thrower), { status: 400, code: 'bad_json' });
  const nul = mockReq({ headers: JSON_CT }); nul.body = null;
  await assert.rejects(readJson(nul), { status: 400, code: 'bad_json' });
});

test('readJson: stream is only read when body is undefined and the stream is still readable', async () => {
  const ended = mockReq({ headers: JSON_CT }); ended.readableEnded = true;
  await assert.rejects(readJson(ended), { code: 'bad_json' });
  let listened = false;
  const parsed = mockReq({ headers: JSON_CT, body: { a: 1 } });
  parsed.on = () => { listened = true; };
  assert.deepEqual(await readJson(parsed), { a: 1 });
  assert.equal(listened, false);
  for (const body of ['', '[]', '5', 'null', '"x"']) await assert.rejects(readJson(mockReq({ headers: JSON_CT, body })), { code: 'bad_json' }, JSON.stringify(body));
});

test('readJson: a stalled stream rejects after 5 s instead of hanging', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const req = mockReq({ headers: JSON_CT });
  const p = readJson(req).then(() => 'resolved', (e) => e.code);
  req.emit('data', Buffer.from('{"a":'));
  t.mock.timers.tick(4999);
  t.mock.timers.tick(2);
  assert.equal(await p, 'bad_json');
});

test('readJson: premature close/abort is bad_json', async () => {
  const req = mockReq({ headers: JSON_CT });
  const p = readJson(req).catch((e) => e.code);
  req.emit('data', Buffer.from('{'));
  req.emit('close');
  assert.equal(await p, 'bad_json');
});

test('enquiry handler: throwing req.body getter gives 400 bad_json, not 500', async () => {
  const req = mockReq({ headers: JSON_CT });
  Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Unexpected token'); } });
  const res = mockRes();
  await enquiryHandler(req, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, 'bad_json');
});

// ---------------------------------------------------------------- validation
test('email: rejects consecutive dots, leading/trailing domain dots, spaces; accepts normal addresses', () => {
  for (const e of ['a@b.co', 'a.b+c@d.e.f', 'first.last@sub-domain.example.com', 'x@a1.b2.io']) assert.equal(isEmail(e), true, e);
  for (const e of ['a..b@c.co', 'a@b..co', 'a@.b.co', 'a@b.co.', 'a@b.', 'a@b', 'a@-b.co', 'a@b-.co', 'a@b.c-', 'a b@c.co', 'a@b .co', '@b.co', 'a@@b.co', 'a@b_c.co', '..@b.co']) {
    assert.equal(isEmail(e), false, e);
    assert.ok(validateEnquiry({ ...validBody(), email: e }).errors.email, e);
  }
});

// ---------------------------------------------------------------- routing
test('server: routing is case sensitive and strict like Vercel; optional trailing slash still works', async () => {
  const srv = await boot();
  try {
    for (const p of ['/ABOUT', '/About', '/Contact', '/ADMIN', '/API/enquiry']) assert.equal((await fetch(srv.base + p)).status, 404, p);
    for (const p of ['/about/', '/contact/']) assert.equal((await fetch(srv.base + p)).status, 200, p);
  } finally { await srv.close(); }
});

test('vercel.json page rewrite allows an optional trailing slash and keeps destination "/"', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  const pages = 'about|manufacturing|innovation|products|brands|partnerships|sustainability|careers|contact|privacy|terms|code-of-conduct';
  const rs = v.rewrites.filter((x) => x.destination === '/').map((x) => x.source);
  assert.deepEqual(rs, [`/:page(${pages})`, `/:page(${pages})/`]);
  assert.ok(!v.rewrites.some((x) => /\(\.\*\)|:path\*/.test(x.source)), 'no catch-all');
});

// ---------------------------------------------------------------- fail closed through the handlers
test('production without DATABASE_URL: enquiry 503 (no memory fallback)', async () => {
  const { resetStore } = require('../lib/store');
  await quiet(() => withEnv({ NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: undefined }, async () => {
    resetStore();
    try {
      const res = mockRes();
      await enquiryHandler(mockReq({ headers: { ...JSON_CT }, body: validBody() }), res);
      assert.equal(res.statusCode, 503);
      assert.equal(res.json().code, 'unavailable');
      assert.equal(getStore().kind, 'unavailable');
    } finally { resetStore(); }
  }));
});
