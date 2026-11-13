'use strict';
const crypto = require('crypto');

const COOKIE_NAME = 'vfi_admin';
const MAX_AGE = 43200; // 12 h, seconds

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest();

const MIN_SECRET_LEN = 32;
const MIN_PASSWORD_LEN = 12;

/** "v" claim: first 16 hex chars of HMAC-SHA256(SESSION_SECRET, ADMIN_PASSWORD). Changing either logs everyone out. */
function versionClaim(secret, password) {
  return crypto.createHmac('sha256', String(secret)).update(String(password)).digest('hex').slice(0, 16);
}

let warned = '';
/** Is admin usable? Requires SESSION_SECRET >= 32 chars and ADMIN_PASSWORD >= 12 chars. Logs the reason (once per reason). */
function adminConfig(env = process.env) {
  const secret = env.SESSION_SECRET || '';
  const password = env.ADMIN_PASSWORD || '';
  let reason = '';
  if (!secret) reason = 'SESSION_SECRET is not set';
  else if (secret.length < MIN_SECRET_LEN) reason = `SESSION_SECRET is shorter than ${MIN_SECRET_LEN} characters`;
  else if (!password) reason = 'ADMIN_PASSWORD is not set';
  else if (password.length < MIN_PASSWORD_LEN) reason = `ADMIN_PASSWORD is shorter than ${MIN_PASSWORD_LEN} characters`;
  if (reason) {
    if (warned !== reason) { warned = reason; console.error(`Admin disabled (admin_not_configured): ${reason}`); }
    return { ok: false, reason };
  }
  return { ok: true, secret, password, v: versionClaim(secret, password) };
}

/** value = base64url(JSON{exp, v?}) + "." + base64url(HMAC-SHA256(secret, payload)) */
function sign(secret, now = Date.now(), maxAgeSec = MAX_AGE, v) {
  const claims = { exp: now + maxAgeSec * 1000 };
  if (v !== undefined) claims.v = v;
  const payload = b64u(JSON.stringify(claims));
  return payload + '.' + b64u(hmac(secret, payload));
}

/** Returns the payload if well-formed, correctly signed, unexpired and (when expectedV is given) carrying a matching v; else null. */
function verify(value, secret, now = Date.now(), expectedV) {
  if (!secret || typeof value !== 'string' || value.length > 512) return null;
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let given;
  try { given = Buffer.from(parts[1], 'base64url'); } catch (e) { return null; }
  const expected = hmac(secret, parts[0]);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
  let payload;
  try { payload = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')); } catch (e) { return null; }
  if (!payload || typeof payload.exp !== 'number' || !(payload.exp > now)) return null;
  if (expectedV !== undefined) {
    if (typeof payload.v !== 'string' || payload.v.length !== expectedV.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(payload.v), Buffer.from(expectedV))) return null;
  }
  return payload;
}

function parseCookies(header) {
  const out = {};
  if (!header || typeof header !== 'string') return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    if (!k || k in out) continue;
    out[k] = part.slice(i + 1).trim();
  }
  return out;
}

/** Secure everywhere except non-production on localhost. */
function isSecure(req) {
  if (process.env.NODE_ENV === 'production') return true;
  const host = String((req && req.headers && req.headers.host) || '').replace(/:\d+$/, '').toLowerCase();
  return !(host === 'localhost' || host === '127.0.0.1' || host === '[::1]');
}

function cookieString(value, maxAge, secure) {
  return `${COOKIE_NAME}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}
const setCookie = (res, req, value) => res.setHeader('Set-Cookie', cookieString(value, MAX_AGE, isSecure(req)));
const clearCookie = (res, req) => res.setHeader('Set-Cookie', cookieString('', 0, isSecure(req)));

function fromRequest(req, secret, expectedV) {
  const v = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
  return v ? verify(v, secret, Date.now(), expectedV) : null;
}

module.exports = { COOKIE_NAME, MAX_AGE, MIN_SECRET_LEN, MIN_PASSWORD_LEN, versionClaim, adminConfig, sign, verify, parseCookies, setCookie, clearCookie, cookieString, isSecure, fromRequest };
