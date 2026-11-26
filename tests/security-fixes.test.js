'use strict';
// Regression tests for the security review fixes: logout revocation, image URL rules, email/tel fields, prototype keys,
// media/rollback revision checks, publish pinning, retention, IP salt.
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, boot, client, makeUser, validBody, mockReq, mockRes, fakeUploader, PNG_1x1, PASSWORD, freshIp } = require('./_helpers');
setupEnv();
const media = require('../lib/media');
const { getStore } = require('../lib/store');
const { validate, imageError, isBlobUrl } = require('../lib/content/validate');
const { ipHash, ipSaltConfig, clientIp } = require('../lib/http');
const adminHandler = require('../api/admin/[action]');
const enquiryHandler = require('../api/enquiry');

let srv; let store; let ed; let admin; let fake;
const clone = (v) => JSON.parse(JSON.stringify(v));
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};
test.before(async () => {
  srv = await boot(); store = getStore();
  const e = await makeUser(store, { email: 'sec-ed@example.com', role: 'editor', name: 'Sec Ed' });
  const a = await makeUser(store, { email: 'sec-admin@example.com', role: 'admin', name: 'Sec Admin' });
  ed = client(srv.base); admin = client(srv.base);
  assert.equal((await ed.login(e.email)).status, 200); assert.equal((await admin.login(a.email)).status, 200);
});
test.beforeEach(() => { fake = fakeUploader(); media.setUploader(fake); });
test.after(async () => { media.setUploader(null); await srv.close(); });

const getContent = async (c = ed) => (await c.get('/api/admin/content')).json();
const upload = (c, name) => c.req('POST', '/api/admin/media', { raw: PNG_1x1, headers: { 'content-type': 'image/png', 'x-filename': name } });
async function putDraft(mutate, c = ed) {
  const cur = await getContent(c);
  const next = clone(cur.draft); mutate(next);
  const r = await c.put('/api/admin/content', { draft: next, base_updated_at: cur.draft_updated_at });
  assert.equal(r.status, 200, 'putDraft: ' + JSON.stringify(await r.clone().json()));
  return r.json();
}

// ---------------------------------------------------------------- 2. logout revokes
test('logout revokes the session: the old cookie is 401 afterwards (and signs the user out everywhere)', async () => {
  const u = await makeUser(store, { email: 'logout-user@example.com', role: 'editor' });
  const a = client(srv.base); const b = client(srv.base);
  assert.equal((await a.login(u.email)).status, 200); assert.equal((await b.login(u.email)).status, 200);
  const oldCookie = a.cookie;
  assert.ok(oldCookie.startsWith('vfi_admin='));
  assert.equal((await a.get('/api/admin/enquiries')).status, 200);
  assert.equal((await a.post('/api/admin/logout', {})).status, 200);
  const replay = client(srv.base); replay.cookie = oldCookie;
  const r = await replay.get('/api/admin/enquiries');
  assert.equal(r.status, 401);
  assert.equal((await replay.get('/api/admin/session').then((x) => x.json())).authenticated, false);
  assert.equal((await b.get('/api/admin/enquiries')).status, 401, 'all of the user\'s sessions are signed out');
  assert.equal((await client(srv.base).post('/api/admin/logout', {})).status, 200, 'logout without a session still succeeds');
  assert.equal((await client(srv.base).login(u.email)).status, 200, 'logging in again works');
});

