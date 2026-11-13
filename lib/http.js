'use strict';
const crypto = require('crypto');

/** Error carrying an HTTP status and machine code. */
class HttpError extends Error {
  constructor(status, code, message) {
    super(message || code);
    this.status = status;
    this.code = code;
  }
}

const JSON_CT = /^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i;

function header(req, name) {
  const v = req && req.headers ? req.headers[name] : undefined;
  return Array.isArray(v) ? v[0] : v;
}

const STREAM_TIMEOUT_MS = 5000;

function readStream(req, maxBytes, timeoutMs = STREAM_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    let settled = false;
    const done = (fn, v) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      fn(v);
    };
    const timer = setTimeout(() => done(reject, new HttpError(400, 'bad_json', 'Request body timed out')), timeoutMs);
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { tooBig = true; chunks.length = 0; return; } // keep draining, stop buffering
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => (tooBig ? done(reject, new HttpError(413, 'too_large', 'Request body too large')) : done(resolve, Buffer.concat(chunks))));
    req.on('error', () => done(reject, new HttpError(400, 'bad_json', 'Could not read request body')));
    req.on('aborted', () => done(reject, new HttpError(400, 'bad_json', 'Request aborted')));
    req.on('close', () => done(reject, new HttpError(400, 'bad_json', 'Request closed')));
  });
}

/**
 * Read a JSON object body. Works for Vercel (req.body already parsed: object, string or Buffer)
 * and for a raw Node stream. Throws HttpError: 415 unsupported_media, 413 too_large, 400 bad_json.
 * req.body is a lazy getter on Vercel and can throw on malformed input; req.body === null means the parser failed.
 */
async function readJson(req, maxBytes = 32768) {
  if (!JSON_CT.test(String(header(req, 'content-type') || ''))) {
    throw new HttpError(415, 'unsupported_media', 'Content-Type must be application/json');
  }
  let raw;
  try { raw = req.body; } catch (e) { throw new HttpError(400, 'bad_json', 'Invalid JSON'); }
  if (raw === null) throw new HttpError(400, 'bad_json', 'Invalid JSON');
  if (raw === undefined) {
    if (typeof req.on !== 'function' || req.readableEnded) throw new HttpError(400, 'bad_json', 'Empty request body');
    raw = await readStream(req, maxBytes);
  }
  if (Buffer.isBuffer(raw)) raw = raw.toString('utf8');
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw) > maxBytes) throw new HttpError(413, 'too_large', 'Request body too large');
    try { raw = JSON.parse(raw); } catch (e) { throw new HttpError(400, 'bad_json', 'Invalid JSON'); }
  } else if (typeof raw === 'object') {
    let len;
    try { len = Buffer.byteLength(JSON.stringify(raw)); } catch (e) { throw new HttpError(400, 'bad_json', 'Invalid JSON'); }
    if (len > maxBytes) throw new HttpError(413, 'too_large', 'Request body too large');
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'bad_json', 'JSON body must be an object');
  return raw;
}

function baseHeaders(res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Robots-Tag', 'noindex');
}

/** Send a JSON response with the standard API headers. */
function send(res, status, obj, extraHeaders) {
  baseHeaders(res);
  for (const [k, v] of Object.entries(extraHeaders || {})) res.setHeader(k, v);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}

function sendError(res, status, code, error, extra, extraHeaders) {
  send(res, status, { ok: false, error, code, ...(extra || {}) }, extraHeaders);
}

function sendText(res, status, contentType, body, extraHeaders) {
  baseHeaders(res);
  for (const [k, v] of Object.entries(extraHeaders || {})) res.setHeader(k, v);
  res.statusCode = status;
  res.setHeader('Content-Type', contentType);
  res.end(body);
}

const firstHop = (v) => String(Array.isArray(v) ? v[0] : v || '').split(',')[0].trim();

/**
 * Client IP, resistant to header spoofing.
 * - On Vercel (process.env.VERCEL): x-vercel-forwarded-for (set by the platform), then x-real-ip, then first x-forwarded-for hop.
 * - Elsewhere (server.js/local): the socket address; x-forwarded-for's first hop only when TRUST_PROXY === '1'.
 */
function clientIp(req) {
  if (process.env.VERCEL) {
    for (const h of ['x-vercel-forwarded-for', 'x-real-ip', 'x-forwarded-for']) {
      const v = firstHop(header(req, h));
      if (v) return v;
    }
  } else if (process.env.TRUST_PROXY === '1') {
    const v = firstHop(header(req, 'x-forwarded-for'));
    if (v) return v;
  }
  return (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
}

/** Normalise an IP for hashing: IPv4-mapped IPv6 becomes IPv4; other IPv6 is truncated to its /64 (first four groups). */
function normalizeIp(ip) {
  let s = String(ip || '').trim().toLowerCase();
  if (!s) return '';
  s = s.replace(/^\[|\]$/g, '').replace(/%.*$/, ''); // [v6] brackets and zone id
  const mapped = /^(?:0{1,4}:){0,5}:?(?:ffff:)(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s) || /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(s);
  if (mapped) return mapped[1];
  if (!s.includes(':')) return s; // IPv4 (or unknown token): as is
  // Expand "::" to a full list of 8 groups, then keep the first four.
  let head = s;
  let tail = '';
  let compressed = false;
  const i = s.indexOf('::');
  if (i >= 0) { compressed = true; head = s.slice(0, i); tail = s.slice(i + 2); }
  const toGroups = (x) => (x ? x.split(':') : []);
  let hg = toGroups(head);
  const tg = toGroups(tail);
  // A trailing dotted IPv4 counts as two groups.
  const expandV4 = (g) => g.flatMap((x) => (x.includes('.') ? ['0', '0'] : [x]));
  hg = expandV4(hg);
  const tgx = expandV4(tg);
  let groups;
  if (compressed) {
    const fill = Math.max(8 - hg.length - tgx.length, 0);
    groups = [...hg, ...Array(fill).fill('0'), ...tgx];
  } else {
    groups = hg;
  }
  if (groups.length === 8 && groups.slice(0, 5).every((g) => /^0+$/.test(g)) && groups[5] === 'ffff') {
    const hi = parseInt(groups[6], 16) || 0; const lo = parseInt(groups[7], 16) || 0; // ::ffff:0102:0304 form
    return [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');
  }
  return groups.slice(0, 4).map((g) => (g.replace(/^0+(?=.)/, '') || '0')).join(':') + '::/64';
}

/** Salted HMAC-SHA256 (hex) of the normalised IP (IPv6 reduced to /64). The raw IP is never stored or logged. */
function ipHash(ip) {
  const salt = process.env.IP_SALT || process.env.SESSION_SECRET || 'vfi-dev-ip-salt';
  return crypto.createHmac('sha256', salt).update(normalizeIp(ip) || 'unknown').digest('hex');
}

/** Query params as a plain object (Vercel/Express set req.query; fall back to parsing req.url). */
function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams); } catch (e) { return {}; }
}

module.exports = { HttpError, readJson, send, sendError, sendText, clientIp, ipHash, normalizeIp, getQuery, header };
