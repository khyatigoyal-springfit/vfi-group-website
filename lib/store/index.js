'use strict';
// Store selection: Postgres when DATABASE_URL is set, otherwise the in-memory store for local development and tests only.
// On Vercel / NODE_ENV=production a missing DATABASE_URL fails closed: every call rejects with code 'unavailable'.
// The interface is documented by lib/db/store.js (Postgres) and lib/store/memory.js (identical semantics).
// Errors are thrown as Error with .code in: rate_limited | invalid_input | not_found | conflict | last_admin | email_taken | nothing_to_publish | unavailable.

const METHODS = [
  'submitEnquiry', 'listEnquiries', 'updateEnquiry', 'exportEnquiries',
  'createUser', 'getUserById', 'getUserByEmail', 'listUsers', 'updateUser', 'recordLogin',
  'reserveLoginAttempt', 'markLoginSuccess', 'countFailedAttempts', 'pruneOld',
  'getContentState', 'getPublished', 'saveDraft', 'publish', 'rollback', 'discardDraft', 'listRevisions', 'getRevision',
  'findRevisionsUsing', 'findMissingMedia', 'addMedia', 'listMedia', 'getMedia', 'updateMedia', 'deleteMedia',
  'addAudit', 'listAudit', 'ensureReady',
];

/** Store whose every call fails with code 'unavailable' (handlers map that to 503). */
function createUnavailableStore() {
  const fail = async () => { const e = new Error('unavailable'); e.code = 'unavailable'; throw e; };
  const s = { kind: 'unavailable', close: async () => {} };
  for (const k of METHODS) s[k] = fail;
  return s;
}

function createStore(env = process.env) {
  const hosted = Boolean(env.VERCEL || env.NODE_ENV === 'production');
  if (env.DATABASE_URL) return require('../db/store').createPgStore(env);
  if (hosted) {
    console.error('Store unavailable: DATABASE_URL must be set in production');
    return createUnavailableStore();
  }
  return require('./memory').createMemoryStore(env);
}

let shared = null;
/** Process-wide store shared by all handlers (so the memory store is one instance). */
function getStore() {
  if (!shared) shared = createStore();
  return shared;
}
function resetStore() { shared = null; }

module.exports = { createStore, getStore, resetStore, METHODS };