// ---------------------------------------------------------------- 4. image URLs
test('imageError: blob https URLs need the store host and a plain path (no query/fragment); /assets/ paths are strict', () => {
  const ok = [
    'https://abc123.public.blob.vercel-storage.com/media/6b2f-logo.png', 'https://ABC.public.blob.vercel-storage.com/a/b_c.png'.replace('_', '-'),
    'https://abc.public.blob.vercel-storage.com/media/x~y%20z.webp', '/assets/img/a_b/c-d.png', '/assets/x.jpg',
  ];
  for (const s of ok) assert.equal(imageError(s), null, s);
  const bad = [
    'https://abc.public.blob.vercel-storage.com/a.png?x=1', 'https://abc.public.blob.vercel-storage.com/a.png#frag', 'https://abc.public.blob.vercel-storage.com/a.png?',
    'https://abc.public.blob.vercel-storage.com', 'https://abc.public.blob.vercel-storage.com/', 'https://abc.public.blob.vercel-storage.com//a.png',
    'https://abc.public.blob.vercel-storage.com/../a.png', 'https://abc.public.blob.vercel-storage.com/a b.png', 'https://abc.public.blob.vercel-storage.com/a.png"onerror=',
    'https://abc.public.blob.vercel-storage.com:8443/a.png', 'https://user@abc.public.blob.vercel-storage.com/a.png', 'https://abc.public.blob.vercel-storage.com@evil.example/a.png',
    'https://evil.example/a.png', 'https://public.blob.vercel-storage.com/a.png', 'https://x.public.blob.vercel-storage.com.evil.example/a.png', 'http://abc.public.blob.vercel-storage.com/a.png',
    '/assets/a b.png', '/assets/a?x=1.png', '/assets/../secret.png', '/assets//x.png', '/other/x.png', '//evil.example/a.png', '/assets/', 'data:image/png;base64,AAAA', 'javascript:alert(1)',
  ];
  for (const s of bad) assert.ok(imageError(s), s);
  assert.match(imageError('https://abc.public.blob.vercel-storage.com/a.png?x=1'), /query/);
});

test('imageError: BLOB_PUBLIC_HOST pins the store host', async () => {
  await withEnv({ BLOB_PUBLIC_HOST: 'mine123.public.blob.vercel-storage.com' }, () => {
    assert.equal(imageError('https://mine123.public.blob.vercel-storage.com/media/a.png'), null);
    assert.equal(imageError('https://MINE123.public.blob.vercel-storage.com/media/a.png'), null);
    assert.match(imageError('https://other456.public.blob.vercel-storage.com/media/a.png'), /this site/);
    assert.equal(isBlobUrl('https://mine123.public.blob.vercel-storage.com/x.png'), true);
    assert.equal(isBlobUrl('https://other456.public.blob.vercel-storage.com/x.png'), false);
  });
  assert.equal(imageError('https://other456.public.blob.vercel-storage.com/media/a.png'), null, 'unset: any *.public.blob.vercel-storage.com host');
  assert.equal(isBlobUrl('https://evil.example/x.png'), false); assert.equal(isBlobUrl(5), false); assert.equal(isBlobUrl('/assets/x.png'), false);
});

test('API: an image field with a query string or a foreign host is a 422', async () => {
  const cur = await getContent();
  for (const logo of ['https://abc.public.blob.vercel-storage.com/a.png?token=1', 'https://evil.example/a.png', '/assets/img/a b.png']) {
    const next = clone(cur.draft); next.brands[0].logo = logo;
    const r = await ed.put('/api/admin/content', { draft: next, base_updated_at: cur.draft_updated_at });
    assert.equal(r.status, 422, logo);
    assert.ok((await r.json()).errors['brands[0].logo']);
  }
});

// ---------------------------------------------------------------- 5. email / tel
const CONTACT_SCHEMA = { sections: [{ key: 'c', type: 'object', fields: [
  { key: 'email', type: 'email', max: 120 }, { key: 'phone', type: 'tel', max: 40 }, { key: 'req', type: 'email', required: true },
] }] };
const vc = (o) => validate({ c: { req: 'a@example.com', ...o } }, CONTACT_SCHEMA);

test('field type "email": one plain address; rejects ? & , ; spaces and other junk; empty allowed unless required', () => {
  for (const good of ['care@vfigroup.org', 'a.b+tag@mail.example.co.in', '  info@vfigroup.org  ', '']) assert.equal(vc({ email: good }).ok, true, good);
  assert.equal(vc({ email: '  info@vfigroup.org  ' }).value.c.email, 'info@vfigroup.org');
  for (const bad of ['a@example.com?subject=hi', 'a@example.com&cc=b@example.com', 'a@example.com,b@example.com', 'a@example.com;b@example.com', 'a b@example.com', 'a@exa mple.com', 'a@', '@example.com', 'no-at.example.com', 'a@@example.com', 'a@example', 'a@example..com', 'mailto:a@example.com', 5, {}, ['a@example.com']]) {
    const r = vc({ email: bad });
    assert.equal(r.ok, false, String(bad)); assert.ok(r.errors['c.email'], String(bad));
  }
  assert.equal(validate({ c: { req: '' } }, CONTACT_SCHEMA).ok, false, 'required');
  assert.equal(vc({ email: 'x'.repeat(130) + '@example.com' }).ok, false, 'max');
});

