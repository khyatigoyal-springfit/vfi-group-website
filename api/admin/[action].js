'use strict';
// /api/admin/<action>: login, logout, session, enquiries (GET/PATCH), export.
const crypto = require('crypto');
const { readJson, send, sendError, sendText, clientIp, ipHash, getQuery, header, HttpError } = require('../../lib/http');
const session = require('../../lib/session');
const { createLimiter } = require('../../lib/ratelimit');
const { toCsv } = require('../../lib/csv');
const { STATUSES, UUID_RE, LIMITS, clean } = require('../../lib/validate');
const { getStore } = require('../../lib/store');

const loginLimiter = createLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
const FAIL_DELAY_MS = 400;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

const configured = () => Boolean(process.env.ADMIN_PASSWORD && process.env.SESSION_SECRET);
const isAuthed = (req) => Boolean(session.fromRequest(req, process.env.SESSION_SECRET));
const stripPrivate = (r) => { if (!r || typeof r !== 'object') return r; const { ip_hash, ...rest } = r; return rest; };

function methodNotAllowed(res, allow) {
  return sendError(res, 405, 'method_not_allowed', 'Method not allowed', null, { Allow: allow });
}
const unauthenticated = (res) => sendError(res, 401, 'unauthenticated', 'Please sign in.');

function requireCsrf(req, res) {
  if (header(req, 'x-requested-with') !== 'vfi-admin') {
    sendError(res, 403, 'csrf', 'Missing or invalid request header.');
    return false;
  }
  return true;
}

function storeFailure(res, e, what) {
  const code = e && e.code;
  if (code === 'not_found') return sendError(res, 404, 'not_found', 'Enquiry not found.');
  if (code === 'invalid_input') return sendError(res, 422, 'invalid_input', 'Invalid input.', { errors: {} });
  if (code === 'forbidden') console.error(`Admin ${what}: store rejected the admin secret (check SUPABASE_ADMIN_SECRET and the stored hash)`);
  else console.error(`Admin ${what}: store failure`, code || (e && e.name));
  return sendError(res, 503, 'unavailable', 'The data store is unavailable. Please try again shortly.');
}

function filters(req, res) {
  const qs = getQuery(req);
  const one = (v) => (Array.isArray(v) ? v[0] : v);
  let status = String(one(qs.status) || '').trim();
  if (status === 'active') status = '';
  if (status && status !== 'all' && !STATUSES.includes(status)) {
    sendError(res, 422, 'invalid_input', 'Invalid filter.', { errors: { status: 'Unknown status' } });
    return null;
  }
  const q = clean(one(qs.q)).slice(0, 200);
  return { status, q, qs, one };
}

async function login(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!configured()) return sendError(res, 503, 'admin_not_configured', 'Admin is not configured on this server.');
  if (!requireCsrf(req, res)) return;
  const key = ipHash(clientIp(req));
  if (loginLimiter.isLimited(key)) {
    return sendError(res, 429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.', null, { 'Retry-After': '900' });
  }
  let body;
  try { body = await readJson(req, 4096); } catch (e) {
    if (e instanceof HttpError) return sendError(res, e.status, e.code, e.message);
    throw e;
  }
  const pw = typeof body.password === 'string' ? body.password : '';
  const ok = pw !== '' && crypto.timingSafeEqual(sha(pw), sha(process.env.ADMIN_PASSWORD));
  if (!ok) {
    loginLimiter.hit(key);
    await sleep(FAIL_DELAY_MS);
    return sendError(res, 401, 'bad_credentials', 'Incorrect password.');
  }
  loginLimiter.reset(key);
  session.setCookie(res, req, session.sign(process.env.SESSION_SECRET));
  return send(res, 200, { ok: true });
}

async function logout(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, 'POST');
  if (!requireCsrf(req, res)) return;
  session.clearCookie(res, req);
  return send(res, 200, { ok: true });
}

async function sessionInfo(req, res) {
  if (req.method !== 'GET' && req.method !== 'HEAD') return methodNotAllowed(res, 'GET, HEAD');
  return send(res, 200, { ok: true, authenticated: configured() && isAuthed(req) });
}

async function enquiries(req, res) {
  if (req.method !== 'GET' && req.method !== 'PATCH') return methodNotAllowed(res, 'GET, PATCH');
  if (!configured() || !isAuthed(req)) return unauthenticated(res);

  if (req.method === 'GET') {
    const f = filters(req, res);
    if (!f) return;
    const num = (v, d) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) && n >= 1 ? n : d; };
    const page = num(f.one(f.qs.page), 1);
    const pageSize = Math.min(num(f.one(f.qs.pageSize), 25), 100);
    try {
      const r = await getStore().listEnquiries({ status: f.status, q: f.q, limit: pageSize, offset: (page - 1) * pageSize });
      return send(res, 200, { ok: true, rows: (r.rows || []).map(stripPrivate), total: r.total, counts: r.counts, page, pageSize });
    } catch (e) { return storeFailure(res, e, 'list'); }
  }

  if (!requireCsrf(req, res)) return;
  let body;
  try { body = await readJson(req, 16384); } catch (e) {
    if (e instanceof HttpError) return sendError(res, e.status, e.code, e.message);
    throw e;
  }
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
  if (Object.keys(errors).length) return sendError(res, 422, 'invalid_input', 'Please correct the highlighted fields.', { errors });
  try {
    const row = await getStore().updateEnquiry({ id, status, notes });
    return send(res, 200, { ok: true, row: stripPrivate(row) });
  } catch (e) { return storeFailure(res, e, 'update'); }
}

async function exportCsv(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, 'GET');
  if (!configured() || !isAuthed(req)) return unauthenticated(res);
  const f = filters(req, res);
  if (!f) return;
  try {
    const rows = (await getStore().exportEnquiries({ status: f.status, q: f.q })).map(stripPrivate);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return sendText(res, 200, 'text/csv; charset=utf-8', toCsv(rows), {
      'Content-Disposition': `attachment; filename="vfi-enquiries-${day}.csv"`,
    });
  } catch (e) { return storeFailure(res, e, 'export'); }
}

const ACTIONS = { login, logout, session: sessionInfo, enquiries, export: exportCsv };

module.exports = async function handler(req, res) {
  try {
    let action = getQuery(req).action;
    if (Array.isArray(action)) action = action[0];
    if (!action) {
      const m = /\/api\/admin\/([^/?#]+)/.exec(req.url || '');
      action = m ? decodeURIComponent(m[1]) : '';
    }
    const fn = Object.prototype.hasOwnProperty.call(ACTIONS, action) ? ACTIONS[action] : null;
    if (!fn) return sendError(res, 404, 'not_found', 'Not found');
    return await fn(req, res);
  } catch (e) {
    console.error('Admin handler error:', e && e.name);
    if (!res.headersSent) return sendError(res, 500, 'server_error', 'Something went wrong.');
  }
};
