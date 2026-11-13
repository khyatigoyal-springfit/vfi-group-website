'use strict';
// Supabase store: calls SECURITY DEFINER RPC functions through PostgREST with the publishable (anon) key.

const TIMEOUT_MS = 8000;

function storeError(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

/** Map a PostgREST error body to one of our codes. Never includes URLs or keys. */
function mapPgError(body) {
  const sqlstate = body && typeof body.code === 'string' ? body.code : '';
  const msg = body && typeof body.message === 'string' ? body.message : '';
  if (sqlstate === 'P0429' || msg === 'rate_limited') return 'rate_limited';
  if (sqlstate === '22023' || msg === 'invalid_input') return 'invalid_input';
  if (sqlstate === 'P0403' || msg === 'forbidden') return 'forbidden';
  if (sqlstate === 'P0404' || msg === 'not_found') return 'not_found';
  return 'unavailable';
}

function createSupabaseStore(env = process.env) {
  const base = String(env.SUPABASE_URL || '').replace(/\/+$/, '');
  const anonKey = env.SUPABASE_ANON_KEY || '';
  const adminSecret = env.SUPABASE_ADMIN_SECRET || '';

  async function rpc(fn, args) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    let res;
    try {
      res = await globalThis.fetch(`${base}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${anonKey}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(args),
        signal: ctrl.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      throw storeError('unavailable', 'Store request failed');
    }
    try {
      let text;
      try { text = await res.text(); } catch (e) { throw storeError('unavailable', 'Store response unreadable'); }
      let data = null;
      if (text) { try { data = JSON.parse(text); } catch (e) { data = null; } }
      if (!res.ok) throw storeError(mapPgError(data), `Store error (${res.status})`);
      if (data === null) throw storeError('unavailable', 'Store returned an invalid response');
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  const secret = () => {
    if (!adminSecret) throw storeError('forbidden', 'Admin secret not configured');
    return adminSecret;
  };
  const nul = (v) => (v === undefined || v === '' ? null : v);

  return {
    kind: 'supabase',
    async submitEnquiry(e) {
      const r = await rpc('submit_enquiry', { p: {
        type: e.type, name: e.name, company: e.company, email: e.email, country: e.country || '',
        volume: e.volume || '', message: e.message, source_page: e.source_page || '',
        ip_hash: e.ip_hash || '', user_agent: e.user_agent || '',
      } });
      return { ref: r.ref, id: r.id };
    },
    async listEnquiries({ status, q, limit, offset } = {}) {
      return rpc('admin_list_enquiries', { p_secret: secret(), p_status: nul(status), p_q: nul(q), p_limit: limit == null ? 25 : limit, p_offset: offset || 0 });
    },
    async updateEnquiry({ id, status, notes }) {
      return rpc('admin_update_enquiry', {
        p_secret: secret(), p_id: id,
        p_status: status === undefined ? null : status,
        p_notes: notes === undefined ? null : notes,
      });
    },
    async exportEnquiries({ status, q } = {}) {
      return rpc('admin_export_enquiries', { p_secret: secret(), p_status: nul(status), p_q: nul(q) });
    },
  };
}

module.exports = { createSupabaseStore, mapPgError };
