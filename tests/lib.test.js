'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, mockReq } = require('./_helpers');
setupEnv();
const session = require('../lib/session');
const { toCsv, cell } = require('../lib/csv');
const { createLimiter } = require('../lib/ratelimit');
const { readJson, clientIp, ipHash, HttpError } = require('../lib/http');
const { notify } = require('../lib/mail');

const S = 'secret-key';

test('session: sign/verify round trip', () => {
  const v = session.sign(S, 1000, 60);
  assert.deepEqual(session.verify(v, S, 2000), { exp: 61000 });
});

test('session: tampered signature, altered payload, expired, garbage, wrong secret all fail', () => {
  const v = session.sign(S, 1000, 60);
  const [p, sig] = v.split('.');
  assert.equal(session.verify(p + '.' + sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA'), S, 2000), null);
  const forged = Buffer.from(JSON.stringify({ exp: 9e15 })).toString('base64url');
  assert.equal(session.verify(forged + '.' + sig, S, 2000), null);
  assert.equal(session.verify(v, S, 61001), null, 'expired');
  assert.equal(session.verify(v, 'other', 2000), null, 'wrong secret');
  for (const g of ['', 'a', 'a.b', 'a.b.c', '.', '..', 'x'.repeat(600), null, undefined, 5, '{}.{}']) assert.equal(session.verify(g, S, 2000), null, String(g));
  assert.equal(session.verify(v, '', 2000), null, 'empty secret');
});

test('session: cookie attributes', () => {
  const c = session.cookieString('abc', 43200, true);
  for (const part of ['vfi_admin=abc', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=43200', 'Secure']) assert.ok(c.includes(part), part);
  assert.ok(!session.cookieString('abc', 1, false).includes('Secure'));
});

test('session: Secure omitted only for non-production localhost', () => {
  const old = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    assert.equal(session.isSecure({ headers: { host: 'localhost:3000' } }), false);
    assert.equal(session.isSecure({ headers: { host: '127.0.0.1:3000' } }), false);
    assert.equal(session.isSecure({ headers: { host: 'example.com' } }), true);
    process.env.NODE_ENV = 'production';
    assert.equal(session.isSecure({ headers: { host: 'localhost:3000' } }), true);
  } finally { if (old === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = old; }
});

test('session: parseCookies', () => {
  assert.deepEqual(session.parseCookies('a=1; vfi_admin=x.y; b=c=d'), { a: '1', vfi_admin: 'x.y', b: 'c=d' });
  assert.deepEqual(session.parseCookies(undefined), {});
});

test('csv: BOM, CRLF, quoting round trip', () => {
  const out = toCsv([{ ref: 'R1', name: 'Smith, "Bob"', message: 'line1\nline2' }], ['ref', 'name', 'message']);
  assert.ok(out.startsWith('﻿'));
  assert.equal(out, '﻿ref,name,message\r\nR1,"Smith, ""Bob""","line1\nline2"\r\n');
});

test('csv: injection guard', () => {
  assert.equal(cell('=1+1'), "'=1+1");
  for (const s of ['+1', '-1', '@x', '\tx', '\rx']) assert.ok(cell(s).startsWith("'") || cell(s).startsWith('"\''), s);
  assert.equal(cell('a=b'), 'a=b');
  assert.equal(cell(null), '');
});

test('ratelimit: sliding window', () => {
  const l = createLimiter({ max: 3, windowMs: 1000 });
  l.hit('k', 0); l.hit('k', 100);
  assert.equal(l.isLimited('k', 200), false);
  l.hit('k', 300);
  assert.equal(l.isLimited('k', 400), true);
  assert.equal(l.isLimited('other', 400), false);
  assert.equal(l.isLimited('k', 1250), false, 'old hits expired');
  l.hit('k', 1300); l.hit('k', 1301); l.hit('k', 1302);
  l.reset('k');
  assert.equal(l.isLimited('k', 1303), false);
});

test('http.readJson: object, string and Buffer bodies; errors', async () => {
  const h = { 'content-type': 'application/json; charset=utf-8' };
  assert.deepEqual(await readJson(mockReq({ headers: h, body: { a: 1 } })), { a: 1 });
  assert.deepEqual(await readJson(mockReq({ headers: h, body: '{"a":2}' })), { a: 2 });
  assert.deepEqual(await readJson(mockReq({ headers: h, body: Buffer.from('{"a":3}') })), { a: 3 });
  const code = async (req) => { try { await readJson(req); } catch (e) { assert.ok(e instanceof HttpError); return e.code; } return 'none'; };
  assert.equal(await code(mockReq({ headers: { 'content-type': 'text/plain' }, body: '{}' })), 'unsupported_media');
  assert.equal(await code(mockReq({ headers: {}, body: '{}' })), 'unsupported_media');
  assert.equal(await code(mockReq({ headers: h, body: '{nope' })), 'bad_json');
  assert.equal(await code(mockReq({ headers: h, body: '[1]' })), 'bad_json');
  assert.equal(await code(mockReq({ headers: h, body: '"s"' })), 'bad_json');
  assert.equal(await code(mockReq({ headers: h, body: 'x'.repeat(40000) })), 'too_large');
  assert.equal(await code(mockReq({ headers: h, body: { a: 'x'.repeat(40000) } })), 'too_large');
});

test('http.readJson: raw stream body', async () => {
  const req = mockReq({ headers: { 'content-type': 'application/json' } });
  const p = readJson(req);
  req.emit('data', Buffer.from('{"a":'));
  req.emit('data', Buffer.from('4}'));
  req.emit('end');
  assert.deepEqual(await p, { a: 4 });
  const big = mockReq({ headers: { 'content-type': 'application/json' } });
  const q = readJson(big, 10).catch((e) => e.code);
  big.emit('data', Buffer.alloc(50, 97));
  big.emit('end');
  assert.equal(await q, 'too_large');
});

test('http: clientIp first hop, ipHash is salted HMAC and never the raw ip', () => {
  assert.equal(clientIp(mockReq({ headers: { 'x-forwarded-for': '1.2.3.4, 5.6.7.8' } })), '1.2.3.4');
  assert.equal(clientIp(mockReq({})), '127.0.0.1');
  const h = ipHash('1.2.3.4');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.ok(!h.includes('1.2.3.4'));
  const old = process.env.IP_SALT;
  process.env.IP_SALT = 'different';
  assert.notEqual(ipHash('1.2.3.4'), h);
  process.env.IP_SALT = old;
});

test('mail.notify never throws and returns false without SMTP', async () => {
  assert.equal(await notify({ ref: 'R' }), false);
  process.env.SMTP_HOST = '127.0.0.1'; process.env.SMTP_PORT = '1'; process.env.ENQUIRY_TO = 'x@example.com';
  const orig = console.error; console.error = () => {};
  try { assert.equal(await notify({ ref: 'R', name: 'n', company: 'c', email: 'e@x.co', type: 'Other', message: 'm' }), false); }
  finally { console.error = orig; delete process.env.SMTP_HOST; delete process.env.ENQUIRY_TO; delete process.env.SMTP_PORT; }
});
