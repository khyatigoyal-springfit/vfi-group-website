'use strict';
// /api/admin/<action>. Every action is declared in ACTIONS with its allowed methods; the role table lives in
// lib/auth/guard.js (PERMISSIONS). Order of checks: action exists -> method -> CSRF header -> session -> must_change_password -> role.
const { readJson, readRaw, send, sendError, sendText, clientIp, ipHash, ipSaltConfig, getQuery, header, HttpError } = require('../../lib/http');
const session = require('../../lib/auth/session');
const password = require('../../lib/auth/password');
const ratelimit = require('../../lib/auth/ratelimit');
const { authenticate, can, publicUser, ROLES } = require('../../lib/auth/guard');
const { toCsv } = require('../../lib/csv');
const { STATUSES, UUID_RE, LIMITS, clean, isEmail } = require('../../lib/validate');
const { getStore } = require('../../lib/store');
const { validate, isBlobUrl } = require('../../lib/content/validate');
const { loadSchema } = require('../../lib/content/defaults');
const { changedSections, findUsages, collectStrings } = require('../../lib/content/diff');
const media = require('../../lib/media');

const settings = { failDelayMs: 400, pruneEveryMs: 10 * 60 * 1000 }; // exported for tests
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const one = (v) => (Array.isArray(v) ? v[0] : v);
const GENERIC_LOGIN_ERROR = 'Incorrect email or password.';
const CONTENT_BODY_MAX = 700 * 1024;

// ------------------------------------------------------------------ helpers
const methodNotAllowed = (res, allow) => sendError(res, 405, 'method_not_allowed', 'Method not allowed', null, { Allow: allow });
const unauthenticated = (res) => sendError(res, 401, 'unauthenticated', 'Please sign in.');
const invalid = (res, errors, msg) => sendError(res, 422, 'invalid_input', msg || 'Please correct the highlighted fields.', { errors });
const unavailable = (res) => sendError(res, 503, 'unavailable', 'The data store is unavailable. Please try again shortly.');

/** Append an audit entry. A failing audit write is logged but never fails the request. */
async function audit(ctx, action, target, detail, userId) {
  try {
    await ctx.store.addAudit({ user_id: userId !== undefined ? userId : (ctx.user ? ctx.user.id : null), action, target: target || '', detail: detail || {} });
  } catch (e) { console.error('Audit write failed:', (e && e.code) || (e && e.name)); }
}

async function readBody(req, max) {
  const ct = String(header(req, 'content-type') || '');
  const len = header(req, 'content-length');
  if (!ct && (len === undefined || len === '0') && (req.body === undefined || req.body === null || req.body === '')) return {};
  return readJson(req, max);
}

