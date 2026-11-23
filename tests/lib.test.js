'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, mockReq } = require('./_helpers');
setupEnv();
const { toCsv, cell } = require('../lib/csv');
const { readJson, clientIp, ipHash, HttpError } = require('../lib/http');
const { notify } = require('../lib/mail');

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