test('field type "tel": digits, spaces, + ( ) - only, 6 to 24 characters', () => {
  for (const good of ['+91 95993 37712', '(011) 4567-8901', '123456', '+', '', '+91 80101 61016']) {
    if (good === '+') continue;
    assert.equal(vc({ phone: good }).ok, true, good);
  }
  for (const bad of ['12345', '1'.repeat(25), '+91 95993 37712 ext 5', 'tel:+911234567890', '+91.95993.37712', '+91 95993;37712', '<b>123456</b>', '+91\\n95993', 5, null === 1]) {
    const r = vc({ phone: bad });
    assert.equal(r.ok, false, String(bad)); assert.ok(r.errors['c.phone'], String(bad));
  }
});

test('content-schema.json: contact email fields are type "email", phone fields "tel", and default.json still validates', () => {
  const { loadSchema } = require('../lib/content/defaults');
  const fs = require('fs'); const path = require('path');
  const schema = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'admin', 'content-schema.json'), 'utf8'));
  const contact = schema.sections.find((s) => s.key === 'settings').fields.find((f) => f.key === 'contact');
  const got = {};
  for (const blk of contact.fields) for (const f of blk.fields) if (f.key === 'email' || f.key === 'phone') got[`${blk.key}.${f.key}`] = f.type;
  assert.deepEqual(got, { 'office.phone': 'tel', 'office.email': 'email', 'sales.phone': 'tel', 'sales.email': 'email', 'careers.email': 'email' });
  const content = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'public', 'content', 'default.json'), 'utf8'));
  const r = validate(content, schema);
  assert.deepEqual({ ...r.errors }, {});
  assert.deepEqual(r.value, content);
  assert.ok(loadSchema);
  // and the real schema now rejects a header-injection style address
  const bad = clone(content); bad.settings.contact.office.email = 'care@vfigroup.org?bcc=evil@example.com';
  assert.ok(validate(bad, schema).errors['settings.contact.office.email']);
});

