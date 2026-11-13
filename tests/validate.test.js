'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnquiry, TYPES, VOLUMES } = require('../lib/validate');

const good = { type: 'Hospitality', name: 'A', company: 'C', email: 'a@b.co', country: '', volume: '', msg: 'hi', page: '/x' };

test('valid body maps msg->message and page->source_page', () => {
  const r = validateEnquiry(good);
  assert.equal(r.ok, true);
  assert.deepEqual(r.errors, {});
  assert.equal(r.value.message, 'hi');
  assert.equal(r.value.source_page, '/x');
  assert.equal('msg' in r.value, false);
});

test('required fields give friendly messages', () => {
  const r = validateEnquiry({});
  assert.equal(r.ok, false);
  assert.equal(r.errors.name, 'Enter your full name');
  assert.equal(r.errors.company, 'Enter your company name');
  assert.ok(r.errors.email);
  assert.ok(r.errors.message);
  assert.equal(Object.keys(r.errors).length, 4);
});

test('non-object body is handled', () => {
  for (const b of [null, undefined, 'x', 5, []]) assert.equal(validateEnquiry(b).ok, false);
});

test('boundary lengths: name 120, company 160, email 200, country 80, message 5000, page 200', () => {
  const email = (n) => 'a'.repeat(n - 8) + '@b.co.in'; // exactly n chars
  assert.equal(email(200).length, 200);
  const ok = validateEnquiry({ ...good, name: 'n'.repeat(120), company: 'c'.repeat(160), email: email(200), country: 'k'.repeat(80), msg: 'm'.repeat(5000), page: 'p'.repeat(200) });
  assert.deepEqual(ok.errors, {});
  const bad = validateEnquiry({ ...good, name: 'n'.repeat(121), company: 'c'.repeat(161), email: email(201), country: 'k'.repeat(81), msg: 'm'.repeat(5001), page: 'p'.repeat(201) });
  assert.deepEqual(Object.keys(bad.errors).sort(), ['company', 'country', 'email', 'message', 'name', 'page']);
});

test('values are trimmed before length checks', () => {
  assert.equal(validateEnquiry({ ...good, name: '  ' + 'n'.repeat(120) + '  ' }).ok, true);
  assert.equal(validateEnquiry({ ...good, name: '   ' }).errors.name, 'Enter your full name');
});

test('email regex', () => {
  for (const e of ['a@b.co', 'a.b+c@d.e.f']) assert.equal(validateEnquiry({ ...good, email: e }).ok, true, e);
  for (const e of ['abc', 'a@b', 'a b@c.de', '@b.co', 'a@@b.co', 'a@b.']) assert.ok(validateEnquiry({ ...good, email: e }).errors.email, e);
});

test('unknown type falls back to Other; all whitelisted types accepted', () => {
  assert.equal(validateEnquiry({ ...good, type: 'Hacking' }).value.type, 'Other');
  assert.equal(validateEnquiry({ ...good, type: undefined }).value.type, 'Other');
  for (const t of TYPES) assert.equal(validateEnquiry({ ...good, type: t }).value.type, t);
});

test('volume whitelist; unknown volume becomes empty', () => {
  assert.equal(validateEnquiry({ ...good, volume: 'Lots' }).value.volume, '');
  for (const v of VOLUMES) assert.equal(validateEnquiry({ ...good, volume: v }).value.volume, v);
});

test('control chars stripped, newlines kept only in message', () => {
  const r = validateEnquiry({ ...good, name: 'A\u0000\u0007B\nC\tD', msg: 'line1\nline2\ttab\u0001\u007f' });
  assert.equal(r.value.name, 'AB C D');
  assert.equal(r.value.message, 'line1\nline2\ttab');
});

test('non-string values do not crash', () => {
  const r = validateEnquiry({ ...good, name: { a: 1 }, company: ['x'], email: 5, msg: null });
  assert.equal(r.ok, false);
  assert.ok(r.errors.name && r.errors.company && r.errors.email && r.errors.message);
});
