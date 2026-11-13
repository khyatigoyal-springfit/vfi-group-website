'use strict';
// Regression tests for the security/QA hardening pass.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupEnv, validBody, boot, postJson, mockReq, mockRes } = require('./_helpers');
setupEnv();
const { readJson, clientIp, ipHash, normalizeIp } = require('../lib/http');
const session = require('../lib/session');
const mail = require('../lib/mail');
const { getStore } = require('../lib/store');
const { isEmail, validateEnquiry } = require('../lib/validate');
const enquiryHandler = require('../api/enquiry');
const adminHandler = require('../api/admin/[action]');

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

test('clientIp: on Vercel prefers x-vercel-forwarded-for, then x-real-ip, then first x-forwarded-for hop', async () => {
  await withEnv({ VERCEL: '1', TRUST_PROXY: undefined }, () => {
    const all = { 'x-vercel-forwarded-for': '7.7.7.7, 1.1.1.1', 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '9.9.9.9, 2.2.2.2' };
    assert.equal(clientIp(mockReq({ headers: all })), '7.7.7.7');
    delete all['x-vercel-forwarded-for'];
    assert.equal(clientIp(mockReq({ headers: all })), '8.8.8.8');
    delete all['x-real-ip'];
    assert.equal(clientIp(mockReq({ headers: all })), '9.9.9.9');
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

// ---------------------------------------------------------------- sessions
test('session: v claim round-trips and a mismatching/missing v is rejected', () => {
  const S = 's'.repeat(40);
  const v = session.versionClaim(S, 'a long enough password');
  assert.match(v, /^[0-9a-f]{16}$/);
  assert.notEqual(v, session.versionClaim(S, 'another long password'));
  const tok = session.sign(S, 1000, 60, v);
  assert.equal(session.verify(tok, S, 2000, v).v, v);
  assert.equal(session.verify(tok, S, 2000, session.versionClaim(S, 'another long password')), null);
  assert.equal(session.verify(session.sign(S, 1000, 60), S, 2000, v), null, 'token without v');
});

async function adminLogin() {
  const res = mockRes();
  await adminHandler(mockReq({ query: { action: 'login' }, headers: { ...JSON_CT, ...CSRF }, body: { password: process.env.ADMIN_PASSWORD } }), res);
  return res;
}

test('admin: refuses to be configured with short SESSION_SECRET (<32) or ADMIN_PASSWORD (<12)', async () => {
  await quiet(async () => {
    for (const [k, val] of [['SESSION_SECRET', 'x'.repeat(31)], ['ADMIN_PASSWORD', 'x'.repeat(11)]]) {
      await withEnv({ [k]: val }, async () => {
        const res = await adminLogin();
        assert.equal(res.statusCode, 503, k);
        assert.equal(res.json().code, 'admin_not_configured');
        assert.equal(res.getHeader('set-cookie'), undefined);
      });
    }
    await withEnv({ SESSION_SECRET: 'x'.repeat(32), ADMIN_PASSWORD: 'x'.repeat(12) }, async () => {
      assert.equal((await adminLogin()).statusCode, 200);
    });
  });
});

test('admin: changing ADMIN_PASSWORD or SESSION_SECRET logs out existing sessions', async () => {
  const sessionState = async (cookie) => {
    const res = mockRes();
    await adminHandler(mockReq({ method: 'GET', query: { action: 'session' }, headers: { cookie } }), res);
    return res.json().authenticated;
  };
  const lres = await adminLogin();
  assert.equal(lres.statusCode, 200);
  const cookie = lres.getHeader('set-cookie').split(';')[0];
  const payload = JSON.parse(Buffer.from(cookie.split('=')[1].split('.')[0], 'base64url').toString());
  assert.match(payload.v, /^[0-9a-f]{16}$/);
  assert.equal(await sessionState(cookie), true);
  await withEnv({ ADMIN_PASSWORD: 'a brand new password' }, async () => assert.equal(await sessionState(cookie), false));
  await withEnv({ SESSION_SECRET: 'z'.repeat(40) }, async () => assert.equal(await sessionState(cookie), false));
  assert.equal(await sessionState(cookie), true);
});

// ---------------------------------------------------------------- validation
test('email: rejects consecutive dots, leading/trailing domain dots, spaces; accepts normal addresses', () => {
  for (const e of ['a@b.co', 'a.b+c@d.e.f', 'first.last@sub-domain.example.com', 'x@a1.b2.io']) assert.equal(isEmail(e), true, e);
  for (const e of ['a..b@c.co', 'a@b..co', 'a@.b.co', 'a@b.co.', 'a@b.', 'a@b', 'a@-b.co', 'a@b-.co', 'a@b.c-', 'a b@c.co', 'a@b .co', '@b.co', 'a@@b.co', 'a@b_c.co', '..@b.co']) {
    assert.equal(isEmail(e), false, e);
    assert.ok(validateEnquiry({ ...validBody(), email: e }).errors.email, e);
  }
});

test('migration 0002: hardened submit_enquiry, strict email, \\r stripping, export cap, grants', () => {
  const dir = path.join(__dirname, '..', 'supabase', 'migrations');
  const sql = fs.readFileSync(path.join(dir, '0002_harden_submit.sql'), 'utf8');
  assert.match(sql, /drop function if exists public\.submit_enquiry\(jsonb\)/);
  assert.match(sql, /create or replace function public\.submit_enquiry\(p_secret text, p jsonb\)/);
  assert.match(sql, /perform private\.assert_admin\(p_secret\)/);
  assert.match(sql, /if v_ip = '' then\s+raise exception 'invalid_input' using errcode = '22023'/);
  assert.ok(sql.includes('[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$'));
  assert.match(sql, /strpos\(v_email, '\.\.'\) > 0/);
  assert.match(sql, /\\x0B-\\x1F/, '\\r (0x0D) is inside the stripped range');
  assert.match(sql, /limit 2000/);
  assert.ok(!/limit 5000/.test(sql));
  assert.match(sql, /revoke all on function public\.submit_enquiry\(text, jsonb\) from public, anon, authenticated/);
  assert.match(sql, /grant execute on function public\.submit_enquiry\(text, jsonb\) to anon/);
  assert.ok(!/app_secrets/i.test(sql), 'no secrets in the migration');
  assert.ok(fs.readFileSync(path.join(dir, '0001_init.sql'), 'utf8').includes('submit_enquiry(p jsonb)'), '0001 left untouched');
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
  const r = v.rewrites.find((x) => x.destination === '/');
  assert.equal(r.source, '/(about|manufacturing|innovation|products|brands|partnerships|sustainability|careers|contact|privacy|terms|code-of-conduct)/?');
  assert.ok(!v.rewrites.some((x) => /\(\.\*\)|:path\*/.test(x.source)), 'no catch-all');
});

// ---------------------------------------------------------------- fail closed through the handlers
test('production without Supabase config: enquiry 503 (no memory fallback)', async () => {
  const { resetStore } = require('../lib/store');
  await quiet(() => withEnv({ NODE_ENV: 'production', VERCEL: '1', SUPABASE_URL: undefined, SUPABASE_ANON_KEY: undefined }, async () => {
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
