'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, boot, client, makeUser, PNG_1x1, jpegOf, webpOf, fakeUploader } = require('./_helpers');
setupEnv();
const media = require('../lib/media');
const { getStore } = require('../lib/store');

let srv; let store; let ed; let sales; let fake;
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
test.before(async () => {
  srv = await boot(); store = getStore();
  const e = await makeUser(store, { email: 'media-ed@example.com', role: 'editor', name: 'Mia' });
  const s = await makeUser(store, { email: 'media-sales@example.com', role: 'sales' });
  ed = client(srv.base); sales = client(srv.base);
  await ed.login(e.email); await sales.login(s.email);
});
test.beforeEach(() => { fake = fakeUploader(); media.setUploader(fake); });
test.after(async () => { media.setUploader(null); await srv.close(); });

const upload = (c, buf, type = 'image/png', name = 'logo.png', extra = {}) =>
  c.req('POST', '/api/admin/media', { raw: buf, headers: { 'content-type': type, ...(name === null ? {} : { 'x-filename': name }), ...extra } });

// ---------------------------------------------------------------- unit: magic bytes, names, sizes
test('sniff: PNG, JPEG, WebP by magic bytes; SVG, HTML, EXE, GIF, short and empty buffers are null', () => {
  assert.equal(media.sniff(PNG_1x1), 'png');
  assert.equal(media.sniff(jpegOf(40, 30)), 'jpeg');
  assert.equal(media.sniff(webpOf(40, 30)), 'webp');
  for (const b of ['<svg xmlns="http://www.w3.org/2000/svg"></svg>', '<!doctype html><script>alert(1)</script>', 'MZ\u0090\u0000\u0003\u0000\u0000\u0000\u0004\u0000\u0000\u0000', 'GIF89a\u0001\u0000\u0001\u0000\u0000\u0000\u0000;', 'short']) assert.equal(media.sniff(Buffer.from(b, 'latin1')), null, b.slice(0, 12));
  assert.equal(media.sniff(Buffer.alloc(0)), null);
  assert.equal(media.sniff(null), null);
  assert.equal(media.sniff(Buffer.concat([Buffer.from('RIFF....WAVE', 'latin1'), Buffer.alloc(20)])), null, 'RIFF but not WebP');
});
test('dimensions are read from PNG, JPEG and WebP headers', () => {
  assert.deepEqual(media.dimensions(PNG_1x1, 'png'), { width: 1, height: 1 });
  assert.deepEqual(media.dimensions(jpegOf(640, 480), 'jpeg'), { width: 640, height: 480 });
  assert.deepEqual(media.dimensions(webpOf(1200, 800), 'webp'), { width: 1200, height: 800 });
  assert.deepEqual(media.dimensions(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(20)]), 'jpeg'), { width: null, height: null });
});
test('safeSlug: directories, extensions, traversal, unicode, control characters and length are neutralised', () => {
  const cases = [
    ['../../etc/passwd', 'passwd'], ['..\\..\\windows\\system32\\evil.png', 'evil'], ['/abs/path/logo.PNG', 'logo'], ['My Logo (final) v2.jpeg', 'my-logo-final-v2'],
    ['%2e%2e%2fsecret.png', 'secret'], ['café ñandú.webp', 'cafe-nandu'], ['logo.png.exe', 'logo-png'], ['', 'image'], [undefined, 'image'], ['....', 'image'], ['<script>.png', 'script'],
    ['a\u0000b\nc.png', 'a-b-c'], ['x'.repeat(200) + '.png', 'x'.repeat(60)], ['%E0%A4%A', 'e0-a4-a'],
  ];
  for (const [input, expected] of cases) assert.equal(media.safeSlug(input), expected, JSON.stringify(input));
});
test('inspectUpload: type must be declared AND real; size limit 4 MB exactly', () => {
  assert.equal(media.inspectUpload(PNG_1x1, 'image/png', 'a.png').ok, true);
  assert.equal(media.inspectUpload(PNG_1x1, 'IMAGE/PNG; charset=binary', 'a').ok, true);
  assert.equal(media.inspectUpload(jpegOf(10, 10), 'image/jpeg', 'a.jpg').contentType, 'image/jpeg');
  assert.equal(media.inspectUpload(PNG_1x1, 'image/jpeg', 'a.jpg').code, 'type_mismatch');
  for (const t of ['image/svg+xml', 'image/gif', 'text/html', 'application/octet-stream', '', undefined, 'application/pdf']) assert.equal(media.inspectUpload(PNG_1x1, t, 'a.png').code, 'unsupported_type', String(t));
  assert.match(media.inspectUpload(Buffer.from('<svg/>'), 'image/svg+xml').error, /SVG/);
  const fakeExe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(100)]);
  assert.equal(media.inspectUpload(fakeExe, 'image/png', 'virus.png').code, 'unsupported_type');
  assert.equal(media.inspectUpload(Buffer.alloc(0), 'image/png').code, 'empty_body');
  const ok = Buffer.concat([PNG_1x1, Buffer.alloc(media.MAX_BYTES - PNG_1x1.length)]);
  assert.equal(ok.length, 4 * 1024 * 1024);
  assert.equal(media.inspectUpload(ok, 'image/png', 'big.png').ok, true);
  const tooBig = media.inspectUpload(Buffer.concat([ok, Buffer.alloc(1)]), 'image/png', 'big.png');
  assert.equal(tooBig.ok, false); assert.equal(tooBig.status, 413);
});
test('pathname is media/<uuid>-<slug>.<ext>, extension from the detected type, never from the file name', () => {
  const info = media.inspectUpload(PNG_1x1, 'image/png', '../../evil.php');
  assert.match(media.newPathname(info), /^media\/[0-9a-f-]{36}-evil\.png$/);
  assert.notEqual(media.newPathname(info), media.newPathname(info));
});