// ---------------------------------------------------------------- 7. prototype keys
test('validator: __proto__, constructor and prototype keys are rejected anywhere ("Not allowed"); error maps have no prototype', () => {
  const schema = require('./fixtures/schema.json');
  const base = require('./fixtures/content.json');
  const r0 = validate(base, schema);
  assert.equal(r0.ok, true);
  assert.equal(Object.getPrototypeOf(r0.errors), null);
  const poisoned = JSON.parse(JSON.stringify(base).replace('"texts":{', '"texts":{ "__proto__": {"polluted": true}, "constructor": "x", "prototype": 1,'));
  const r = validate(poisoned, schema);
  assert.equal(r.ok, false);
  assert.equal(r.errors['texts.__proto__'], 'Not allowed');
  assert.equal(r.errors['texts.constructor'], 'Not allowed');
  assert.equal(r.errors['texts.prototype'], 'Not allowed');
  assert.equal(({}).polluted, undefined);
  // nested in a list item, at the top level, and in a section that is not in the schema
  const deep = clone(base); deep.brands[0] = JSON.parse('{"name":"A","__proto__":{"x":1}}');
  assert.equal(validate(deep, schema).errors['brands[0].__proto__'], 'Not allowed');
  const top = JSON.parse(JSON.stringify(base).replace(/^\{/, '{"__proto__":{"a":1},'));
  assert.equal(validate(top, schema).errors.__proto__, 'Not allowed');
  assert.equal(validate(top, schema).ok, false);
  const ctor = clone(base); ctor.scale.figures[0].constructor = { prototype: { y: 1 } };
  const rc = validate(ctor, schema);
  assert.equal(rc.errors['scale.figures[0].constructor'], 'Not allowed');
  assert.equal(rc.errors['scale.figures[0].constructor.prototype'], undefined, 'reported once, at the offending key');
  // a user-supplied unknown key named like an Object.prototype member cannot confuse the error map
  const unk = clone(base); unk.toString = 'x'; unk.hasOwnProperty = 'y';
  const ru = validate(unk, schema);
  assert.equal(ru.errors.toString, 'Unknown section'); assert.equal(ru.errors.hasOwnProperty, 'Unknown section');
});

test('API: a __proto__ key in a PUT body is a 422 and changes nothing', async () => {
  const cur = await getContent();
  const body = `{"base_updated_at":${JSON.stringify(cur.draft_updated_at)},"draft":${JSON.stringify(cur.draft).replace('"texts":{', '"texts":{"__proto__":{"p":1},')}}`;
  const r = await ed.req('PUT', '/api/admin/content', { raw: body, headers: { 'content-type': 'application/json' } });
  assert.equal(r.status, 422);
  assert.equal((await r.json()).errors['texts.__proto__'], 'Not allowed');
  assert.equal((await getContent()).draft_updated_at, cur.draft_updated_at);
});

// ---------------------------------------------------------------- 6. rollback and missing media
test('rollback: refuses a revision that references an uploaded image no longer in the media library (409 missing_media)', async () => {
  const m = (await (await upload(ed, 'rb.png')).json()).media;
  await putDraft((d) => { d.brands[1].logo = m.url; });
  assert.equal((await ed.post('/api/admin/publish', { note: 'with image' })).status, 200);
  const withImg = (await store.listRevisions({})).published_revision;
  await putDraft((d) => { d.brands[1].logo = ''; });
  assert.equal((await ed.post('/api/admin/publish', { note: 'without image' })).status, 200);
  // rolling back while the image exists works...
  const ok = await ed.post('/api/admin/rollback', { id: withImg });
  assert.equal(ok.status, 200);
  await putDraft((d) => { d.brands[1].logo = ''; });
  assert.equal((await ed.post('/api/admin/publish', { note: 'without image again' })).status, 200);
  // ...but not after the row is gone (deleted out-of-band: the API itself refuses to delete it)
  assert.equal((await ed.del(`/api/admin/media?id=${m.id}`)).status, 409);
  await store.deleteMedia(m.id);
  const before = (await store.listRevisions({})).total;
  const r = await ed.post('/api/admin/rollback', { id: withImg });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'missing_media');
  assert.deepEqual(j.missing, [m.url]);
  assert.equal((await store.listRevisions({})).total, before, 'nothing was published');
  // a revision without uploaded images is unaffected
  assert.equal((await ed.post('/api/admin/rollback', { id: 1 })).status, 200);
});

// ---------------------------------------------------------------- 9. publish pins the draft
test('publish: base_updated_at pins the draft (409 conflict with updated_at / updated_by); optional for old clients; bad value is 422', async () => {
  const c1 = await putDraft((d) => { d.settings.siteName = 'Pin A'; });
  const stale = c1.draft_updated_at;
  const c2 = await putDraft((d) => { d.settings.siteName = 'Pin B'; }, ed);
  assert.ok(c2.draft_updated_at > stale);
  const r = await ed.post('/api/admin/publish', { note: 'stale', base_updated_at: stale });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'conflict'); assert.equal(j.updated_at, c2.draft_updated_at); assert.equal(j.updated_by, 'Sec Ed');
  assert.equal((await getContent()).published_revision, (await store.listRevisions({})).published_revision);
  assert.equal((await ed.post('/api/admin/publish', { base_updated_at: 'not a date' })).status, 422);
  assert.equal((await ed.post('/api/admin/publish', { base_updated_at: 5 })).status, 422);
  const okR = await ed.post('/api/admin/publish', { note: 'pinned', base_updated_at: c2.draft_updated_at });
  assert.equal(okR.status, 200);
  assert.equal((await ed.post('/api/admin/publish', { base_updated_at: c2.draft_updated_at })).status, 409, 'nothing_to_publish now');
  // old clients (no base) keep working
  await putDraft((d) => { d.settings.siteName = 'Pin C'; });
  assert.equal((await ed.post('/api/admin/publish', { note: 'legacy' })).status, 200);
  await putDraft((d) => { d.settings.siteName = 'Test Co'; });
  assert.equal((await ed.post('/api/admin/publish', { note: 'reset' })).status, 200);
});

