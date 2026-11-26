'use strict';
// One suite, two implementations: memory (always) and Postgres (when TEST_DATABASE_URL is set) must behave identically.
const test = require('node:test');
const assert = require('node:assert/strict');
const { validBody, makeUser } = require('./_helpers');
const { validateEnquiry } = require('../lib/validate');
const { loadDefaultContent } = require('../lib/content/defaults');

let ipSeq = 0;
const input = (over = {}) => ({ ...validateEnquiry(validBody(over)).value, ip_hash: 'ip_hash' in over ? over.ip_hash : `h-auto-${++ipSeq}`, user_agent: 'UA' });
const code = async (p) => { try { await p; } catch (e) { return e.code; } return 'none'; };

/** @param {string} name @param {() => Promise<object>} make returns a fresh, empty store */
function defineStoreSuite(name, make, { teardown } = {}) {
  const t = (title, fn) => test(`${name}: ${title}`, async () => { const s = await make(); try { await fn(s); } finally { if (teardown) await teardown(s); } });

  // ------------------------------------------------------------ enquiries
  t('submit returns ref+id with correct format', async (s) => {
    const r = await s.submitEnquiry(input());
    assert.match(r.ref, /^VFI-\d{6}-[A-F0-9]{6}$/);
    assert.ok(r.id);
  });
  t('6th submit from the same ip_hash is rate limited; other ip unaffected', async (s) => {
    for (let i = 0; i < 5; i++) await s.submitEnquiry(input({ ip_hash: 'h1' }));
    assert.equal(await code(s.submitEnquiry(input({ ip_hash: 'h1' }))), 'rate_limited');
    await s.submitEnquiry(input({ ip_hash: 'h2' }));
  });
  t('ip_hash is mandatory', async (s) => {
    assert.equal(await code(s.submitEnquiry({ ...input(), ip_hash: '' })), 'invalid_input');
  });
  t('list: shape, no ip_hash, filters, search, counts, paging', async (s) => {
    const a = await s.submitEnquiry(input({ name: 'Alice Zeta', company: 'Zeta Beds' }));
    for (let i = 0; i < 4; i++) await s.submitEnquiry(input({ name: 'Bulk ' + i }));
    await s.updateEnquiry({ id: a.id, status: 'spam' });
    const all = await s.listEnquiries({ status: 'all', limit: 100 });
    assert.equal(all.total, 5);
    assert.ok(!JSON.stringify(all).includes('ip_hash'));
    assert.deepEqual(all.counts, { new: 4, in_progress: 0, contacted: 0, closed: 0, spam: 1 });
    assert.equal((await s.listEnquiries({})).total, 4, 'default hides spam');
    assert.deepEqual((await s.listEnquiries({ status: 'spam' })).rows.map((r) => r.name), ['Alice Zeta']);
    assert.equal((await s.listEnquiries({ status: 'all', q: 'zeta' })).total, 1);
    assert.equal((await s.listEnquiries({ status: 'all', q: 'beds zeta' })).total, 0);
    assert.equal((await s.listEnquiries({ status: 'all', q: '%' })).total, 0, 'LIKE wildcards are literal');
    const p1 = await s.listEnquiries({ status: 'all', limit: 2, offset: 0 });
    const p2 = await s.listEnquiries({ status: 'all', limit: 2, offset: 2 });
    assert.equal(p1.rows.length, 2); assert.notEqual(p1.rows[0].id, p2.rows[0].id);
    assert.equal(await code(s.listEnquiries({ status: 'bogus' })), 'invalid_input');
  });
  t('update: partial, validation, not_found', async (s) => {
    const e = await s.submitEnquiry(input());
    const r = await s.updateEnquiry({ id: e.id, status: 'contacted', notes: 'hello' });
    assert.equal(r.status, 'contacted'); assert.equal(r.notes, 'hello');
    assert.equal((await s.updateEnquiry({ id: e.id, notes: 'x' })).status, 'contacted');
    assert.equal((await s.updateEnquiry({ id: e.id, status: 'closed' })).notes, 'x');
    assert.equal(await code(s.updateEnquiry({ id: e.id, status: 'nope' })), 'invalid_input');
    assert.equal(await code(s.updateEnquiry({ id: e.id, notes: 'n'.repeat(5001) })), 'invalid_input');
    assert.equal(await code(s.updateEnquiry({ id: '00000000-0000-4000-8000-000000000000', status: 'closed' })), 'not_found');
  });
  t('export returns filtered rows without ip_hash', async (s) => {
    await s.submitEnquiry(input({ company: 'Comma, Inc' }));
    const rows = await s.exportEnquiries({ status: 'all', q: 'comma' });
    assert.equal(rows.length, 1);
    assert.ok(!('ip_hash' in rows[0]));
  });

  // ------------------------------------------------------------ users
  t('users: create, lookup by id and email (case-insensitive), list without hashes, duplicate email', async (s) => {
    const u = await makeUser(s, { email: 'Ann@Example.com', role: 'admin', name: 'Ann' });
    assert.equal(u.email, 'ann@example.com');
    assert.equal(u.session_version, 1); assert.equal(u.active, true);
    assert.equal((await s.getUserById(u.id)).email, 'ann@example.com');
    assert.equal((await s.getUserByEmail('ANN@example.com')).id, u.id);
    assert.equal(await s.getUserById('00000000-0000-4000-8000-000000000000'), null);
    assert.equal(await s.getUserById('not-a-uuid'), null);
    assert.equal(await s.getUserByEmail('nobody@example.com'), null);
    assert.ok(!JSON.stringify(await s.listUsers()).includes('password_hash'));
    assert.equal(await code(makeUser(s, { email: 'ann@example.com' })), 'email_taken');
  });
  t('users: update fields, bump_session, recordLogin; last-admin protection', async (s) => {
    const a1 = await makeUser(s, { email: 'a1@example.com', role: 'admin' });
    assert.equal(await code(s.updateUser(a1.id, { role: 'editor' })), 'last_admin');
    assert.equal(await code(s.updateUser(a1.id, { active: false })), 'last_admin');
    const renamed = await s.updateUser(a1.id, { name: 'New', bump_session: true });
    assert.equal(renamed.name, 'New'); assert.equal(renamed.session_version, 2);
    await s.recordLogin(a1.id);
    assert.ok((await s.getUserById(a1.id)).last_login_at);
    const a2 = await makeUser(s, { email: 'a2@example.com', role: 'admin' });
    assert.equal((await s.updateUser(a1.id, { role: 'editor' })).role, 'editor');
    assert.equal(await code(s.updateUser(a2.id, { active: false })), 'last_admin');
    assert.equal((await s.updateUser(a1.id, { role: 'admin' })).role, 'admin');
    assert.equal((await s.updateUser(a2.id, { active: false })).active, false);
    assert.equal(await code(s.updateUser('00000000-0000-4000-8000-000000000000', { name: 'x' })), 'not_found');
    // an inactive or non-admin user can always be changed
    const ed = await makeUser(s, { email: 'ed@example.com', role: 'editor' });
    assert.equal((await s.updateUser(ed.id, { active: false })).active, false);
  });
  t('users: concurrent demotion of two admins leaves one admin', async (s) => {
    const a1 = await makeUser(s, { email: 'c1@example.com', role: 'admin' });
    const a2 = await makeUser(s, { email: 'c2@example.com', role: 'admin' });
    const r = await Promise.allSettled([s.updateUser(a1.id, { role: 'editor' }), s.updateUser(a2.id, { role: 'editor' })]);
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
    assert.equal((await s.listUsers()).filter((u) => u.role === 'admin' && u.active).length, 1);
  });

  // ------------------------------------------------------------ login attempts
  const LIM = { ip: 10, emailIp: 5, email: 50 };
  const reserve = (s, ip, email, limits = LIM) => s.reserveLoginAttempt({ ip_hash: ip, email, sinceMs: 900000, limits });
  t('login attempts: reserve records a failure; markLoginSuccess stops it counting; counts per ip, (email, ip) and email', async (s) => {
    for (let i = 0; i < 3; i++) assert.equal((await reserve(s, 'ipA', 'x@example.com')).limited, false);
    assert.equal((await reserve(s, 'ipB', 'x@example.com')).limited, false);
    const ok = await reserve(s, 'ipA', 'x@example.com');
    assert.equal(ok.limited, false); assert.ok(ok.id);
    assert.deepEqual(await s.countFailedAttempts({ ip_hash: 'ipA', email: 'x@example.com', sinceMs: 900000 }), { ip: 4, email_ip: 4, email: 5 });
    await s.markLoginSuccess(ok.id);
    assert.deepEqual(await s.countFailedAttempts({ ip_hash: 'ipA', email: 'x@example.com', sinceMs: 900000 }), { ip: 3, email_ip: 3, email: 4 });
    assert.deepEqual(await s.countFailedAttempts({ ip_hash: 'ipC', email: '', sinceMs: 900000 }), { ip: 0, email_ip: 0, email: 0 });
    assert.equal((await s.countFailedAttempts({ ip_hash: 'ipA', email: 'x@example.com', sinceMs: 1 })).ip <= 3, true);
  });
  t('login attempts: limited when ip >= 10, (email, ip) >= 5 or email >= 50; a limited request records nothing', async (s) => {
    for (let i = 0; i < 5; i++) assert.equal((await reserve(s, 'ip1', 'a@example.com')).limited, false);
    assert.equal((await reserve(s, 'ip1', 'a@example.com')).limited, true, '6th for the same (email, ip)');
    assert.equal((await reserve(s, 'ip2', 'a@example.com')).limited, false, 'same email from another ip is not locked out by ip1');
    assert.equal((await s.countFailedAttempts({ ip_hash: 'ip1', email: 'a@example.com', sinceMs: 900000 })).ip, 5, 'the refused attempt was not recorded');
    for (let i = 0; i < 5; i++) assert.equal((await reserve(s, 'ip3', `u${i}@example.com`)).limited, false);
    for (let i = 5; i < 10; i++) assert.equal((await reserve(s, 'ip3', `u${i}@example.com`)).limited, false);
    assert.equal((await reserve(s, 'ip3', 'new@example.com')).limited, true, '11th from one ip');
    assert.equal((await reserve(s, 'ip3', '')).limited, true, 'ip limit also applies to an empty email');
    // global per-email backstop (small limit to keep the test quick)
    const small = { ip: 1000, emailIp: 1000, email: 4 };
    for (let i = 0; i < 4; i++) assert.equal((await reserve(s, `ipx${i}`, 'victim@example.com', small)).limited, false);
    assert.equal((await reserve(s, 'ipx9', 'victim@example.com', small)).limited, true);
  });
  t('login attempts: 20 concurrent reservations for one (email, ip) admit exactly the limit', async (s) => {
    const rs = await Promise.all(Array.from({ length: 20 }, () => reserve(s, 'ipC1', 'race@example.com')));
    assert.equal(rs.filter((r) => !r.limited).length, 5);
    assert.equal(rs.filter((r) => r.limited).length, 15);
    const rs2 = await Promise.all(Array.from({ length: 25 }, (_, i) => reserve(s, 'ipC2', `race${i}@example.com`)));
    assert.equal(rs2.filter((r) => !r.limited).length, 10, 'the ip limit holds across different emails');
  });

  // ------------------------------------------------------------ content
  t('content: seeded from defaults as draft and revision #1', async (s) => {
    const st = await s.getContentState();
    assert.deepEqual(st.draft, loadDefaultContent());
    assert.deepEqual(st.published, loadDefaultContent());
    assert.equal(st.published_revision, 1);
    assert.equal(st.draft_updated_by_id, null);
    const pub = await s.getPublished();
    assert.equal(pub.revision, 1); assert.deepEqual(pub.data, loadDefaultContent());
    const revs = await s.listRevisions({});
    assert.equal(revs.total, 1); assert.equal(revs.rows[0].published_by_name, 'System');
  });
  t('content: save draft with optimistic concurrency', async (s) => {
    const u = await makeUser(s, { email: 'e@example.com', name: 'Eddie' });
    const st = await s.getContentState();
    const next = { ...st.draft, settings: { ...st.draft.settings, siteName: 'Changed' } };
    const saved = await s.saveDraft({ data: next, base_updated_at: st.draft_updated_at, user_id: u.id });
    assert.ok(saved.draft_updated_at > st.draft_updated_at);
    const after = await s.getContentState();
    assert.equal(after.draft.settings.siteName, 'Changed');
    assert.equal(after.draft_updated_by_name, 'Eddie');
    assert.equal(after.published.settings.siteName, 'Test Co', 'published untouched');
    // stale base -> conflict, nothing changes
    let err;
    try { await s.saveDraft({ data: { ...next, texts: { 'home.title': 'x' } }, base_updated_at: st.draft_updated_at, user_id: u.id }); } catch (e) { err = e; }
    assert.equal(err.code, 'conflict');
    assert.equal(err.current.updated_at, saved.draft_updated_at);
    assert.equal(err.current.updated_by_name, 'Eddie');
    assert.equal((await s.getContentState()).draft.texts['home.title'], 'Home title');
    // two saves with the same base: exactly one wins
    const base = (await s.getContentState()).draft_updated_at;
    const r = await Promise.allSettled([1, 2].map((n) => s.saveDraft({ data: { ...next, texts: { 'home.title': 'T' + n } }, base_updated_at: base, user_id: u.id })));
    assert.equal(r.filter((x) => x.status === 'fulfilled').length, 1);
  });
  t('content: publish creates revision N+1; getPublished serves it', async (s) => {
    const u = await makeUser(s, { email: 'p@example.com', name: 'Pat' });
    const st = await s.getContentState();
    await s.saveDraft({ data: { ...st.draft, settings: { ...st.draft.settings, siteName: 'V2' } }, base_updated_at: st.draft_updated_at, user_id: u.id });
    const rev = await s.publish({ user_id: u.id, note: 'second' });
    assert.equal(rev.id, 2); assert.equal(rev.note, 'second');
    assert.equal((await s.getPublished()).data.settings.siteName, 'V2');
    const list = await s.listRevisions({});
    assert.deepEqual(list.rows.map((r) => r.id), [2, 1]);
    assert.equal(list.published_revision, 2);
    assert.equal(list.rows[0].published_by_name, 'Pat');
    assert.equal((await s.getRevision(1)).data.settings.siteName, 'Test Co');
    assert.equal(await s.getRevision(99), null);
    assert.equal(await s.getRevision('abc'), null);
  });
  t('content: rollback creates a new revision equal to the target and resets the draft', async (s) => {
    const u = await makeUser(s, { email: 'r@example.com' });
    let st = await s.getContentState();
    await s.saveDraft({ data: { ...st.draft, settings: { ...st.draft.settings, siteName: 'V2' } }, base_updated_at: st.draft_updated_at, user_id: u.id });
    await s.publish({ user_id: u.id, note: 'v2' });
    const rb = await s.rollback({ id: 1, user_id: u.id });
    assert.equal(rb.revision.id, 3); assert.equal(rb.revision.note, 'Rollback to #1');
    st = await s.getContentState();
    assert.equal(st.published_revision, 3);
    assert.equal(st.draft.settings.siteName, 'Test Co');
    assert.equal((await s.getPublished()).data.settings.siteName, 'Test Co');
    assert.deepEqual((await s.getRevision(3)).data, (await s.getRevision(1)).data);
    assert.equal(await code(s.rollback({ id: 99, user_id: u.id })), 'not_found');
    assert.equal((await s.listRevisions({})).total, 3, 'failed rollback adds nothing');
  });
  t('content: publish refuses an unchanged draft (nothing_to_publish) and creates no revision', async (s) => {
    assert.equal(await code(s.publish({ user_id: null, note: 'x' })), 'nothing_to_publish');
    assert.equal((await s.listRevisions({})).total, 1);
    // an edit that is then reverted by hand is equal again
    const u = await makeUser(s, { email: 'np@example.com' });
    const st = await s.getContentState();
    const saved = await s.saveDraft({ data: { ...st.draft, settings: { ...st.draft.settings, siteName: 'Other' } }, base_updated_at: st.draft_updated_at, user_id: u.id });
    await s.saveDraft({ data: st.draft, base_updated_at: saved.draft_updated_at, user_id: u.id });
    assert.equal(await code(s.publish({ user_id: u.id, note: 'x' })), 'nothing_to_publish');
  });
  t('content: publish pins base_updated_at under the lock and re-validates the locked draft', async (s) => {
    const u = await makeUser(s, { email: 'pin@example.com', name: 'Pia' });
    const st = await s.getContentState();
    const mk = (v) => ({ ...st.draft, settings: { ...st.draft.settings, siteName: v } });
    const s1 = await s.saveDraft({ data: mk('A'), base_updated_at: st.draft_updated_at, user_id: u.id });
    const s2 = await s.saveDraft({ data: mk('B'), base_updated_at: s1.draft_updated_at, user_id: u.id });
    let err;
    try { await s.publish({ user_id: u.id, note: 'stale', base_updated_at: s1.draft_updated_at }); } catch (e) { err = e; }
    assert.equal(err.code, 'conflict');
    assert.equal(err.current.updated_at, s2.draft_updated_at); assert.equal(err.current.updated_by_name, 'Pia');
    assert.equal((await s.listRevisions({})).total, 1);
    // check() sees the locked draft; returning errors aborts with invalid_input
    let seen = null;
    err = null;
    try { await s.publish({ user_id: u.id, base_updated_at: s2.draft_updated_at, check: (d) => { seen = d.settings.siteName; return { 'settings.siteName': 'nope' }; } }); } catch (e) { err = e; }
    assert.equal(seen, 'B'); assert.equal(err.code, 'invalid_input'); assert.deepEqual({ ...err.errors }, { 'settings.siteName': 'nope' });
    assert.equal((await s.listRevisions({})).total, 1);
    const rev = await s.publish({ user_id: u.id, note: 'ok', base_updated_at: s2.draft_updated_at, check: () => null });
    assert.equal(rev.id, 2); assert.deepEqual(rev.sections, ['settings']);
    // no base: still allowed (backward compatible)
    const s3 = await s.saveDraft({ data: mk('C'), base_updated_at: s2.draft_updated_at, user_id: u.id });
    assert.equal((await s.publish({ user_id: u.id, note: 'no base' })).id, 3);
    assert.ok(s3.draft_updated_at);
  });
  t('content: only the newest 200 revisions are kept and the published one is never deleted', async (s) => {
    const u = await makeUser(s, { email: 'ret@example.com' });
    let base = (await s.getContentState());
    for (let i = 0; i < 204; i++) {
      const saved = await s.saveDraft({ data: { ...base.draft, settings: { ...base.draft.settings, siteName: `Rev ${i}` } }, base_updated_at: base.draft_updated_at, user_id: u.id });
      base = { draft: base.draft, draft_updated_at: saved.draft_updated_at };
      await s.publish({ user_id: u.id, note: `n${i}` });
    }
    const list = await s.listRevisions({ limit: 100 });
    assert.equal(list.total, 200);
    assert.equal(list.rows[0].id, 205);
    assert.equal(await s.getRevision(1), null, 'oldest revisions are gone');
    assert.equal(await s.getRevision(5), null);
    assert.ok(await s.getRevision(6));
    // a rollback to a surviving revision keeps the count at 200 and the published row intact
    const rb = await s.rollback({ id: 10, user_id: u.id });
    assert.equal(rb.revision.id, 206);
    assert.equal((await s.listRevisions({})).total, 200);
    assert.equal((await s.getPublished()).revision, 206);
    assert.equal(await code(s.rollback({ id: 1, user_id: u.id })), 'not_found');
  });
  t('media: findMissingMedia returns the URLs without a media row; findRevisionsUsing is exact', async (s) => {
    const row = await s.addMedia({ url: 'https://x.public.blob.vercel-storage.com/media/here.png', pathname: 'media/here.png', content_type: 'image/png', size: 10 });
    assert.deepEqual(await s.findMissingMedia([row.url, 'https://x.public.blob.vercel-storage.com/media/gone.png', 'https://x.public.blob.vercel-storage.com/media/gone.png']), ['https://x.public.blob.vercel-storage.com/media/gone.png']);
    assert.deepEqual(await s.findMissingMedia([]), []);
    assert.deepEqual(await s.findRevisionsUsing('/assets/img/does-not-exist.png'), []);
  });
  t('content: discard resets the draft to the published revision', async (s) => {
    const u = await makeUser(s, { email: 'd@example.com' });
    const st = await s.getContentState();
    await s.saveDraft({ data: { ...st.draft, settings: { ...st.draft.settings, siteName: 'Draft only' } }, base_updated_at: st.draft_updated_at, user_id: u.id });
    const d = await s.discardDraft({ user_id: u.id });
    const after = await s.getContentState();
    assert.equal(after.draft.settings.siteName, 'Test Co');
    assert.equal(after.draft_updated_at, d.draft_updated_at);
    assert.equal((await s.listRevisions({})).total, 1);
  });

  // ------------------------------------------------------------ media
  t('media: add, list, get, update alt, delete', async (s) => {
    const u = await makeUser(s, { email: 'm@example.com' });
    const row = await s.addMedia({ url: 'https://x.public.blob.vercel-storage.com/media/a.png', pathname: 'media/a.png', content_type: 'image/png', size: 10, width: 1, height: 2, uploaded_by: u.id });
    assert.equal(row.alt, ''); assert.equal(row.width, 1);
    assert.equal((await s.getMedia(row.id)).pathname, 'media/a.png');
    assert.equal(await s.getMedia('nope'), null);
    assert.equal((await s.updateMedia(row.id, { alt: 'Logo' })).alt, 'Logo');
    assert.equal(await code(s.updateMedia('00000000-0000-4000-8000-000000000000', { alt: 'x' })), 'not_found');
    assert.equal((await s.listMedia({})).total, 1);
    assert.equal(await s.deleteMedia(row.id), true);
    assert.equal(await s.deleteMedia(row.id), false);
    assert.equal((await s.listMedia({})).total, 0);
  });

  // ------------------------------------------------------------ audit
  t('audit: newest first with user names, paged, detail kept', async (s) => {
    const u = await makeUser(s, { email: 'au@example.com', name: 'Audrey' });
    await s.addAudit({ user_id: u.id, action: 'one', target: 't1', detail: { a: 1 } });
    await s.addAudit({ user_id: null, action: 'two', target: 't2' });
    const r = await s.listAudit({});
    assert.equal(r.total, 2);
    assert.deepEqual(r.rows.map((x) => x.action), ['two', 'one']);
    assert.equal(r.rows[1].user_name, 'Audrey'); assert.deepEqual(r.rows[1].detail, { a: 1 });
    assert.equal(r.rows[0].user_name, null);
    assert.equal((await s.listAudit({ limit: 1, offset: 1 })).rows[0].action, 'one');
  });
}

module.exports = { defineStoreSuite };
