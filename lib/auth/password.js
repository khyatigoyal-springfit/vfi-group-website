'use strict';
// scrypt password hashing: "scrypt$N$r$p$saltB64$hashB64". Constant-time verification.
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 16384; const R = 8; const P = 1; const SALT_LEN = 32; const KEY_LEN = 64;
const MIN_LEN = 12;
const MAX_LEN = 200; // bounds the work an attacker can force

const opts = (n, r, p) => ({ N: n, r, p, maxmem: 128 * n * r * 2 + 1024 * 1024 });

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_LEN);
  const key = await scrypt(String(password), salt, KEY_LEN, opts(N, R, P));
  return ['scrypt', N, R, P, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
    const n = Number(parts[1]); const r = Number(parts[2]); const p = Number(parts[3]);
    if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20 || r > 32 || p > 16) return false;
    const salt = Buffer.from(parts[4], 'base64');
    const expected = Buffer.from(parts[5], 'base64');
    if (!salt.length || !expected.length) return false;
    const actual = await scrypt(String(password), salt, expected.length, opts(n, r, p));
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  } catch (e) { return false; }
}

let dummy = null;
/** Burn the same CPU as a real check (used for unknown/deactivated users so timing does not reveal them). */
async function dummyVerify(password) {
  if (!dummy) dummy = hashPassword('dummy-password-for-timing');
  await verifyPassword(password, await dummy);
  return false;
}

/** @returns {string|null} an error message, or null when the password meets the policy. */
function passwordPolicyError(pw) {
  if (typeof pw !== 'string') return 'Enter a password';
  if (pw.length < MIN_LEN) return `Password must be at least ${MIN_LEN} characters`;
  if (pw.length > MAX_LEN) return `Password must be ${MAX_LEN} characters or fewer`;
  return null;
}

const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no look-alikes
/** Random temporary password: 4 groups of 4 characters (rejection sampling, no modulo bias). */
function generateTempPassword() {
  const limit = 256 - (256 % ALPHABET.length);
  const out = [];
  while (out.length < 16) {
    for (const b of crypto.randomBytes(32)) { if (b < limit && out.length < 16) out.push(ALPHABET[b % ALPHABET.length]); }
  }
  return [0, 4, 8, 12].map((i) => out.slice(i, i + 4).join('')).join('-');
}

module.exports = { hashPassword, verifyPassword, dummyVerify, passwordPolicyError, generateTempPassword, MIN_LEN, MAX_LEN };