test('publish: nothing_to_publish is a 409 with that code; the locked draft is re-validated (422) even if it was stored invalid', async () => {
  const r = await ed.post('/api/admin/publish', { note: 'again' });
  assert.equal(r.status, 409);
  assert.equal((await r.json()).code, 'nothing_to_publish');
  const cur = await store.getContentState();
  const bad = clone(cur.draft); bad.brands[0].url = 'http://insecure.example.com';
  await store.saveDraft({ data: bad, base_updated_at: cur.draft_updated_at, user_id: null });
  const r2 = await ed.post('/api/admin/publish', { base_updated_at: (await store.getContentState()).draft_updated_at });
  assert.equal(r2.status, 422);
  assert.ok((await r2.json()).errors['brands[0].url']);
  await ed.post('/api/admin/discard', {});
});

// ---------------------------------------------------------------- 8. retention
test('retention: pruneOld deletes login attempts older than 30 days and audit entries older than 365 days only', async (t) => {
  const { createMemoryStore } = require('../lib/store/memory');
  const s = createMemoryStore({ ENQUIRY_DATA_FILE: require('path').join(require('os').tmpdir(), 'vfi-prune-' + Date.now() + '.json') });
  const limits = { ip: 100, emailIp: 100, email: 100 };
  const day = 86400000;
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() - 400 * day });
  await s.reserveLoginAttempt({ ip_hash: 'old400', email: 'o@example.com', sinceMs: 900000, limits });
  await s.addAudit({ user_id: null, action: 'old400', target: '' });
  t.mock.timers.setTime(Date.now() + 60 * day); // now = 340 days ago
  await s.reserveLoginAttempt({ ip_hash: 'old340', email: 'o@example.com', sinceMs: 900000, limits });
  await s.addAudit({ user_id: null, action: 'old340', target: '' });
  t.mock.timers.setTime(Date.now() + 320 * day); // now = 20 days ago
  await s.reserveLoginAttempt({ ip_hash: 'old20', email: 'o@example.com', sinceMs: 900000, limits });
  t.mock.timers.reset();
  const res = await s.pruneOld();
  assert.equal(res.login_attempts, 2, '400- and 340-day-old attempts removed');
  assert.equal(res.audit_log, 1, 'only the 400-day-old audit entry removed');
  assert.deepEqual((await s.listAudit({})).rows.map((r) => r.action), ['old340']);
  assert.equal((await s.countFailedAttempts({ ip_hash: 'old20', email: '', sinceMs: 40 * day })).ip, 1, 'the 20-day-old attempt survives');
});

test('retention: login and publish opportunistically call pruneOld (throttled); a failing prune never fails the request', async () => {
  const orig = store.pruneOld; let calls = 0;
  const saveSettings = { ...adminHandler.settings };
  adminHandler.settings.pruneEveryMs = 0;
  store.pruneOld = async () => { calls++; return {}; };
  try {
    const u = await makeUser(store, { email: 'prune-user@example.com', role: 'editor' });
    const c = client(srv.base);
    assert.equal((await c.login(u.email)).status, 200);
    assert.equal(calls, 1);
    await putDraft((d) => { d.settings.siteName = 'Prune check'; }, c);
    assert.equal((await c.post('/api/admin/publish', {})).status, 200);
    assert.equal(calls, 2);
    assert.equal((await c.post('/api/admin/rollback', { id: 1 })).status, 200);
    assert.equal(calls, 3, 'rollback prunes too');
    adminHandler.settings.pruneEveryMs = 3600000;
    assert.equal((await c.post('/api/admin/rollback', { id: 1 })).status, 200);
    assert.equal(calls, 3, 'throttled: the last prune was moments ago');
    adminHandler.settings.pruneEveryMs = 0;
    store.pruneOld = async () => { throw new Error('boom'); };
    await quiet(async () => assert.equal((await client(srv.base).login(u.email)).status, 200));
  } finally { store.pruneOld = orig; Object.assign(adminHandler.settings, saveSettings); }
});

