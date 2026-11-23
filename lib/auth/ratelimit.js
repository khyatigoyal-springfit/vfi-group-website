'use strict';
// Login rate limiting backed by the store (login_attempts table), so it holds across serverless instances.
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 10;    // the 11th attempt is refused
const MAX_FAILS_PER_EMAIL = 5;  // the 6th attempt is refused

/** True when this IP or this email already has too many failed attempts in the window. Successes never reset counters. */
async function isLimited(store, { ipHash, email }) {
  const c = await store.countFailedAttempts({ ip_hash: ipHash, email, sinceMs: WINDOW_MS });
  return c.ip >= MAX_FAILS_PER_IP || (email !== '' && c.email >= MAX_FAILS_PER_EMAIL);
}

module.exports = { isLimited, WINDOW_MS, MAX_FAILS_PER_IP, MAX_FAILS_PER_EMAIL };
