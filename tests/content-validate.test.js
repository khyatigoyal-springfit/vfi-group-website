'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupEnv, FIXTURES } = require('./_helpers');
setupEnv();
const { validate, urlError, imageError } = require('../lib/content/validate');
const { changedSections, findUsages, same } = require('../lib/content/diff');
const defaults = require('../lib/content/defaults');

const schema = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'schema.json'), 'utf8'));
const base = () => JSON.parse(fs.readFileSync(path.join(FIXTURES, 'content.json'), 'utf8'));
const run = (mut) => { const c = base(); mut(c); return validate(c, schema); };
const err = (mut) => run(mut).errors;

test('valid fixture content passes and round-trips unchanged', () => {
  const r = validate(base(), schema);
  assert.equal(r.ok, true, JSON.stringify(r.errors));
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.value, base());
});

test('defaults loader returns independent copies of fixture content', () => {
  const a = defaults.loadDefaultContent(); a.settings.siteName = 'mutated';
  assert.equal(defaults.loadDefaultContent().settings.siteName, 'Test Co');
  assert.ok(Array.isArray(defaults.loadSchema().sections));
});

// ---------------------------------------------------------------- URLs
test('url rule: https://, /, mailto: and tel: accepted', () => {
  for (const u of ['https://example.com', 'https://example.com/a/b?c=d#e', '/', '/contact', '/about#team', 'mailto:hi@example.com', 'tel:+911234567890', 'tel:0120 4567-890']) {
    assert.equal(urlError(u), null, u);
  }
});
test('url rule: javascript:, data:, http://, protocol-relative, backslash, whitespace, credentials rejected', () => {
  for (const u of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'http://example.com', 'ftp://example.com', '//evil.com', '/\\evil.com',
    'https://exa mple.com', 'https://', 'https://user:pw@example.com', 'vbscript:x', 'example.com', 'mailto:', 'tel:abc', 'https://a.com/"onmouseover="x', '/a b']) {
    assert.ok(urlError(u), u);
  }
  for (const u of ['javascript:alert(1)', 'data:text/html;base64,AAAA', 'http://example.com/x']) {
    const e = err((c) => { c.brands[0].url = u; });
    assert.ok(e['brands[0].url'], u);
  }
});
test('image rule: /assets/ paths and the Blob host only', () => {
  for (const u of ['/assets/img/a.png', '/assets/img/brands/x-y_z.webp', 'https://abc123.public.blob.vercel-storage.com/media/uuid-logo.png']) assert.equal(imageError(u), null, u);
  for (const u of ['/other/a.png', '/assets/../secret', '/assets//x', 'http://abc.public.blob.vercel-storage.com/a.png', 'https://evil.com/a.png', 'https://public.blob.vercel-storage.com.evil.com/a.png',
    'https://evil.com/.public.blob.vercel-storage.com', 'https://abc.public.blob.vercel-storage.com@evil.com/a.png', 'https://abc.public.blob.vercel-storage.com:8443/a.png', 'data:image/png;base64,AAAA', 'javascript:alert(1)', '//cdn.evil.com/a.png', '/assets/a b.png']) {
    assert.ok(imageError(u), u);
  }
  assert.ok(err((c) => { c.hero[0].image = 'https://other.example.com/x.png'; })['hero[0].image']);
});

// ---------------------------------------------------------------- strings & boundaries
test('string caps: exactly max passes, max+1 fails (text, textarea, stringList items, default 2000)', () => {
  assert.equal(run((c) => { c.settings.siteName = 'a'.repeat(60); }).ok, true);
  assert.equal(err((c) => { c.settings.siteName = 'a'.repeat(61); })['settings.siteName'], 'Must be 60 characters or fewer');
  assert.equal(run((c) => { c.settings.tagline = 'a'.repeat(300); }).ok, true);
  assert.ok(err((c) => { c.settings.tagline = 'a'.repeat(301); })['settings.tagline']);
  assert.equal(run((c) => { c.brands[0].tags = ['a'.repeat(20)]; }).ok, true);
  assert.ok(err((c) => { c.brands[0].tags = ['ok', 'a'.repeat(21)]; })['brands[0].tags[1]']);
  assert.equal(run((c) => { c.settings.phone = 'p'.repeat(30); }).ok, true);
  assert.ok(err((c) => { c.settings.phone = 'p'.repeat(31); })['settings.phone']);
  // no max in schema -> default 2000 (url field "website")
  assert.equal(urlError('https://a.com/' + 'a'.repeat(100)), null);
  assert.ok(err((c) => { c.settings.website = 'https://a.com/' + 'a'.repeat(2000); })['settings.website']);
  assert.ok(validate({ ...base(), x: 1 }, schema).errors.x);
});
test('strings are trimmed; control characters removed; single-line fields lose newlines, textareas keep them', () => {
  const r = run((c) => { c.settings.siteName = '  Spaced  '; c.settings.tagline = ' line1\r\nline2\u0000\u0007 '; c.brands[0].name = 'a\nb\tc'; });
  assert.equal(r.ok, true);
  assert.equal(r.value.settings.siteName, 'Spaced');
  assert.equal(r.value.settings.tagline, 'line1\nline2');
  assert.equal(r.value.brands[0].name, 'a b c');
  // trimming happens before the cap
  assert.equal(run((c) => { c.settings.siteName = ' ' + 'a'.repeat(60) + ' '; }).ok, true);
});
test('script and HTML text is allowed as plain text (rendered with textContent) but never as a url', () => {
  const r = run((c) => { c.brands[0].description = '<script>alert(1)</script><img src=x onerror=alert(1)>'; });
  assert.equal(r.ok, true);
  assert.equal(r.value.brands[0].description, '<script>alert(1)</script><img src=x onerror=alert(1)>');
  assert.ok(err((c) => { c.brands[0].url = '<script>alert(1)</script>'; })['brands[0].url']);
});

