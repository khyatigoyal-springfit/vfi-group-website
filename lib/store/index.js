'use strict';
// Store selection: Supabase when SUPABASE_URL is set, otherwise the in-memory (+file) store for local/dev/tests only.
// On Vercel / NODE_ENV=production a missing SUPABASE_URL or SUPABASE_ANON_KEY fails closed ('unavailable').
// Interface: submitEnquiry(e), listEnquiries({status,q,limit,offset}), updateEnquiry({id,status,notes}), exportEnquiries({status,q}).
// Errors are thrown as Error with .code in: rate_limited | invalid_input | forbidden | not_found | unavailable.

/** Store whose every call fails with code 'unavailable' (handlers map that to 503). */
function createUnavailableStore() {
  const fail = async () => { const e = new Error('unavailable'); e.code = 'unavailable'; throw e; };
  return { kind: 'unavailable', submitEnquiry: fail, listEnquiries: fail, updateEnquiry: fail, exportEnquiries: fail };
}

function createStore(env = process.env) {
  const hosted = Boolean(env.VERCEL || env.NODE_ENV === 'production');
  if (hosted && (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY)) {
    // Fail closed: never fall back to the ephemeral memory store in production.
    console.error('Store unavailable: SUPABASE_URL and SUPABASE_ANON_KEY must be set in production');
    return createUnavailableStore();
  }
  if (env.SUPABASE_URL) return require('./supabase').createSupabaseStore(env);
  return require('./memory').createMemoryStore(env);
}

let shared = null;
/** Process-wide store shared by all handlers (so the memory store is one instance). */
function getStore() {
  if (!shared) shared = createStore();
  return shared;
}
function resetStore() { shared = null; }

module.exports = { createStore, getStore, resetStore };
