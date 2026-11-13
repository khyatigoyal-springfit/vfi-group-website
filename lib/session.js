'use strict';
const crypto = require('crypto');

const COOKIE_NAME = 'vfi_admin';
const MAX_AGE = 43200; // 12 h, seconds

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest();

/** value = base64url(JSON{exp}) + "." + base64url(HMAC-SHA256(secret, payload)) */
function sign(secret, now = Date.now(), maxAgeSec = MAX_AGE) {
  const payload = b64u(JSON.stringify({ exp: now + maxAgeSec * 1000 }));
  return payload + '.' + b64u(hmac(secret, payload));
}

/** Returns the payload object if the value is well-formed, correctly signed and unexpired; else null. */
function verify(value, secret, now = Date.now()) {
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

function fromRequest(req, secret) {
  const v = parseCookies(req.headers && req.headers.cookie)[COOKIE_NAME];
  return v ? verify(v, secret) : null;
}

module.exports = { COOKIE_NAME, MAX_AGE, sign, verify, parseCookies, setCookie, clearCookie, cookieString, isSecure, fromRequest };
