'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, boot, client, makeUser, validBody, postJson } = require('./_helpers');
setupEnv();
const { getStore, resetStore } = require('../lib/store');
const fixture = require('./fixtures/content.json');

let srv; let store; let ed; let ed2; let admin; let pub; let sales;
const clone = (v) => JSON.parse(JSON.stringify(v));
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};

test.before(async () => {
  srv = await boot(); store = getStore();
  const mkc = async (role, name) => { const u = await makeUser(store, { email: `${name.toLowerCase()}@example.com`, role, name }); const c = client(srv.base); assert.equal((await c.login(u.email)).status, 200); return c; };
  ed = await mkc('editor', 'Eddie'); ed2 = await mkc('editor', 'Edna'); admin = await mkc('admin', 'Ada'); sales = await mkc('sales', 'Sam');
  pub = client(srv.base);
});
test.after(async () => { await srv.close(); });

const getContent = async (c = ed) => (await c.get('/api/admin/content')).json();
const auditActions = async () => (await store.listAudit({ limit: 200 })).rows.map((r) => r.action);

test('GET content: draft, timestamps, revision, no unpublished changes at first', async () => {
  const j = await getContent();
  assert.equal(j.ok, true);
  assert.deepEqual(j.draft, fixture);
  assert.ok(!Number.isNaN(Date.parse(j.draft_updated_at)));
  assert.equal(j.published_revision, 1);
  assert.equal(j.hasUnpublished, false);
  assert.deepEqual(j.changed_sections, []);
  assert.equal(j.draft_updated_by, null);
});

test('PUT content: save without changes round-trips (draft deep-equals the original)', async () => {
  const cur = await getContent();
  const r = await ed.put('/api/admin/content', { draft: cur.draft, base_updated_at: cur.draft_updated_at });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(j.draft, fixture);
  assert.ok(j.draft_updated_at > cur.draft_updated_at);
  assert.equal(j.draft_updated_by, 'Eddie');
  assert.equal(j.hasUnpublished, false);
  assert.deepEqual((await getContent()).draft, fixture);
});

test('PUT content: validation errors give 422 with field paths and change nothing', async () => {
  const cur = await getContent();
  const bad = clone(cur.draft);
  bad.brands[1].url = 'javascript:alert(1)'; bad.settings.siteName = ''; bad.extra = {}; bad.hero[0].image = 'https://evil.example/x.png'; bad.settings.tagline = 'x'.repeat(301);
  const r = await ed.put('/api/admin/content', { draft: bad, base_updated_at: cur.draft_updated_at });
  assert.equal(r.status, 422);
  const j = await r.json();
  assert.equal(j.code, 'invalid_input');
  assert.deepEqual(Object.keys(j.errors).sort(), ['brands[1].url', 'extra', 'hero[0].image', 'settings.siteName', 'settings.tagline']);
  assert.deepEqual((await getContent()).draft_updated_at, cur.draft_updated_at, 'nothing saved');
  for (const body of [{ draft: cur.draft }, { draft: cur.draft, base_updated_at: 'yesterday' }, { base_updated_at: cur.draft_updated_at }, { draft: [], base_updated_at: cur.draft_updated_at }, { draft: 'x', base_updated_at: cur.draft_updated_at }]) {
    assert.equal((await ed.put('/api/admin/content', body)).status, 422, JSON.stringify(body).slice(0, 50));
  }
});

test('PUT content: 513 KB payload is rejected with a size error; an absurd body is 413', async () => {
  const cur = await getContent();
  const big = clone(cur.draft);
  big.junk = 'x'.repeat(513 * 1024);
  const r = await ed.put('/api/admin/content', { draft: big, base_updated_at: cur.draft_updated_at });
  assert.equal(r.status, 422);
  assert.match((await r.json()).errors.content, /too large/);
  const huge = await ed.req('PUT', '/api/admin/content', { raw: JSON.stringify({ draft: { junk: 'x'.repeat(800 * 1024) }, base_updated_at: cur.draft_updated_at }), headers: { 'content-type': 'application/json' } });
  assert.equal(huge.status, 413);
});

