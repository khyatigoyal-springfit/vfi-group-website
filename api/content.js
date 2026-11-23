'use strict';
// GET /api/content           published site content (CDN cached 60 s, ETag)
// GET /api/content?draft=1   draft content for the preview (editor/admin session, never cached)
const crypto = require('crypto');
const { send, sendError, getQuery, header } = require('../lib/http');
const { getStore } = require('../lib/store');
const { authenticate, can } = require('../lib/auth/guard');
const { loadDefaultContent } = require('../lib/content/defaults');

const PUBLISHED_CC = 'public, s-maxage=60, stale-while-revalidate=300';
const DEFAULTS_CC = 'public, s-maxage=30, stale-while-revalidate=60';

const etagOf = (body) => '"' + crypto.createHash('sha1').update(body).digest('hex') + '"';
function matches(req, etag) {
  const inm = String(header(req, 'if-none-match') || '');
  if (!inm) return false;
  if (inm.trim() === '*') return true;
  return inm.split(',').some((t) => t.trim().replace(/^W\//, '') === etag);
}

function sendContent(req, res, data, cacheControl, source, extra) {
  const body = JSON.stringify(data);
  const etag = etagOf(body);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Cache-Control', cacheControl);
  res.setHeader('X-Content-Source', source);
  for (const [k, v] of Object.entries(extra || {})) res.setHeader(k, v);
  if (cacheControl !== 'no-store') {
    res.setHeader('ETag', etag);
    if (matches(req, etag)) { res.statusCode = 304; return res.end(); }
  }
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.end(req.method === 'HEAD' ? undefined : body);
}

async function draftContent(req, res) {
  let user;
  try { user = await authenticate(req, getStore()); } catch (e) {
    if (e && e.status) return sendError(res, e.status, e.code, e.message);
    return sendError(res, 503, 'unavailable', 'The data store is unavailable. Please try again shortly.');
  }
  if (!user) return sendError(res, 401, 'unauthenticated', 'Please sign in.');
  if (user.must_change_password) return sendError(res, 403, 'password_change_required', 'Change your password first.');
  if (!can(user.role, 'content', 'GET')) return sendError(res, 403, 'forbidden', 'You do not have access to this.');
  try {
    const st = await getStore().getContentState();
    if (!st) return sendError(res, 503, 'unavailable', 'The data store is unavailable. Please try again shortly.');
    return sendContent(req, res, st.draft, 'no-store', 'draft');
  } catch (e) {
    return sendError(res, 503, 'unavailable', 'The data store is unavailable. Please try again shortly.');
  }
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendError(res, 405, 'method_not_allowed', 'Method not allowed', null, { Allow: 'GET, HEAD' });
    }
    const q = getQuery(req);
    const d = Array.isArray(q.draft) ? q.draft[0] : q.draft;
    if (d === '1' || d === 'true') return await draftContent(req, res);

    try {
      const pub = await getStore().getPublished();
      if (pub && pub.data) return sendContent(req, res, pub.data, PUBLISHED_CC, 'published', { 'X-Content-Revision': String(pub.revision) });
    } catch (e) {
      console.error('Content store failure, serving bundled defaults:', (e && e.code) || (e && e.name));
    }
    // Fail closed to the bundled defaults: the public site must never be blank.
    return sendContent(req, res, loadDefaultContent(), DEFAULTS_CC, 'defaults');
  } catch (e) {
    console.error('Content handler error:', e && e.name);
    if (!res.headersSent) return send(res, 500, { ok: false, error: 'Something went wrong.', code: 'server_error' });
  }
};
