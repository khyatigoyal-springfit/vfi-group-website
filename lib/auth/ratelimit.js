'use strict';
// Login rate limiting backed by the store (login_attempts table), so it holds across serverless instances.
//
// Atomicity: the attempt is RECORDED (ok = false) in the same locked step that counts, BEFORE the password is
// verified; a successful login flips that row to ok = true. Concurrent requests therefore cannot all pass the check.
//
// Limits per 15-minute window (failed attempts, in-flight attempts included):
//   - per IP:            10  (the 11th is refused)
//   - per (email + IP):   5  (the 6th is refused)   <- strict, so a stranger cannot lock a user out from elsewhere
//   - per email, global: 50  (loose backstop against distributed guessing)
const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILS_PER_IP = 10;
const MAX_FAILS_PER_EMAIL_IP = 5;
const MAX_FAILS_PER_EMAIL = 50;
const LIMITS = Object.freeze({ ip: MAX_FAILS_PER_IP, emailIp: MAX_FAILS_PER_EMAIL_IP, email: MAX_FAILS_PER_EMAIL });

/** counts = {ip, email_ip, email}. Pure. An empty email only has the IP limit. */
function over(counts, email, limits = LIMITS) {
  return counts.ip >= limits.ip || (email !== '' && (counts.email_ip >= limits.emailIp || counts.email >= limits.email));
}

/**
 * Atomically check and record an attempt. Returns {limited:true} or {limited:false, id}; `id` is passed to
 * markSuccess() when the password turns out to be correct.
 */
async function reserve(store, { ipHash, email }) {
  return store.reserveLoginAttempt({ ip_hash: ipHash, email, sinceMs: WINDOW_MS, limits: LIMITS });
}

/** The password was correct: the reserved attempt no longer counts as a failure. */
async function markSuccess(store, id) {
  if (id !== undefined && id !== null) await store.markLoginSuccess(id);
}

/** Read-only check (no recording). Successes never reset counters. */
async function isLimited(store, { ipHash, email }) {
  const c = await store.countFailedAttempts({ ip_hash: ipHash, email, sinceMs: WINDOW_MS });
  return over({ ip: c.ip, email_ip: c.email_ip === undefined ? 0 : c.email_ip, email: c.email }, email, { ip: MAX_FAILS_PER_IP, emailIp: MAX_FAILS_PER_EMAIL_IP, email: MAX_FAILS_PER_EMAIL });
}

module.exports = { reserve, markSuccess, isLimited, over, LIMITS, WINDOW_MS, MAX_FAILS_PER_IP, MAX_FAILS_PER_EMAIL_IP, MAX_FAILS_PER_EMAIL };