test('draft -> preview -> publish: draft saved, public unchanged until publish, then public updated with a new revision', async () => {
  const cur = await getContent();
  const next = clone(cur.draft);
  next.settings.siteName = '  Test Co v2  '; next.brands[0].description = 'Edited description';
  const r = await ed.put('/api/admin/content', { draft: next, base_updated_at: cur.draft_updated_at });
  assert.equal(r.status, 200);
  const saved = await r.json();
  assert.equal(saved.draft.settings.siteName, 'Test Co v2', 'value is trimmed');
  assert.equal(saved.hasUnpublished, true);
  assert.deepEqual(saved.changed_sections, ['brands', 'settings']);
  // preview (draft) vs public
  const draftRes = await ed.get('/api/content?draft=1');
  assert.equal(draftRes.status, 200);
  assert.equal(draftRes.headers.get('cache-control'), 'no-store');
  assert.equal((await draftRes.json()).brands[0].description, 'Edited description');
  const live1 = await pub.get('/api/content');
  assert.equal((await live1.json()).brands[0].description, 'First brand');
  assert.equal(live1.headers.get('x-content-revision'), '1');
  // publish
  const p = await ed.post('/api/admin/publish', { note: 'Edit brand text' });
  assert.equal(p.status, 200);
  const pj = await p.json();
  assert.equal(pj.revision.id, 2); assert.equal(pj.published_revision, 2); assert.equal(pj.revision.note, 'Edit brand text');
  const live2 = await pub.get('/api/content');
  assert.equal(live2.headers.get('x-content-revision'), '2');
  assert.equal((await live2.json()).brands[0].description, 'Edited description');
  assert.equal((await getContent()).hasUnpublished, false);
  assert.equal((await ed.post('/api/admin/publish', { note: 'x'.repeat(201) })).status, 422);
  const again = await ed.post('/api/admin/publish', {});
  assert.equal(again.status, 409, 'draft equals the published revision');
  assert.equal((await again.json()).code, 'nothing_to_publish');
  const c3 = await getContent();
  const n3 = clone(c3.draft); n3.settings.siteName = 'Test Co v3';
  assert.equal((await ed.put('/api/admin/content', { draft: n3, base_updated_at: c3.draft_updated_at })).status, 200);
  assert.equal((await ed.post('/api/admin/publish', {})).status, 200, 'note is optional');
});

test('revisions: list (paged, is_current, publisher name), single revision with changed sections vs live', async () => {
  const j = await (await ed.get('/api/admin/revisions')).json();
  assert.equal(j.total, 3);
  assert.deepEqual(j.rows.map((r) => r.id), [3, 2, 1]);
  assert.deepEqual(j.rows.map((r) => r.is_current), [true, false, false]);
  assert.equal(j.rows[1].note, 'Edit brand text'); assert.equal(j.rows[1].published_by, 'Eddie'); assert.equal(j.rows[2].published_by, 'System');
  assert.equal(j.published_revision, 3);
  const page2 = await (await ed.get('/api/admin/revisions?pageSize=2&page=2')).json();
  assert.deepEqual(page2.rows.map((r) => r.id), [1]);
  const one = await (await ed.get('/api/admin/revision?id=1')).json();
  assert.deepEqual(one.revision.data, fixture);
  assert.deepEqual(one.changed_sections, ['brands', 'settings']);
  assert.equal(one.revision.is_current, false);
  assert.equal((await (await ed.get('/api/admin/revision?id=3')).json()).revision.is_current, true);
  assert.equal((await ed.get('/api/admin/revision?id=99')).status, 404);
  for (const id of ['abc', '0', '-1', '1.5', '']) assert.equal((await ed.get(`/api/admin/revision?id=${id}`)).status, 422, id);
});

test('rollback to #1: new revision equal to #1, draft reset, public shows the old text; history keeps everything', async () => {
  const r = await ed.post('/api/admin/rollback', { id: 1 });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.revision.id, 4); assert.equal(j.revision.note, 'Rollback to #1'); assert.equal(j.published_revision, 4);
  const live = await (await pub.get('/api/content')).json();
  assert.equal(live.brands[0].description, 'First brand');
  const cur = await getContent();
  assert.deepEqual(cur.draft, fixture); assert.equal(cur.hasUnpublished, false); assert.equal(cur.published_revision, 4);
  assert.deepEqual((await (await ed.get('/api/admin/revision?id=4')).json()).revision.data, (await (await ed.get('/api/admin/revision?id=1')).json()).revision.data);
  assert.equal((await ed.get('/api/admin/revisions')).status, 200);
  assert.equal((await (await ed.get('/api/admin/revisions')).json()).total, 4);
  assert.equal((await ed.post('/api/admin/rollback', { id: 99 })).status, 404);
  for (const id of ['x', 0, -2, 1.5, null]) assert.equal((await ed.post('/api/admin/rollback', { id })).status, 422, String(id));
});

