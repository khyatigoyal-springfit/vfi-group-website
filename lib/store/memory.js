'use strict';
// In-memory store with the same semantics as the SQL functions. Persists to a JSON file unless on Vercel.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const STATUSES = ['new', 'in_progress', 'contacted', 'closed', 'spam'];
const RATE_MAX = 5;
const EXPORT_MAX = 2000;
const RATE_WINDOW_MS = 10 * 60 * 1000;

function storeError(code) {
  const e = new Error(code);
  e.code = code;
  return e;
}

function istDate(d) {
  // YYMMDD in Asia/Kolkata
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: '2-digit', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return p.year + p.month + p.day;
}

function createMemoryStore(env = process.env) {
  const file = env.VERCEL ? null : (env.ENQUIRY_DATA_FILE || path.join(__dirname, '..', '..', 'data', 'enquiries.json'));
  let rows = [];

  if (file) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(parsed)) rows = parsed.filter((r) => r && typeof r === 'object' && r.id && r.ref);
    } catch (e) { rows = []; } // missing or corrupt file: start empty
  }

  function persist() {
    if (!file) return;
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(rows));
      fs.renameSync(tmp, file);
    } catch (e) { console.error('Could not persist enquiries file'); }
  }

  let seq = rows.reduce((m, r) => Math.max(m, r.seq || 0), 0);
  const pub = (r) => { const { ip_hash, seq: _s, ...rest } = r; return { ...rest }; };

  function matcher(status, q) {
    const st = status || 'active';
    if (st !== 'all' && st !== 'active' && !STATUSES.includes(st)) throw storeError('invalid_input');
    const needle = String(q || '').trim().toLowerCase();
    const textMatch = (r) => !needle || [r.ref, r.name, r.company, r.email, r.country, r.message].some((f) => String(f || '').toLowerCase().includes(needle));
    const statusMatch = (r) => st === 'all' || (st === 'active' ? r.status !== 'spam' : r.status === st);
    return { textMatch, statusMatch };
  }
  const byNewest = (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : ((a.seq || 0) < (b.seq || 0) ? 1 : -1));

  return {
    kind: 'memory',
    async submitEnquiry(e) {
      const ipHash = e.ip_hash || '';
      if (!ipHash) throw storeError('invalid_input'); // mirrors SQL: ip_hash is mandatory
      const now = Date.now();
      if (rows.filter((r) => r.ip_hash === ipHash && now - Date.parse(r.created_at) < RATE_WINDOW_MS).length >= RATE_MAX) {
        throw storeError('rate_limited');
      }
      const ts = new Date(now).toISOString();
      const row = {
        id: crypto.randomUUID(),
        ref: `VFI-${istDate(new Date(now))}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        type: e.type, name: e.name, company: e.company, email: e.email,
        country: e.country || '', volume: e.volume || '', message: e.message, source_page: e.source_page || '',
        ip_hash: ipHash, user_agent: String(e.user_agent || '').slice(0, 300),
        status: 'new', notes: '', created_at: ts, updated_at: ts,
        seq: ++seq,
      };
      rows.push(row);
      persist();
      return { ref: row.ref, id: row.id };
    },
    async listEnquiries({ status, q, limit, offset } = {}) {
      const { textMatch, statusMatch } = matcher(status, q);
      const n = limit === undefined || limit === null ? 25 : Math.trunc(Number(limit));
      const lim = Math.min(Math.max(Number.isFinite(n) ? n : 25, 1), 100);
      const off = Math.max(Math.trunc(Number(offset)) || 0, 0);
      const matched = rows.filter((r) => statusMatch(r) && textMatch(r)).sort(byNewest);
      const counts = { new: 0, in_progress: 0, contacted: 0, closed: 0, spam: 0 };
      for (const r of rows) if (textMatch(r)) counts[r.status]++;
      return { rows: matched.slice(off, off + lim).map(pub), total: matched.length, counts };
    },
    async updateEnquiry({ id, status, notes }) {
      if (status !== undefined && status !== null && !STATUSES.includes(status)) throw storeError('invalid_input');
      if (notes !== undefined && notes !== null && String(notes).length > 5000) throw storeError('invalid_input');
      const r = rows.find((x) => x.id === id);
      if (!r) throw storeError('not_found');
      if (status !== undefined && status !== null) r.status = status;
      if (notes !== undefined && notes !== null) r.notes = String(notes);
      r.updated_at = new Date().toISOString();
      persist();
      return pub(r);
    },
    async exportEnquiries({ status, q } = {}) {
      const { textMatch, statusMatch } = matcher(status, q);
      return rows.filter((r) => statusMatch(r) && textMatch(r)).sort(byNewest).slice(0, EXPORT_MAX).map(pub);
    },
  };
}

module.exports = { createMemoryStore };
