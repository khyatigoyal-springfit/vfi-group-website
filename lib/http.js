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

function readStream(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let tooBig = false;
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { tooBig = true; chunks.length = 0; return; } // keep draining, stop buffering
      if (!tooBig) chunks.push(c);
    });
    req.on('end', () => (tooBig ? reject(new HttpError(413, 'too_large', 'Request body too large')) : resolve(Buffer.concat(chunks))));
    req.on('error', () => reject(new HttpError(400, 'bad_json', 'Could not read request body')));
  });
}

/**
 * Read a JSON object body. Works for Vercel (req.body already parsed: object, string or Buffer)
 * and for a raw Node stream. Throws HttpError: 415 unsupported_media, 413 too_large, 400 bad_json.
 */
async function readJson(req, maxBytes = 32768) {
  if (!JSON_CT.test(String(header(req, 'content-type') || ''))) {
    throw new HttpError(415, 'unsupported_media', 'Content-Type must be application/json');
  }
  let raw = req.body;
  if (raw === undefined || raw === null) {
    raw = typeof req.on === 'function' ? await readStream(req, maxBytes) : '';
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

/** First hop of x-forwarded-for, else x-real-ip, else the socket address. */
function clientIp(req) {
  const xff = header(req, 'x-forwarded-for');
  if (xff) {
    const first = String(xff).split(',')[0].trim();
    if (first) return first;
  }
  const real = header(req, 'x-real-ip');
  if (real) return String(real).trim();
  return (req.socket && req.socket.remoteAddress) || (req.connection && req.connection.remoteAddress) || '';
}

/** Salted HMAC-SHA256 (hex) of the IP. The raw IP is never stored or logged. */
function ipHash(ip) {
  const salt = process.env.IP_SALT || process.env.SESSION_SECRET || 'vfi-dev-ip-salt';
  return crypto.createHmac('sha256', salt).update(String(ip || 'unknown')).digest('hex');
}

/** Query params as a plain object (Vercel/Express set req.query; fall back to parsing req.url). */
function getQuery(req) {
  if (req.query && typeof req.query === 'object') return req.query;
  try { return Object.fromEntries(new URL(req.url || '/', 'http://localhost').searchParams); } catch (e) { return {}; }
}

module.exports = { HttpError, readJson, send, sendError, sendText, clientIp, ipHash, getQuery, header };