// ---------------------------------------------------------------- 11. IP salt
test('IP_SALT: required (>= 16 chars) on Vercel / production; no SESSION_SECRET fallback; dev keeps a fixed fallback', async () => {
  await quiet(async () => {
    for (const hosted of [{ VERCEL: '1' }, { NODE_ENV: 'production' }]) {
      await withEnv({ VERCEL: undefined, NODE_ENV: undefined, ...hosted, IP_SALT: undefined, SESSION_SECRET: 'x'.repeat(40) }, () => {
        assert.equal(ipSaltConfig().ok, false);
        assert.throws(() => ipHash('1.2.3.4'), (e) => e.status === 503 && e.code === 'not_configured');
      });
      await withEnv({ VERCEL: undefined, NODE_ENV: undefined, ...hosted, IP_SALT: 'short-salt' }, () => assert.equal(ipSaltConfig().ok, false));
      await withEnv({ VERCEL: undefined, NODE_ENV: undefined, ...hosted, IP_SALT: 'a'.repeat(16) }, () => { assert.equal(ipSaltConfig().ok, true); assert.match(ipHash('1.2.3.4'), /^[0-9a-f]{64}$/); });
    }
  });
  await withEnv({ VERCEL: undefined, NODE_ENV: undefined, IP_SALT: undefined, SESSION_SECRET: 'one'.repeat(15) }, () => {
    const a = ipHash('1.2.3.4');
    process.env.SESSION_SECRET = 'two'.repeat(15);
    assert.equal(ipHash('1.2.3.4'), a, 'the hash does not depend on SESSION_SECRET');
  });
  await withEnv({ VERCEL: undefined, NODE_ENV: undefined, IP_SALT: 'dev' }, () => assert.equal(ipSaltConfig().ok, true));
});

test('IP_SALT missing in production: enquiry and every admin action answer 503 not_configured; a valid salt lets the request through', async () => {
  await quiet(async () => {
    await withEnv({ VERCEL: '1', IP_SALT: undefined, TRUST_PROXY: undefined }, async () => {
      const res = mockRes();
      await enquiryHandler(mockReq({ headers: { 'content-type': 'application/json' }, body: validBody() }), res);
      assert.equal(res.statusCode, 503); assert.equal(res.json().code, 'not_configured');
      for (const [method, action] of [['GET', 'session'], ['POST', 'login'], ['GET', 'enquiries'], ['POST', 'logout']]) {
        const r2 = mockRes();
        await adminHandler(mockReq({ method, query: { action }, headers: { 'content-type': 'application/json', 'x-requested-with': 'vfi-admin' }, body: '{}' }), r2);
        assert.equal(r2.statusCode, 503, action); assert.equal(r2.json().code, 'not_configured', action);
      }
    });
    await withEnv({ VERCEL: '1', IP_SALT: 'short', TRUST_PROXY: undefined }, async () => {
      const res = mockRes();
      await enquiryHandler(mockReq({ headers: { 'content-type': 'application/json' }, body: validBody() }), res);
      assert.equal(res.json().code, 'not_configured');
    });
    await withEnv({ VERCEL: '1', IP_SALT: 'a-long-enough-salt-value', TRUST_PROXY: undefined }, async () => {
      const res = mockRes();
      await enquiryHandler(mockReq({ headers: { 'content-type': 'application/json' }, body: validBody() }), res);
      assert.notEqual(res.json().code, 'not_configured'); // (503 unavailable here: no DATABASE_URL on Vercel)
    });
  });
});

test('clientIp on Vercel: x-vercel-forwarded-for, then x-real-ip; never x-forwarded-for', async () => {
  await withEnv({ VERCEL: '1', TRUST_PROXY: '1' }, () => {
    assert.equal(clientIp(mockReq({ headers: { 'x-forwarded-for': '6.6.6.6' } })), '127.0.0.1');
    assert.equal(clientIp(mockReq({ headers: { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '5.5.5.5' } })), '5.5.5.5');
    assert.equal(clientIp(mockReq({ headers: { 'x-forwarded-for': '6.6.6.6', 'x-real-ip': '5.5.5.5', 'x-vercel-forwarded-for': '4.4.4.4' } })), '4.4.4.4');
  });
});

// ---------------------------------------------------------------- 10. cache header
test('GET /api/content: Cache-Control is s-maxage=60, stale-while-revalidate=30', async () => {
  const r = await client(srv.base).get('/api/content');
  assert.equal(r.headers.get('cache-control'), 'public, s-maxage=60, stale-while-revalidate=30');
});