test('discard: resets the draft to the published revision', async () => {
  const cur = await getContent();
  const next = clone(cur.draft); next.settings.siteName = 'Throwaway';
  assert.equal((await ed.put('/api/admin/content', { draft: next, base_updated_at: cur.draft_updated_at })).status, 200);
  assert.equal((await getContent()).hasUnpublished, true);
  const r = await ed.post('/api/admin/discard', {});
  assert.equal(r.status, 200);
  const after = await getContent();
  assert.equal(after.draft.settings.siteName, 'Test Co');
  assert.equal(after.hasUnpublished, false);
  assert.equal(after.draft_updated_at, (await r.json()).draft_updated_at);
});

test('conflict: a stale base_updated_at gets 409 naming the other editor and changes nothing', async () => {
  const mine = await getContent(ed);
  const theirs = await getContent(ed2);
  const t = clone(theirs.draft); t.settings.siteName = 'Edna was here';
  assert.equal((await ed2.put('/api/admin/content', { draft: t, base_updated_at: theirs.draft_updated_at })).status, 200);
  const m = clone(mine.draft); m.settings.siteName = 'Eddie was here';
  const r = await ed.put('/api/admin/content', { draft: m, base_updated_at: mine.draft_updated_at });
  assert.equal(r.status, 409);
  const j = await r.json();
  assert.equal(j.code, 'conflict');
  assert.equal(j.updated_by, 'Edna');
  assert.ok(j.updated_at > mine.draft_updated_at);
  assert.equal((await getContent()).draft.settings.siteName, 'Edna was here');
  // retry with the fresh timestamp succeeds
  assert.equal((await ed.put('/api/admin/content', { draft: m, base_updated_at: j.updated_at })).status, 200);
  assert.equal((await getContent()).draft.settings.siteName, 'Eddie was here');
  await ed.post('/api/admin/discard', {});
});

test('publish refuses a draft that no longer validates (422 with field paths) and creates no revision', async () => {
  const cur = await store.getContentState();
  const bad = clone(cur.draft); bad.brands[0].url = 'http://insecure.example.com';
  await store.saveDraft({ data: bad, base_updated_at: cur.draft_updated_at, user_id: null });
  const before = (await store.listRevisions({})).total;
  const r = await ed.post('/api/admin/publish', { note: 'nope' });
  assert.equal(r.status, 422);
  assert.ok((await r.json()).errors['brands[0].url']);
  assert.equal((await store.listRevisions({})).total, before);
  await ed.post('/api/admin/discard', {});
});

test('every content write is audited with the actor and target; no content bodies in the log', async () => {
  const log = (await store.listAudit({ limit: 200 })).rows;
  const by = (a) => log.filter((x) => x.action === a);
  assert.ok(by('content_save').length >= 4);
  assert.equal(by('content_publish').length, 2);
  assert.equal(by('content_publish')[1].target, '#2');
  assert.deepEqual(by('content_publish')[1].detail.sections, ['brands', 'settings']);
  assert.equal(by('content_rollback')[0].target, '#1'); assert.equal(by('content_rollback')[0].detail.new_revision, 4);
  assert.ok(by('content_discard').length >= 2);
  assert.ok(log.filter((x) => x.action.startsWith('content_')).every((x) => x.user_id && x.user_name));
  assert.ok(!JSON.stringify(log).includes('Edited description'));
});

// ---------------------------------------------------------------- public endpoint
test('GET /api/content: published JSON with s-maxage=60 + stale-while-revalidate=30, ETag, nosniff, no cookies', async () => {
  const r = await pub.get('/api/content');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, s-maxage=60, stale-while-revalidate=30');
  assert.match(r.headers.get('etag'), /^"[0-9a-f]{40}"$/);
  assert.equal(r.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(r.headers.get('x-content-source'), 'published');
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('set-cookie'), null);
  assert.deepEqual(await r.json(), fixture);
});

test('GET /api/content: If-None-Match gives 304 with the same ETag and cache headers; a different tag gives 200', async () => {
  const etag = (await pub.get('/api/content')).headers.get('etag');
  for (const inm of [etag, `W/${etag}`, `"nope", ${etag}`, '*']) {
    const r = await fetch(srv.base + '/api/content', { headers: { 'if-none-match': inm } });
    assert.equal(r.status, 304, inm);
    assert.equal(r.headers.get('etag'), etag);
    assert.equal(r.headers.get('cache-control'), 'public, s-maxage=60, stale-while-revalidate=30');
    assert.equal(await r.text(), '');
  }
  assert.equal((await fetch(srv.base + '/api/content', { headers: { 'if-none-match': '"stale"' } })).status, 200);
  // a publish changes the ETag
  const cur = await getContent();
  const next = clone(cur.draft); next.texts['home.title'] = 'New title';
  await ed.put('/api/admin/content', { draft: next, base_updated_at: cur.draft_updated_at });
  await ed.post('/api/admin/publish', { note: 'etag' });
  const r2 = await pub.get('/api/content');
  assert.notEqual(r2.headers.get('etag'), etag);
  assert.equal((await fetch(srv.base + '/api/content', { headers: { 'if-none-match': etag } })).status, 200);
});