function getPaging(req, defSize, maxSize) {
  const qs = getQuery(req);
  const num = (v, d) => { const n = Number.parseInt(one(v), 10); return Number.isFinite(n) && n >= 1 ? n : d; };
  const page = num(qs.page, 1);
  const pageSize = Math.min(num(qs.pageSize, defSize), maxSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

let lastPrune = 0;
/** Opportunistic retention (login_attempts > 30 days, audit_log > 365 days), at most once per settings.pruneEveryMs per instance. Never fails a request. */
async function maybePrune(store) {
  const now = Date.now();
  if (now - lastPrune < settings.pruneEveryMs) return;
  lastPrune = now;
  try { await store.pruneOld(); } catch (e) { console.error('Retention prune failed:', (e && e.code) || (e && e.name)); }
}

const stripPrivate = (r) => { if (!r || typeof r !== 'object') return r; const { ip_hash, ...rest } = r; return rest; };

function filters(req, res) {
  const qs = getQuery(req);
  let status = String(one(qs.status) || '').trim();
  if (status === 'active') status = '';
  if (status && status !== 'all' && !STATUSES.includes(status)) {
    invalid(res, { status: 'Unknown status' }, 'Invalid filter.');
    return null;
  }
  return { status, q: clean(one(qs.q)).slice(0, 200), qs };
}

async function contentSummary(store) {
  const st = await store.getContentState();
  if (!st) return null;
  const changed = changedSections(st.draft, st.published);
  return { st, changed };
}

// ------------------------------------------------------------------ session & account
async function login(ctx) {
  const { req, res, store } = ctx;
  if (!session.authConfig().ok) return sendError(res, 503, 'admin_not_configured', 'Admin is not configured on this server.');
  const body = await readJson(req, 4096);
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase().slice(0, 254) : '';
  const pw = typeof body.password === 'string' ? body.password : '';
  const ipH = ipHash(clientIp(req));

  // Check and record in one atomic step BEFORE verifying the password, so concurrent guesses cannot all slip past the limit.
  const attempt = await ratelimit.reserve(store, { ipHash: ipH, email });
  if (attempt.limited) {
    return sendError(res, 429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', null, { 'Retry-After': '900' });
  }
  const user = email ? await store.getUserByEmail(email) : null;
  const usable = Boolean(user && user.active);
  const candidate = pw.length <= password.MAX_LEN ? pw : '';
  // One scrypt run in every case (real or dummy hash) so timing does not reveal whether the account exists.
  const ok = usable && candidate !== '' ? await password.verifyPassword(candidate, user.password_hash) : await password.dummyVerify(candidate);
  if (!ok) {
    await audit(ctx, 'login_failed', email, {}, usable ? user.id : null);
    await sleep(settings.failDelayMs);
    return sendError(res, 401, 'bad_credentials', GENERIC_LOGIN_ERROR);
  }
  await ratelimit.markSuccess(store, attempt.id);
  await store.recordLogin(user.id);
  await audit(ctx, 'login', user.email, {}, user.id);
  await maybePrune(store);
  session.setCookie(res, req, session.sign(session.authConfig().secret, { uid: user.id, v: user.session_version }));
  return send(res, 200, { ok: true, user: publicUser(user) });
}

async function logout(ctx) {
  const { req, res } = ctx;
  // Logging out needs no valid session: it only clears the cookie. Audit only when we can tell who it was.
  try {
    const user = await authenticate(req, ctx.store);
    if (user) {
      // Revoke: a copied or stolen cookie must stop working. Bumping session_version signs this user out everywhere.
      await ctx.store.updateUser(user.id, { bump_session: true });
      await audit({ ...ctx, user }, 'logout', user.email, {});
    }
  } catch (e) { /* unavailable / not configured: still clear the cookie */ }
  session.clearCookie(res, req);
  return send(res, 200, { ok: true });
}

async function sessionInfo(ctx) {
  const { req, res } = ctx;
  const cfg = session.authConfig();
  if (!cfg.ok || !session.fromRequest(req, cfg.secret)) return send(res, 200, { ok: true, authenticated: false });
  const user = await authenticate(req, ctx.store);
  if (!user) return send(res, 200, { ok: true, authenticated: false });
  return send(res, 200, { ok: true, authenticated: true, user: publicUser(user) });
}

async function changePassword(ctx) {
  const { req, res, store, user } = ctx;
  const body = await readJson(req, 4096);
  const current = typeof body.current === 'string' ? body.current : '';
  const next = typeof body.next === 'string' ? body.next : '';
  const ipH = ipHash(clientIp(req));
  const errors = {};
  const policy = password.passwordPolicyError(next);
  if (policy) errors.next = policy;
  if (!current) errors.current = 'Enter your current password';
  if (Object.keys(errors).length) return invalid(res, errors);
  const attempt = await ratelimit.reserve(store, { ipHash: ipH, email: user.email }); // atomic check + record, as for login
  if (attempt.limited) {
    return sendError(res, 429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', null, { 'Retry-After': '900' });
  }
  const okCurrent = current.length <= password.MAX_LEN && await password.verifyPassword(current, user.password_hash);
  if (!okCurrent) {
    await audit(ctx, 'password_change_failed', user.email, {});
    await sleep(settings.failDelayMs);
    return invalid(res, { current: 'Current password is incorrect' });
  }
  await ratelimit.markSuccess(store, attempt.id);
  if (next === current) return invalid(res, { next: 'Choose a password different from the current one' });
  const updated = await store.updateUser(user.id, { password_hash: await password.hashPassword(next), must_change_password: false, bump_session: true });
  await audit(ctx, 'password_change', user.email, {});
  session.setCookie(res, req, session.sign(session.authConfig().secret, { uid: updated.id, v: updated.session_version }));
  return send(res, 200, { ok: true, user: publicUser(updated) });
}

async function account(ctx) {
  const { req, res, store, user } = ctx;
  const body = await readJson(req, 4096);
  const name = clean(body.name);
  if (typeof body.name !== 'string') return invalid(res, { name: 'Enter your name' });
  if (name.length > 120) return invalid(res, { name: 'Name must be 120 characters or fewer' });
  const updated = await store.updateUser(user.id, { name });
  await audit(ctx, 'account_update', user.email, {});
  return send(res, 200, { ok: true, user: publicUser(updated) });
}

// ------------------------------------------------------------------ enquiries
async function enquiries(ctx) {
  const { req, res, store } = ctx;
  if (req.method === 'GET') {
    const f = filters(req, res);
    if (!f) return undefined;
    const { page, pageSize, offset } = getPaging(req, 25, 100);
    const r = await store.listEnquiries({ status: f.status, q: f.q, limit: pageSize, offset });
    return send(res, 200, { ok: true, rows: (r.rows || []).map(stripPrivate), total: r.total, counts: r.counts, page, pageSize });
  }
  const body = await readJson(req, 16384);
  const errors = {};
  const id = typeof body.id === 'string' ? body.id.trim() : '';
  if (!UUID_RE.test(id)) errors.id = 'Invalid enquiry id';
  let status;
  if (body.status !== undefined && body.status !== null) {
    if (typeof body.status !== 'string' || !STATUSES.includes(body.status)) errors.status = 'Choose a valid status';
    else status = body.status;
  }
  let notes;
  if (body.notes !== undefined && body.notes !== null) {
    if (typeof body.notes !== 'string') errors.notes = 'Notes must be text';
    else {
      notes = body.notes.replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
      if (notes.length > LIMITS.notes) errors.notes = `Notes must be ${LIMITS.notes} characters or fewer`;
    }
  }
  if (Object.keys(errors).length) return invalid(res, errors);
  const row = await store.updateEnquiry({ id, status, notes });
  await audit(ctx, 'enquiry_update', id, { status: status || null, notes_changed: notes !== undefined });
  return send(res, 200, { ok: true, row: stripPrivate(row) });
}

async function exportCsv(ctx) {
  const { res, store, req } = ctx;
  const f = filters(req, res);
  if (!f) return undefined;
  const rows = (await store.exportEnquiries({ status: f.status, q: f.q })).map(stripPrivate);
  await audit(ctx, 'enquiry_export', f.status || 'active', { rows: rows.length, search: f.q !== '' });
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return sendText(res, 200, 'text/csv; charset=utf-8', toCsv(rows), { 'Content-Disposition': `attachment; filename="vfi-enquiries-${day}.csv"` });
}

// ------------------------------------------------------------------ content
async function content(ctx) {
  const { req, res, store, user } = ctx;
  if (req.method === 'GET') {
    const s = await contentSummary(store);
    if (!s) return unavailable(res);
    return send(res, 200, {
      ok: true, draft: s.st.draft, draft_updated_at: s.st.draft_updated_at, draft_updated_by: s.st.draft_updated_by_name,
      draft_updated_by_id: s.st.draft_updated_by_id, published_revision: s.st.published_revision,
      hasUnpublished: s.changed.length > 0, changed_sections: s.changed,
    });
  }
  // PUT
  const body = await readJson(req, CONTENT_BODY_MAX);
  const base = typeof body.base_updated_at === 'string' ? new Date(body.base_updated_at) : null;
  if (!base || Number.isNaN(base.getTime())) return invalid(res, { base_updated_at: 'base_updated_at is required' });
  if (!body.draft || typeof body.draft !== 'object' || Array.isArray(body.draft)) return invalid(res, { draft: 'draft must be an object' });
  const v = validate(body.draft, loadSchema());
  if (!v.ok) return invalid(res, v.errors, 'Some content is not valid. Please correct the highlighted fields.');
  let saved;
  try {
    saved = await store.saveDraft({ data: v.value, base_updated_at: base.toISOString(), user_id: user.id });
  } catch (e) {
    if (e && e.code === 'conflict') {
      const cur = e.current || {};
      return sendError(res, 409, 'conflict', 'Someone else saved changes to this draft since you opened it.', {
        updated_at: cur.updated_at || null, updated_by: cur.updated_by_name || null, updated_by_id: cur.updated_by_id || null,
      });
    }
    throw e;
  }
  await audit(ctx, 'content_save', 'draft', { bytes: Buffer.byteLength(JSON.stringify(v.value)) });
  const s = await contentSummary(store);
  return send(res, 200, {
    ok: true, draft: v.value, draft_updated_at: saved.draft_updated_at, draft_updated_by: user.name || user.email, draft_updated_by_id: user.id,
    published_revision: s ? s.st.published_revision : null, hasUnpublished: s ? s.changed.length > 0 : true, changed_sections: s ? s.changed : [],
  });
}

const conflictBody = (e) => {
  const cur = (e && e.current) || {};
  return { updated_at: cur.updated_at || null, updated_by: cur.updated_by_name || null, updated_by_id: cur.updated_by_id || null };
};

async function publish(ctx) {
  const { req, res, store, user } = ctx;
  const body = await readBody(req, 4096);
  if (body.note !== undefined && typeof body.note !== 'string') return invalid(res, { note: 'Note must be text' });
  const note = clean(body.note || '');
  if (note.length > 200) return invalid(res, { note: 'Note must be 200 characters or fewer' });
  // Optional (backward compatible): the draft_updated_at the editor was looking at. When present, only that exact draft is published.
  let base = null;
  if (body.base_updated_at !== undefined && body.base_updated_at !== null) {
    base = typeof body.base_updated_at === 'string' ? new Date(body.base_updated_at) : null;
    if (!base || Number.isNaN(base.getTime())) return invalid(res, { base_updated_at: 'base_updated_at must be a timestamp' });
  }
  let rev;
  try {
    // The store re-validates the locked draft (check), compares base_updated_at, and refuses an unchanged draft, all under one lock.
    rev = await store.publish({
      user_id: user.id, note, base_updated_at: base ? base.toISOString() : undefined,
      check: (draft) => { const v = validate(draft, loadSchema()); return v.ok ? null : v.errors; },
    });
  } catch (e) {
    if (e && e.code === 'conflict') return sendError(res, 409, 'conflict', 'The draft changed since you opened it. Review the latest draft before publishing.', conflictBody(e));
    if (e && e.code === 'nothing_to_publish') return sendError(res, 409, 'nothing_to_publish', 'There are no unpublished changes to publish.');
    if (e && e.code === 'invalid_input' && e.errors) return invalid(res, e.errors, 'The draft has content that is not valid, so it cannot be published yet.');
    if (e && e.code === 'not_found') return unavailable(res);
    throw e;
  }
  const { sections, ...revision } = rev;
  await audit(ctx, 'content_publish', `#${revision.id}`, { revision: revision.id, note, sections: sections || [] });
  await maybePrune(store);
  return send(res, 200, { ok: true, revision, published_revision: revision.id });
}

async function revisions(ctx) {
  const { req, res, store } = ctx;
  const { page, pageSize, offset } = getPaging(req, 25, 100);
  const r = await store.listRevisions({ limit: pageSize, offset });
  return send(res, 200, {
    ok: true, page, pageSize, total: r.total, published_revision: r.published_revision,
    rows: r.rows.map((x) => ({ id: x.id, note: x.note, published_by: x.published_by_name, published_by_id: x.published_by_id, published_at: x.published_at, is_current: x.id === r.published_revision })),
  });
}

async function revision(ctx) {
  const { req, res, store } = ctx;
  const raw = one(getQuery(req).id);
  const id = Number(raw);
  if (!Number.isInteger(id) || id < 1) return invalid(res, { id: 'Invalid revision id' });
  const [rev, pub] = await Promise.all([store.getRevision(id), store.getPublished()]);
  if (!rev) return sendError(res, 404, 'not_found', 'Revision not found.');
  return send(res, 200, {
    ok: true,
    revision: { id: rev.id, note: rev.note, published_by: rev.published_by_name, published_by_id: rev.published_by_id, published_at: rev.published_at, is_current: pub ? pub.revision === rev.id : false, data: rev.data },
    changed_sections: pub ? changedSections(rev.data, pub.data) : [],
  });
}

async function rollback(ctx) {
  const { req, res, store, user } = ctx;
  const body = await readJson(req, 1024);
  const id = Number(body.id);
  if (!Number.isInteger(id) || id < 1) return invalid(res, { id: 'Invalid revision id' });
  const src = await store.getRevision(id);
  if (!src) return sendError(res, 404, 'not_found', 'Revision not found.');
  // Refuse to publish a revision that points at uploaded images which no longer exist (would show broken images on the site).
  const urls = [...new Set(collectStrings(src.data, isBlobUrl))];
  const missing = urls.length ? await store.findMissingMedia(urls) : [];
  if (missing.length) {
    return sendError(res, 409, 'missing_media', 'This revision uses images that are no longer in the media library, so it cannot be restored.', { missing: missing.slice(0, 50), missing_count: missing.length });
  }
  try {
    const r = await store.rollback({ id, user_id: user.id });
    await audit(ctx, 'content_rollback', `#${id}`, { from: id, new_revision: r.revision.id });
    await maybePrune(store);
    return send(res, 200, { ok: true, revision: r.revision, published_revision: r.revision.id, draft_updated_at: r.draft_updated_at });
  } catch (e) {
    if (e && e.code === 'not_found') return sendError(res, 404, 'not_found', 'Revision not found.');
    throw e;
  }
}

async function discard(ctx) {
  const { res, store, user } = ctx;
  const r = await store.discardDraft({ user_id: user.id });
  await audit(ctx, 'content_discard', 'draft', {});
  return send(res, 200, { ok: true, draft_updated_at: r.draft_updated_at });
}

// ------------------------------------------------------------------ media
const mediaNotConfigured = (res) => sendError(res, 503, 'media_not_configured', 'Image uploads are not configured on this server.');

async function mediaAction(ctx) {
  const { req, res, store, user } = ctx;
  if (req.method === 'GET') {
    const { page, pageSize, offset } = getPaging(req, 50, 100);
    const r = await store.listMedia({ limit: pageSize, offset });
    return send(res, 200, { ok: true, rows: r.rows, total: r.total, page, pageSize });
  }
  if (req.method === 'PATCH') {
    const body = await readJson(req, 2048);
    const id = typeof body.id === 'string' ? body.id : '';
    if (!UUID_RE.test(id)) return invalid(res, { id: 'Invalid media id' });
    if (typeof body.alt !== 'string') return invalid(res, { alt: 'Alt text must be text' });
    const alt = clean(body.alt);
    if (alt.length > 200) return invalid(res, { alt: 'Alt text must be 200 characters or fewer' });
    try {
      const row = await store.updateMedia(id, { alt });
      await audit(ctx, 'media_update', id, {});
      return send(res, 200, { ok: true, media: row });
    } catch (e) {
      if (e && e.code === 'not_found') return sendError(res, 404, 'not_found', 'Image not found.');
      throw e;
    }
  }
  if (!media.isConfigured()) return mediaNotConfigured(res);

  if (req.method === 'POST') {
    let buf;
    try { buf = await readRaw(req, media.MAX_BYTES); } catch (e) {
      if (e instanceof HttpError) return sendError(res, e.status, e.code, e.status === 413 ? 'Image is too large (maximum 4 MB).' : e.message);
      throw e;
    }
    let alt = String(header(req, 'x-alt') || '');
    try { alt = decodeURIComponent(alt); } catch (e) { /* keep raw */ }
    alt = clean(alt).slice(0, 200);
    const info = media.inspectUpload(buf, header(req, 'content-type'), header(req, 'x-filename'));
    if (!info.ok) return sendError(res, info.status, info.code, info.error);
    const pathname = media.newPathname(info);
    const uploader = media.getUploader();
    let put;
    try { put = await uploader.put(pathname, buf, info.contentType); } catch (e) {
      console.error('Blob upload failed:', (e && e.name) || 'error');
      return sendError(res, 502, 'upload_failed', 'The image could not be stored. Please try again.');
    }
    let row;
    try {
      row = await store.addMedia({ url: put.url, pathname: put.pathname || pathname, content_type: info.contentType, size: buf.length, width: info.width, height: info.height, alt, uploaded_by: user.id });
    } catch (e) {
      try { await uploader.del(put.url); } catch (e2) { /* orphaned blob; nothing more to do */ }
      throw e;
    }
    await audit(ctx, 'media_upload', row.pathname, { id: row.id, size: row.size, content_type: row.content_type });
    return send(res, 200, { ok: true, media: row });
  }

  // DELETE
  const id = String(one(getQuery(req).id) || '');
  if (!UUID_RE.test(id)) return invalid(res, { id: 'Invalid media id' });
  const row = await store.getMedia(id);
  if (!row) return sendError(res, 404, 'not_found', 'Image not found.');
  const st = await store.getContentState();
  if (!st) return unavailable(res);
  const used = [
    ...findUsages(st.draft, row.url).map((path) => ({ where: 'draft', path })),
    ...findUsages(st.published, row.url).map((path) => ({ where: 'published', path })),
    // Every other stored revision too: a rollback would otherwise bring back a broken image. (The live revision is already reported as 'published'.)
    ...(await store.findRevisionsUsing(row.url, 21)).filter((id) => id !== st.published_revision).slice(0, 20).map((id) => ({ where: 'revision', id })),
  ];
  if (used.length) {
    return sendError(res, 409, 'in_use', 'This image is used in the site content or in an earlier revision and cannot be deleted. Remove it from the content first.', { used_in: used });
  }
  try { await media.getUploader().del(row.url); } catch (e) {
    console.error('Blob delete failed:', (e && e.name) || 'error');
    return sendError(res, 502, 'delete_failed', 'The image could not be deleted. Please try again.');
  }
  await store.deleteMedia(id);
  await audit(ctx, 'media_delete', row.pathname, { id });
  return send(res, 200, { ok: true });
}

// ------------------------------------------------------------------ users & audit
async function users(ctx) {
  const { req, res, store } = ctx;
  if (req.method === 'GET') {
    return send(res, 200, { ok: true, users: (await store.listUsers()).map(publicUser) });
  }
  const body = await readJson(req, 4096);
  if (req.method === 'POST') {
    const errors = {};
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    if (!email) errors.email = 'Enter an email address';
    else if (email.length > 200 || !isEmail(email)) errors.email = 'Enter a valid email address';
    const name = typeof body.name === 'string' ? clean(body.name) : '';
    if (name.length > 120) errors.name = 'Name must be 120 characters or fewer';
    if (!ROLES.includes(body.role)) errors.role = 'Choose a role';
    const policy = password.passwordPolicyError(body.password);
    if (policy) errors.password = policy;
    if (Object.keys(errors).length) return invalid(res, errors);
    try {
      const u = await store.createUser({ email, name, role: body.role, password_hash: await password.hashPassword(body.password), must_change_password: true });
      await audit(ctx, 'user_create', email, { role: body.role });
      return send(res, 200, { ok: true, user: publicUser(u) });
    } catch (e) {
      if (e && e.code === 'email_taken') return sendError(res, 409, 'email_taken', 'A user with this email already exists.', { errors: { email: 'A user with this email already exists' } });
      throw e;
    }
  }
  // PATCH
  const errors = {};
  const id = typeof body.id === 'string' ? body.id : '';
  if (!UUID_RE.test(id)) errors.id = 'Invalid user id';
  const patch = {};
  const changes = [];
  if (body.role !== undefined) { if (!ROLES.includes(body.role)) errors.role = 'Choose a role'; else { patch.role = body.role; changes.push('role'); } }
  if (body.active !== undefined) { if (typeof body.active !== 'boolean') errors.active = 'active must be true or false'; else { patch.active = body.active; changes.push(body.active ? 'activate' : 'deactivate'); if (!body.active) patch.bump_session = true; } }
  if (body.name !== undefined) { if (typeof body.name !== 'string' || clean(body.name).length > 120) errors.name = 'Name must be 120 characters or fewer'; else { patch.name = clean(body.name); changes.push('name'); } }
  let temp = null;
  if (body.resetPassword !== undefined && body.resetPassword !== false) {
    if (body.resetPassword !== true) errors.resetPassword = 'resetPassword must be true';
    else {
      temp = password.generateTempPassword();
      patch.password_hash = await password.hashPassword(temp);
      patch.must_change_password = true;
      patch.bump_session = true;
      changes.push('reset_password');
    }
  }
  if (!changes.length && !errors.id && !Object.keys(errors).length) errors.id = 'Nothing to change';
  if (Object.keys(errors).length) return invalid(res, errors);
  try {
    const u = await store.updateUser(id, patch);
    await audit(ctx, changes.includes('reset_password') ? 'user_reset_password' : 'user_update', u.email, { changes, role: patch.role });
    return send(res, 200, { ok: true, user: publicUser(u), ...(temp ? { temporary_password: temp } : {}) });
  } catch (e) {
    if (e && e.code === 'last_admin') return sendError(res, 409, 'last_admin', 'At least one active administrator must remain. Make another user an administrator first.');
    if (e && e.code === 'not_found') return sendError(res, 404, 'not_found', 'User not found.');
    throw e;
  }
}

async function auditLog(ctx) {
  const { req, res, store } = ctx;
  const { page, pageSize, offset } = getPaging(req, 50, 200);
  const r = await store.listAudit({ limit: pageSize, offset });
  return send(res, 200, { ok: true, rows: r.rows, total: r.total, page, pageSize });
}

// ------------------------------------------------------------------ routing
// auth: 'none' = no session needed (login, logout, session); otherwise the role table in guard.js decides.
const ACTIONS = {
  login: { methods: ['POST'], auth: 'none', fn: login },
  logout: { methods: ['POST'], auth: 'none', fn: logout },
  session: { methods: ['GET', 'HEAD'], auth: 'none', fn: sessionInfo },
  password: { methods: ['POST'], fn: changePassword },
  account: { methods: ['PATCH'], fn: account },
  enquiries: { methods: ['GET', 'PATCH'], fn: enquiries },
  export: { methods: ['GET'], fn: exportCsv },
  content: { methods: ['GET', 'PUT'], fn: content },
  publish: { methods: ['POST'], fn: publish },
  revisions: { methods: ['GET'], fn: revisions },
  revision: { methods: ['GET'], fn: revision },
  rollback: { methods: ['POST'], fn: rollback },
  discard: { methods: ['POST'], fn: discard },
  media: { methods: ['GET', 'POST', 'PATCH', 'DELETE'], fn: mediaAction },
  users: { methods: ['GET', 'POST', 'PATCH'], fn: users },
  audit: { methods: ['GET'], fn: auditLog },
};
const SELF_SERVICE = new Set(['session', 'logout', 'password']); // allowed while must_change_password is set

function failure(res, e) {
  if (e instanceof HttpError) return sendError(res, e.status, e.code, e.message);
  const code = e && e.code;
  if (code === 'unavailable') return unavailable(res);
  if (code === 'not_found') return sendError(res, 404, 'not_found', 'Not found.');
  if (code === 'invalid_input') return invalid(res, {});
  console.error('Admin handler error:', code || (e && e.name));
  return sendError(res, 500, 'server_error', 'Something went wrong.');
}

async function handler(req, res) {
  try {
    let action = one(getQuery(req).action);
    if (!action) {
      const m = /\/api\/admin\/([^/?#]+)/.exec(req.url || '');
      action = m ? decodeURIComponent(m[1]) : '';
    }
    const spec = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!spec) return sendError(res, 404, 'not_found', 'Not found');
    if (!spec.methods.includes(req.method)) return methodNotAllowed(res, spec.methods.join(', '));
    if (!ipSaltConfig().ok) return sendError(res, 503, 'not_configured', 'Admin is not configured on this server.'); // reason is logged by ipSaltConfig
    if (req.method !== 'GET' && req.method !== 'HEAD' && header(req, 'x-requested-with') !== 'vfi-admin') {
      return sendError(res, 403, 'csrf', 'Missing or invalid request header.');
    }
    const store = getStore();
    const ctx = { req, res, store, user: null };
    if (spec.auth !== 'none') {
      const user = await authenticate(req, store);
      if (!user) return unauthenticated(res);
      if (user.must_change_password && !SELF_SERVICE.has(action)) {
        return sendError(res, 403, 'password_change_required', 'You must change your password before continuing.');
      }
      if (!can(user.role, action, req.method)) return sendError(res, 403, 'forbidden', 'You do not have permission to do this.');
      ctx.user = user;
    }
    return await spec.fn(ctx);
  } catch (e) {
    if (res.headersSent) return undefined;
    return failure(res, e);
  }
}

module.exports = handler;
module.exports.settings = settings;
module.exports.ACTIONS = ACTIONS;