// ---------------------------------------------------------------- API
test('upload: PNG, JPEG and WebP are stored via the uploader and recorded with size, dimensions, alt and uploader', async () => {
  for (const [buf, type, ext, w, h] of [[PNG_1x1, 'image/png', 'png', 1, 1], [jpegOf(640, 480), 'image/jpeg', 'jpg', 640, 480], [webpOf(300, 200), 'image/webp', 'webp', 300, 200]]) {
    const r = await upload(ed, buf, type, 'My Photo.' + ext, { 'x-alt': encodeURIComponent('A nice photo') });
    assert.equal(r.status, 200, type);
    const j = await r.json();
    assert.match(j.media.pathname, new RegExp(`^media/[0-9a-f-]{36}-my-photo\\.${ext}$`));
    assert.equal(j.media.url, `https://fake123.public.blob.vercel-storage.com/${j.media.pathname}`);
    assert.equal(j.media.content_type, type); assert.equal(j.media.size, buf.length);
    assert.equal(j.media.width, w); assert.equal(j.media.height, h);
    assert.equal(j.media.alt, 'A nice photo');
    assert.ok(j.media.uploaded_by);
  }
  assert.equal(fake.calls.put.length, 3);
  assert.equal(fake.calls.put[0].contentType, 'image/png');
  assert.equal((await (await ed.get('/api/admin/media')).json()).total >= 3, true);
});

test('upload: SVG, HTML, EXE and mislabelled files are refused (415) and never reach the uploader', async () => {
  const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
  const html = Buffer.from('<html><body><script>alert(1)</script></body></html>');
  const exe = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(300)]);
  for (const [buf, type, name] of [[svg, 'image/svg+xml', 'x.svg'], [svg, 'image/png', 'x.png'], [html, 'image/png', 'evil.html.png'], [exe, 'image/png', 'virus.exe'], [exe, 'image/jpeg', 'virus.jpg'],
    [PNG_1x1, 'image/jpeg', 'lie.jpg'], [PNG_1x1, 'text/html', 'x.png'], [PNG_1x1, 'image/gif', 'x.gif'], [PNG_1x1, 'application/pdf', 'x.pdf']]) {
    const r = await upload(ed, buf, type, name);
    assert.equal(r.status, 415, `${type} ${name}`);
    assert.ok((await r.json()).error);
  }
  assert.equal((await upload(ed, Buffer.alloc(0), 'image/png')).status, 400);
  assert.equal(fake.calls.put.length, 0);
});

