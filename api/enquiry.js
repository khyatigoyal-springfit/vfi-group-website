'use strict';
// POST /api/enquiry  (Vercel function and Express handler)
const { readJson, send, sendError, clientIp, ipHash, header, HttpError } = require('../lib/http');
const { validateEnquiry } = require('../lib/validate');
const { getStore } = require('../lib/store');
const mail = require('../lib/mail');

const MIN_OPEN_MS = 2500;
const MAIL_BUDGET_MS = 3000; // the visitor never waits longer than this for email

/** Await mail.notify() for at most MAIL_BUDGET_MS. Never rejects. */
async function notifyBounded(e) {
  let timer;
  try {
    const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve('timeout'), MAIL_BUDGET_MS); });
    const r = await Promise.race([Promise.resolve().then(() => mail.notify(e)).catch(() => false), timeout]);
    if (r === 'timeout') console.error('Enquiry email timed out', e && e.ref);
  } catch (err) {
    console.error('Enquiry email error', e && e.ref);
  } finally {
    clearTimeout(timer);
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed', null, { Allow: 'POST' });
    }

    let body;
    try {
      body = await readJson(req, 32768);
    } catch (e) {
      if (e instanceof HttpError) {
        const msg = { unsupported_media: 'Content-Type must be application/json', too_large: 'Request is too large', bad_json: 'Invalid JSON' }[e.code] || 'Bad request';
        return sendError(res, e.status, e.code, msg);
      }
      throw e;
    }

    // Bot traps: honeypot filled, or form open for < 2.5 s (missing / non-numeric t counts as a bot).
    const t = typeof body.t === 'number' ? body.t : (typeof body.t === 'string' && body.t.trim() !== '' ? Number(body.t) : NaN);
    if (body.website || !(t >= MIN_OPEN_MS)) {
      return send(res, 200, { ok: true, ref: 'VFI-OK' });
    }

    const v = validateEnquiry(body);
    if (!v.ok) return sendError(res, 422, 'invalid_input', 'Please correct the highlighted fields.', { errors: v.errors });

    const enquiry = {
      ...v.value,
      ip_hash: ipHash(clientIp(req)),
      user_agent: String(header(req, 'user-agent') || '').slice(0, 300),
    };

    let saved;
    try {
      saved = await getStore().submitEnquiry(enquiry);
    } catch (e) {
      if (e && e.code === 'rate_limited') return sendError(res, 429, 'rate_limited', 'Too many enquiries from your connection. Please try again in about 10 minutes.');
      if (e && e.code === 'invalid_input') return sendError(res, 422, 'invalid_input', 'Please correct the highlighted fields.', { errors: {} });
      console.error('Enquiry store failure:', e && e.code ? e.code : 'error');
      return sendError(res, 503, 'unavailable', 'We could not save your enquiry right now. Please try again shortly.');
    }

    await notifyBounded({ ...v.value, ref: saved.ref }); // bounded to 3 s; email failure/timeout must not fail the request
    return send(res, 200, { ok: true, ref: saved.ref });
  } catch (e) {
    console.error('Enquiry handler error:', e && e.name);
    if (!res.headersSent) return sendError(res, 500, 'server_error', 'Something went wrong. Please try again.');
  }
};