// ---------------------------------------------------------------- structure
test('unknown keys are rejected at every level, with their path', () => {
  assert.equal(err((c) => { c.extra = {}; }).extra, 'Unknown section');
  assert.equal(err((c) => { c.settings.nope = 'x'; })['settings.nope'], 'Unknown field');
  assert.equal(err((c) => { c.brands[1].colour = 'red'; })['brands[1].colour'], 'Unknown field');
  assert.equal(err((c) => { c.hero[0].cta.extra = 1; })['hero[0].cta.extra'], 'Unknown field');
  assert.equal(err((c) => { c.scale.figures[1].bogus = 1; })['scale.figures[1].bogus'], 'Unknown field');
  assert.ok(validate(JSON.parse('{"settings":{"siteName":"a","website":"https://a.com","__proto__":{"x":1}}}'), schema).errors['settings.__proto__']);
  assert.equal({}.polluted, undefined);
});
test('required fields: missing, empty and whitespace-only values are errors; missing sections too', () => {
  assert.equal(err((c) => { delete c.settings.siteName; })['settings.siteName'], 'This field is required');
  assert.equal(err((c) => { c.settings.siteName = '   '; })['settings.siteName'], 'This field is required');
  assert.equal(err((c) => { c.brands[0].name = null; })['brands[0].name'], 'This field is required');
  assert.ok(err((c) => { delete c.hero[1].image; })['hero[1].image']);
  assert.equal(err((c) => { delete c.brands; }).brands, 'This section is required');
  assert.equal(err((c) => { c.scale.figures = []; })['scale.figures'], 'Add at least one item');
  assert.equal(run((c) => { c.brands = []; }).ok, true, 'an optional list may be emptied');
  assert.equal(run((c) => { delete c.settings.phone; }).ok, true, 'optional fields may be absent');
});
test('wrong types are rejected with field paths', () => {
  assert.ok(err((c) => { c.settings.siteName = 5; })['settings.siteName']);
  assert.ok(err((c) => { c.settings = 'text'; }).settings);
  assert.ok(err((c) => { c.settings = []; }).settings);
  assert.ok(err((c) => { c.brands = {}; }).brands);
  assert.ok(err((c) => { c.brands[0] = 'x'; })['brands[0]']);
  assert.ok(err((c) => { c.brands[0].tags = 'a,b'; })['brands[0].tags']);
  assert.ok(err((c) => { c.brands[0].tags = [1]; })['brands[0].tags[0]']);
  assert.ok(err((c) => { c.scale.figures[0].value = '40'; })['scale.figures[0].value']);
  assert.ok(err((c) => { c.scale.figures[0].value = NaN; })['scale.figures[0].value']);
  assert.ok(err((c) => { c.hero[0].cta = 'x'; })['hero[0].cta']);
  assert.equal(validate(null, schema).ok, false);
  assert.equal(validate([], schema).ok, false);
  assert.equal(validate('x', schema).ok, false);
});
test('numbers: min and max bounds, finite only', () => {
  assert.equal(run((c) => { c.scale.figures[0].value = 0; }).ok, true);
  assert.equal(run((c) => { c.scale.figures[0].value = 100000; }).ok, true);
  assert.ok(err((c) => { c.scale.figures[0].value = 100001; })['scale.figures[0].value']);
  assert.ok(err((c) => { c.scale.figures[0].value = -1; })['scale.figures[0].value']);
  assert.ok(err((c) => { c.scale.figures[0].value = Infinity; })['scale.figures[0].value']);
});
test('select: only listed options (strings or {value,label})', () => {
  for (const v of ['a', 'b', 'c']) assert.equal(run((c) => { c.hero[0].tier = v; }).ok, true, v);
  for (const v of ['d', 'A', 1, '']) assert.ok(err((c) => { c.hero[0].tier = v; })['hero[0].tier'], String(v));
});
test('list limits: at most 500 items; stringList at most 200', () => {
  assert.equal(run((c) => { c.brands = Array.from({ length: 500 }, (_, i) => ({ name: 'B' + i })); }).ok, true);
  assert.ok(err((c) => { c.brands = Array.from({ length: 501 }, (_, i) => ({ name: 'B' + i })); }).brands);
  assert.equal(run((c) => { c.brands[0].tags = Array.from({ length: 200 }, (_, i) => 't' + i); }).ok, true);
  assert.ok(err((c) => { c.brands[0].tags = Array.from({ length: 201 }, (_, i) => 't' + i); })['brands[0].tags']);
});
test('error paths use section[index].field and match schema keys; several errors are all reported', () => {
  const e = err((c) => { c.brands[3] = { name: '', url: 'http://x' }; c.brands[2] = { name: 'ok' }; c.hero[1].cta.href = 'javascript:x'; delete c.settings.siteName; });
  assert.deepEqual(Object.keys(e).sort(), ['brands[3].name', 'brands[3].url', 'hero[1].cta.href', 'settings.siteName'].sort());
  const keys = new Set(['settings', 'hero', 'brands', 'scale', 'texts']);
  for (const k of Object.keys(e)) assert.ok(keys.has(k.split(/[.[]/)[0]), k);
  assert.ok(validate({ ...base(), texts: { 'home.title': 'x'.repeat(101) } }, schema).errors['texts.home.title']);
});

// ---------------------------------------------------------------- size cap
test('size: 512 KB accepted, one byte more rejected (before any field is read)', () => {
  const fill = (bytes) => { const c = base(); c.junk = ''; const n = bytes - Buffer.byteLength(JSON.stringify(c)); c.junk = 'x'.repeat(n); return c; };
  const exact = fill(512 * 1024);
  const len = Buffer.byteLength(JSON.stringify(exact));
  assert.equal(len, 512 * 1024, 'fixture sized to exactly 512 KB');
  const atLimit = validate(exact, schema);
  assert.ok(!atLimit.errors.content, 'at the limit the size rule does not fire (unknown key is the only error)');
  const over = fill(512 * 1024 + 1);
  assert.equal(Buffer.byteLength(JSON.stringify(over)), 512 * 1024 + 1);
  const r = validate(over, schema);
  assert.equal(r.ok, false);
  assert.match(r.errors.content, /too large/);
  assert.deepEqual(Object.keys(r.errors), ['content']);
  assert.equal(validate({ big: 'é'.repeat(300 * 1024) }, schema).errors.content.includes('too large'), true, 'size is measured in bytes, not characters');
});

// ---------------------------------------------------------------- diff
test('diff: changedSections ignores key order; findUsages returns field paths', () => {
  const a = base(); const b = base();
  b.settings = { tagline: a.settings.tagline, phone: a.settings.phone, website: a.settings.website, siteName: a.settings.siteName };
  assert.deepEqual(changedSections(a, b), []);
  b.brands[1].name = 'Changed'; b.texts['home.title'] = 'X';
  assert.deepEqual(changedSections(a, b), ['brands', 'texts']);
  delete b.scale;
  assert.deepEqual(changedSections(a, b), ['brands', 'scale', 'texts']);
  assert.deepEqual(changedSections(null, {}), []);
  assert.equal(same({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 }), true);
  assert.equal(same([1, 2], [2, 1]), false);
  const c = base(); c.brands[1].logo = c.brands[0].logo; c.hero[0].image = c.brands[0].logo;
  assert.deepEqual(findUsages(c, c.brands[0].logo).sort(), ['brands[0].logo', 'brands[1].logo', 'hero[0].image'].sort());
  assert.deepEqual(findUsages(c, 'https://nowhere'), []);
  assert.deepEqual(findUsages(c, 'https://x'), []);
});

// ---------------------------------------------------------------- real files
test('the real public/content/default.json validates clean against public/admin/content-schema.json (skipped until both exist)', (t) => {
  const root = path.join(__dirname, '..', 'public');
  const cf = path.join(root, 'content', 'default.json'); const sf = path.join(root, 'admin', 'content-schema.json');
  if (!fs.existsSync(cf) || !fs.existsSync(sf)) return t.skip('default.json / content-schema.json not present yet');
  const content = JSON.parse(fs.readFileSync(cf, 'utf8'));
  const sch = JSON.parse(fs.readFileSync(sf, 'utf8'));
  const r = validate(content, sch);
  assert.deepEqual(r.errors, {});
  assert.deepEqual(r.value, content, 'validation does not alter the defaults');
  assert.ok(Buffer.byteLength(JSON.stringify(content)) < 512 * 1024);
});