test('upload: 4 MB accepted, 4 MB + 1 byte rejected with 413', async () => {
  const pad = (n) => Buffer.concat([PNG_1x1, Buffer.alloc(n - PNG_1x1.length)]);
  const ok = await upload(ed, pad(4 * 1024 * 1024), 'image/png', 'max.png');
  assert.equal(ok.status, 200);
  const big = await upload(ed, pad(4 * 1024 * 1024 + 1), 'image/png', 'max.png');
  assert.equal(big.status, 413);
  assert.equal((await big.json()).code, 'too_large');
  assert.equal(fake.calls.put.length, 1);
});

test('upload: path traversal and odd characters in X-Filename are neutralised in the stored path', async () => {
  for (const name of ['../../etc/passwd', '..%2F..%2Fboot.ini', 'a/b\\c/../../d.png', '%00evil.png', null]) {
    const r = await upload(ed, PNG_1x1, 'image/png', name);
    assert.equal(r.status, 200, String(name));
    const p = (await r.json()).media.pathname;
    assert.match(p, /^media\/[0-9a-f-]{36}-[a-z0-9-]+\.png$/, p);
    assert.ok(!p.includes('..') && !p.includes('\\') && p.split('/').length === 2);
  }
});

test('upload: needs the editor role, the CSRF header and a configured Blob store; the rest of admin keeps working without one', async () => {
  assert.equal((await upload(sales, PNG_1x1)).status, 403);
  assert.equal((await client(srv.base).req('POST', '/api/admin/media', { raw: PNG_1x1, headers: { 'content-type': 'image/png' } })).status, 401);
  assert.equal((await ed.req('POST', '/api/admin/media', { raw: PNG_1x1, csrf: false, headers: { 'content-type': 'image/png' } })).status, 403);
  media.setUploader(null);
  assert.equal(process.env.BLOB_READ_WRITE_TOKEN, undefined);
  const r = await upload(ed, PNG_1x1);
  assert.equal(r.status, 503);
  assert.equal((await r.json()).code, 'media_not_configured');
  assert.equal((await ed.del('/api/admin/media?id=00000000-0000-4000-8000-000000000000')).status, 503);
  assert.equal((await ed.get('/api/admin/media')).status, 200, 'listing still works');
  assert.equal((await ed.get('/api/admin/content')).status, 200, 'content editing unaffected');
  assert.equal((await ed.get('/api/admin/enquiries')).status, 200);
});

test('upload: a Blob failure gives 502 and records nothing; a database failure after upload removes the blob again', async () => {
  const before = (await store.listMedia({})).total;
  fake.failPut = true;
  await quiet(async () => {
    const r = await upload(ed, PNG_1x1);
    assert.equal(r.status, 502);
    assert.equal((await r.json()).code, 'upload_failed');
  });
  fake.failPut = false;
  const orig = store.addMedia;
  store.addMedia = async () => { const e = new Error('db'); e.code = 'unavailable'; throw e; };
  try {
    await quiet(async () => { assert.equal((await upload(ed, PNG_1x1)).status, 503); });
    assert.equal(fake.calls.del.length, 1, 'orphaned blob cleaned up');
  } finally { store.addMedia = orig; }
  assert.equal((await store.listMedia({})).total, before);
});

test('alt text: PATCH media updates it (validated)', async () => {
  const m = (await (await upload(ed, PNG_1x1, 'image/png', 'alt.png')).json()).media;
  const r = await ed.patch('/api/admin/media', { id: m.id, alt: 'Company logo' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).media.alt, 'Company logo');
  assert.equal((await ed.patch('/api/admin/media', { id: m.id, alt: 'x'.repeat(201) })).status, 422);
  assert.equal((await ed.patch('/api/admin/media', { id: 'nope', alt: 'x' })).status, 422);
  assert.equal((await ed.patch('/api/admin/media', { id: '00000000-0000-4000-8000-000000000000', alt: 'x' })).status, 404);
});

