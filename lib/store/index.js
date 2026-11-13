'use strict';
// Store selection: Supabase when SUPABASE_URL is set, otherwise the in-memory (+file) store.
// Interface: submitEnquiry(e), listEnquiries({status,q,limit,offset}), updateEnquiry({id,status,notes}), exportEnquiries({status,q}).
// Errors are thrown as Error with .code in: rate_limited | invalid_input | forbidden | not_found | unavailable.

function createStore(env = process.env) {
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