test('GET /api/content?draft=1: editor/admin only, no-store, no ETag; other methods 405; HEAD works', async () => {
  const d = await admin.get('/api/content?draft=1');
  assert.equal(d.status, 200);
  assert.equal(d.headers.get('cache-control'), 'no-store');
  assert.equal(d.headers.get('etag'), null);
  assert.equal(d.headers.get('x-content-source'), 'draft');
  assert.equal((await pub.get('/api/content?draft=1')).status, 401);
  assert.equal((await sales.get('/api/content?draft=1')).status, 403);
  assert.equal((await pub.post('/api/content', {})).status, 405);
  const h = await fetch(srv.base + '/api/content', { method: 'HEAD' });
  assert.equal(h.status, 200); assert.ok(h.headers.get('etag'));
});

test('GET /api/content falls back to the bundled defaults (X-Content-Source: defaults) when the store fails', async () => {
  const orig = store.getPublished;
  store.getPublished = async () => { const e = new Error('connect ECONNREFUSED'); e.code = 'unavailable'; throw e; };
  try {
    await quiet(async () => {
      const r = await pub.get('/api/content');
      assert.equal(r.status, 200);
      assert.equal(r.headers.get('x-content-source'), 'defaults');
      assert.match(r.headers.get('cache-control'), /^public, s-maxage=\d+/);
      assert.deepEqual(await r.json(), fixture);
      assert.equal((await ed.get('/api/content?draft=1')).status, 200, 'draft read is a different store call');
    });
  } finally { store.getPublished = orig; }
});

test('error responses never contain stack traces, SQL or secrets', async () => {
  const orig = store.listUsers;
  store.listUsers = async () => { throw new Error('select * from users where password_hash = $1 -- /srv/app/lib/db/store.js:99'); };
  try {
    await quiet(async () => {
      const r = await admin.get('/api/admin/users');
      assert.equal(r.status, 500);
      const t = await r.text();
      assert.deepEqual(JSON.parse(t), { ok: false, error: 'Something went wrong.', code: 'server_error' });
    });
  } finally { store.listUsers = orig; }
});

test('enquiries still work end to end: submit -> list -> status update -> CSV export (all roles), with audit', async () => {
  const r = await postJson(srv.base, '/api/enquiry', validBody({ name: 'Zed Customer' }));
  assert.equal(r.status, 200);
  const { ref } = await r.json();
  assert.match(ref, /^VFI-\d{6}-[A-F0-9]{6}$/);
  for (const c of [sales, ed, admin]) {
    const list = await (await c.get('/api/admin/enquiries?q=zed')).json();
    assert.equal(list.rows.length, 1);
    assert.ok(!JSON.stringify(list).includes('ip_hash'));
  }
  const row = (await (await sales.get('/api/admin/enquiries?q=zed')).json()).rows[0];
  const up = await sales.patch('/api/admin/enquiries', { id: row.id, status: 'contacted', notes: 'called' });
  assert.equal(up.status, 200);
  assert.equal((await up.json()).row.status, 'contacted');
  const csv = await sales.get('/api/admin/export?status=contacted');
  assert.equal(csv.status, 200);
  assert.equal(csv.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(await csv.text(), /Zed Customer/);
  const acts = await auditActions();
  assert.ok(acts.includes('enquiry_update') && acts.includes('enquiry_export'));
});

// last: this swaps the shared store for a production-style one
test('production without DATABASE_URL: admin and enquiry answer 503 unavailable; /api/content serves bundled defaults', async () => {
  await quiet(() => withEnv({ NODE_ENV: 'production', VERCEL: '1', DATABASE_URL: undefined }, async () => {
    resetStore();
    try {
      assert.equal(getStore().kind, 'unavailable');
      const c = await pub.get('/api/content');
      assert.equal(c.status, 200);
      assert.equal(c.headers.get('x-content-source'), 'defaults');
      assert.deepEqual(await c.json(), fixture);
      const l = await client(srv.base).login('x@example.com');
      assert.equal(l.status, 503);
      assert.equal((await l.json()).code, 'unavailable');
      const e = await postJson(srv.base, '/api/enquiry', validBody());
      assert.equal(e.status, 503);
      assert.equal((await e.json()).code, 'unavailable');
      assert.equal((await ed.get('/api/content?draft=1')).status, 503);
      assert.equal((await ed.get('/api/admin/content')).status, 503);
    } finally { resetStore(); }
  }));
});