test('media list is paged', async () => {
  const j = await (await ed.get('/api/admin/media?pageSize=2&page=1')).json();
  assert.equal(j.rows.length, 2); assert.equal(j.pageSize, 2); assert.ok(j.total > 2);
  const j2 = await (await ed.get('/api/admin/media?pageSize=2&page=2')).json();
  assert.notEqual(j2.rows[0].id, j.rows[0].id);
});

// ---------------------------------------------------------------- delete
test('delete: refuses with 409 while the URL is used in the draft or in published content; works once unused', async () => {
  const m = (await (await upload(ed, PNG_1x1, 'image/png', 'used.png')).json()).media;
  const cur = await store.getContentState();
  const next = JSON.parse(JSON.stringify(cur.draft));
  next.brands[1].logo = m.url;
  assert.equal((await ed.put('/api/admin/content', { draft: next, base_updated_at: cur.draft_updated_at })).status, 200, 'uploaded blob URLs are valid image values');
  // used in draft only
  let r = await ed.del(`/api/admin/media?id=${m.id}`);
  assert.equal(r.status, 409);
  let j = await r.json();
  assert.equal(j.code, 'in_use');
  assert.deepEqual(j.used_in, [{ where: 'draft', path: 'brands[1].logo' }]);
  // published too
  assert.equal((await ed.post('/api/admin/publish', { note: 'use image' })).status, 200);
  j = await (await ed.del(`/api/admin/media?id=${m.id}`)).json();
  assert.deepEqual(j.used_in.map((u) => u.where).sort(), ['draft', 'published']);
  // removed from draft but still published -> still refused
  const c2 = await store.getContentState();
  const back = JSON.parse(JSON.stringify(c2.draft)); back.brands[1].logo = '';
  await ed.put('/api/admin/content', { draft: back, base_updated_at: c2.draft_updated_at });
  r = await ed.del(`/api/admin/media?id=${m.id}`);
  assert.equal(r.status, 409);
  assert.deepEqual((await r.json()).used_in, [{ where: 'published', path: 'brands[1].logo' }]);
  assert.equal(fake.calls.del.length, 0, 'nothing deleted while in use');
  // publish the removal, then delete succeeds
  await ed.post('/api/admin/publish', { note: 'remove image' });
  r = await ed.del(`/api/admin/media?id=${m.id}`);
  assert.equal(r.status, 200);
  assert.deepEqual(fake.calls.del, [m.url]);
  assert.equal(await store.getMedia(m.id), null);
  assert.equal((await ed.del(`/api/admin/media?id=${m.id}`)).status, 404);
});

test('delete: invalid id 422; a Blob failure gives 502 and keeps the row; every media write is audited', async () => {
  assert.equal((await ed.del('/api/admin/media?id=not-a-uuid')).status, 422);
  assert.equal((await ed.del('/api/admin/media')).status, 422);
  const m = (await (await upload(ed, PNG_1x1, 'image/png', 'keep.png')).json()).media;
  fake.failDel = true;
  await quiet(async () => assert.equal((await ed.del(`/api/admin/media?id=${m.id}`)).status, 502));
  fake.failDel = false;
  assert.ok(await store.getMedia(m.id));
  assert.equal((await ed.del(`/api/admin/media?id=${m.id}`)).status, 200);
  const acts = (await store.listAudit({ limit: 500 })).rows.map((r) => r.action);
  for (const a of ['media_upload', 'media_update', 'media_delete']) assert.ok(acts.includes(a), a);
  const up = (await store.listAudit({ limit: 500 })).rows.find((r) => r.action === 'media_upload');
  assert.equal(up.user_name, 'Mia'); assert.match(up.target, /^media\//);
});
