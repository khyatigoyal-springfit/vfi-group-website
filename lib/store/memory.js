'use strict';
// In-memory store with the same interface and semantics as lib/db/store.js (local development and tests only).
// Enquiries also persist to a JSON file unless on Vercel; everything else lives only for the life of the process.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashPassword } = require('../auth/password');
const { loadDefaultContent } = require('../content/defaults');

const STATUSES = ['new', 'in_progress', 'contacted', 'closed', 'spam'];
const RATE_MAX = 5;
const EXPORT_MAX = 2000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const storeError = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const noHash = (u) => { const { password_hash, ...rest } = u; return { ...rest }; };

function istDate(d) {
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
    } catch (e) { rows = []; }
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
  let seq = rows.reduce((mx, r) => Math.max(mx, r.seq || 0), 0);
  const pubEnq = (r) => { const { ip_hash, seq: _s, ...rest } = r; return { ...rest }; };

  // ---- other collections
  const users = [];
  const attempts = [];
  const revisions = [];
  let state = null; // {draft, draft_updated_at, draft_updated_by_id, published_revision}
  const media = [];
  const audit = [];
  let auditSeq = 0;
  let revSeq = 0;

  const userName = (id) => { const u = users.find((x) => x.id === id); return u ? (u.name || u.email) : null; };
  const nextTs = (prev) => new Date(Math.max(Date.now(), prev ? Date.parse(prev) + 1 : 0)).toISOString();

  // Lazy startup, like the Postgres store: bootstrap admin and seed content.
  let readyP = null;
  function ready() {
    if (!readyP) {
      readyP = (async () => {
        const email = String(env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
        if (!users.length && email && env.BOOTSTRAP_ADMIN_PASSWORD) {
          const now = new Date().toISOString();
          users.push({
            id: crypto.randomUUID(), email, name: 'Administrator', role: 'admin', password_hash: await hashPassword(env.BOOTSTRAP_ADMIN_PASSWORD),
            must_change_password: true, active: true, session_version: 1, created_at: now, updated_at: now, last_login_at: null,
          });
        }
        if (!state) {
          const data = loadDefaultContent();
          revisions.push({ id: ++revSeq, data, note: 'Initial content', published_by_id: null, published_at: new Date().toISOString() });
          state = { draft: clone(data), draft_updated_at: new Date().toISOString(), draft_updated_by_id: null, published_revision: 1 };
        }
      })().catch((e) => { readyP = null; throw e; });
    }
    return readyP;
  }
  const m = (fn) => async (...a) => { await ready(); return fn(...a); };

  function matcher(status, q) {
    const st = status || 'active';
    if (st !== 'all' && st !== 'active' && !STATUSES.includes(st)) throw storeError('invalid_input');
    const needle = String(q || '').trim().toLowerCase();
    const textMatch = (r) => !needle || [r.ref, r.name, r.company, r.email, r.country, r.message].some((f) => String(f || '').toLowerCase().includes(needle));
    const statusMatch = (r) => st === 'all' || (st === 'active' ? r.status !== 'spam' : r.status === st);
    return { textMatch, statusMatch };
  }
  const byNewest = (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : ((a.seq || 0) < (b.seq || 0) ? 1 : -1));
  const page = (limit, offset, def, max) => {
    const n = Math.trunc(Number(limit));
    return { lim: Math.min(Math.max(Number.isFinite(n) && n > 0 ? n : def, 1), max), off: Math.max(Math.trunc(Number(offset)) || 0, 0) };
  };

  return {
    kind: 'memory',

    // ---------------------------------------------------------------- enquiries
    async submitEnquiry(e) {
      const ipHash = e.ip_hash || '';
      if (!ipHash || !e.name || !e.company || !e.email || !e.message || !e.type) throw storeError('invalid_input');
      const now = Date.now();
      if (rows.filter((r) => r.ip_hash === ipHash && now - Date.parse(r.created_at) < RATE_WINDOW_MS).length >= RATE_MAX) throw storeError('rate_limited');
      const ts = new Date(now).toISOString();
      const row = {
        id: crypto.randomUUID(),
        ref: `VFI-${istDate(new Date(now))}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`,
        type: e.type, name: e.name, company: e.company, email: e.email,
        country: e.country || '', volume: e.volume || '', message: e.message, source_page: e.source_page || '',
        ip_hash: ipHash, user_agent: String(e.user_agent || '').slice(0, 300),
        status: 'new', notes: '', created_at: ts, updated_at: ts, seq: ++seq,
      };
      rows.push(row);
      persist();
      return { ref: row.ref, id: row.id };
    },
    async listEnquiries({ status, q, limit, offset } = {}) {
      const { textMatch, statusMatch } = matcher(status, q);
      const { lim, off } = page(limit, offset, 25, 100);
      const matched = rows.filter((r) => statusMatch(r) && textMatch(r)).sort(byNewest);
      const counts = { new: 0, in_progress: 0, contacted: 0, closed: 0, spam: 0 };
      for (const r of rows) if (textMatch(r)) counts[r.status]++;
      return { rows: matched.slice(off, off + lim).map(pubEnq), total: matched.length, counts };
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
      return pubEnq(r);
    },
    async exportEnquiries({ status, q } = {}) {
      const { textMatch, statusMatch } = matcher(status, q);
      return rows.filter((r) => statusMatch(r) && textMatch(r)).sort(byNewest).slice(0, EXPORT_MAX).map(pubEnq);
    },

    // ---------------------------------------------------------------- users
    createUser: m(async ({ email, name, role, password_hash, must_change_password }) => {
      const em = String(email).toLowerCase();
      if (users.some((u) => u.email === em)) throw storeError('email_taken');
      const now = new Date().toISOString();
      const u = { id: crypto.randomUUID(), email: em, name: name || '', role, password_hash, must_change_password: Boolean(must_change_password), active: true, session_version: 1, created_at: now, updated_at: now, last_login_at: null };
      users.push(u);
      return { ...u };
    }),
    getUserById: m(async (id) => { const u = users.find((x) => x.id === id); return u ? { ...u } : null; }),
    getUserByEmail: m(async (email) => { const u = users.find((x) => x.email === String(email).toLowerCase()); return u ? { ...u } : null; }),
    listUsers: m(async () => users.map(noHash)),
    updateUser: m(async (id, patch = {}) => {
      const u = users.find((x) => x.id === id);
      if (!u) throw storeError('not_found');
      const losesAdmin = u.role === 'admin' && u.active && ((patch.role !== undefined && patch.role !== 'admin') || patch.active === false);
      if (losesAdmin && !users.some((x) => x !== u && x.role === 'admin' && x.active)) throw storeError('last_admin');
      for (const k of ['name', 'role', 'active', 'password_hash', 'must_change_password']) if (patch[k] !== undefined) u[k] = patch[k];
      if (patch.bump_session) u.session_version += 1;
      u.updated_at = new Date().toISOString();
      return { ...u };
    }),
    recordLogin: m(async (id) => { const u = users.find((x) => x.id === id); if (u) u.last_login_at = new Date().toISOString(); }),

    // ---------------------------------------------------------------- login attempts
    recordLoginAttempt: m(async ({ ip_hash, email, ok }) => {
      attempts.push({ ip_hash, email: String(email || ''), ok: Boolean(ok), at: Date.now() });
      const cutoff = Date.now() - 2 * 24 * 3600 * 1000;
      while (attempts.length && attempts[0].at < cutoff) attempts.shift();
    }),
    countFailedAttempts: m(async ({ ip_hash, email, sinceMs }) => {
      const since = Date.now() - sinceMs;
      const recent = attempts.filter((a) => !a.ok && a.at > since);
      return { ip: recent.filter((a) => a.ip_hash === ip_hash).length, email: email ? recent.filter((a) => a.email === email).length : 0 };
    }),

    // ---------------------------------------------------------------- content
    getContentState: m(async () => ({
      draft: clone(state.draft), draft_updated_at: state.draft_updated_at, draft_updated_by_id: state.draft_updated_by_id,
      draft_updated_by_name: state.draft_updated_by_id ? userName(state.draft_updated_by_id) : null,
      published_revision: state.published_revision, published: clone(revisions.find((r) => r.id === state.published_revision).data),
    })),
    getPublished: m(async () => {
      const r = revisions.find((x) => x.id === state.published_revision);
      return { revision: r.id, data: clone(r.data), published_at: r.published_at };
    }),
    saveDraft: m(async ({ data, base_updated_at, user_id }) => {
      if (state.draft_updated_at !== base_updated_at) {
        throw storeError('conflict', { current: { updated_at: state.draft_updated_at, updated_by_id: state.draft_updated_by_id, updated_by_name: state.draft_updated_by_id ? userName(state.draft_updated_by_id) : null } });
      }
      state.draft = clone(data);
      state.draft_updated_at = nextTs(state.draft_updated_at);
      state.draft_updated_by_id = user_id || null;
      return { draft_updated_at: state.draft_updated_at, draft_updated_by_id: state.draft_updated_by_id };
    }),
    publish: m(async ({ user_id, note }) => {
      const rev = { id: ++revSeq, data: clone(state.draft), note: String(note || ''), published_by_id: user_id || null, published_at: new Date().toISOString() };
      revisions.push(rev);
      state.published_revision = rev.id;
      return { id: rev.id, note: rev.note, published_at: rev.published_at };
    }),
    rollback: m(async ({ id, user_id }) => {
      const src = revisions.find((r) => r.id === Number(id));
      if (!src) throw storeError('not_found');
      const rev = { id: ++revSeq, data: clone(src.data), note: `Rollback to #${src.id}`, published_by_id: user_id || null, published_at: new Date().toISOString() };
      revisions.push(rev);
      state.draft = clone(src.data);
      state.draft_updated_at = nextTs(state.draft_updated_at);
      state.draft_updated_by_id = user_id || null;
      state.published_revision = rev.id;
      return { revision: { id: rev.id, note: rev.note, published_at: rev.published_at }, draft_updated_at: state.draft_updated_at };
    }),
    discardDraft: m(async ({ user_id }) => {
      state.draft = clone(revisions.find((r) => r.id === state.published_revision).data);
      state.draft_updated_at = nextTs(state.draft_updated_at);
      state.draft_updated_by_id = user_id || null;
      return { draft_updated_at: state.draft_updated_at };
    }),
    listRevisions: m(async ({ limit, offset } = {}) => {
      const { lim, off } = page(limit, offset, 25, 100);
      const sorted = [...revisions].sort((a, b) => b.id - a.id);
      return {
        rows: sorted.slice(off, off + lim).map((r) => ({ id: r.id, note: r.note, published_at: r.published_at, published_by_id: r.published_by_id, published_by_name: r.published_by_id ? userName(r.published_by_id) : 'System' })),
        total: revisions.length, published_revision: state.published_revision,
      };
    }),
    getRevision: m(async (id) => {
      const r = revisions.find((x) => x.id === Number(id));
      return r ? { id: r.id, data: clone(r.data), note: r.note, published_at: r.published_at, published_by_id: r.published_by_id, published_by_name: r.published_by_id ? userName(r.published_by_id) : 'System' } : null;
    }),

    // ---------------------------------------------------------------- media
    addMedia: m(async (x) => {
      const row = { id: crypto.randomUUID(), url: x.url, pathname: x.pathname, content_type: x.content_type, size: x.size, width: x.width == null ? null : x.width, height: x.height == null ? null : x.height, alt: x.alt || '', uploaded_by: x.uploaded_by || null, created_at: new Date().toISOString() };
      media.push(row);
      return { ...row };
    }),
    listMedia: m(async ({ limit, offset } = {}) => {
      const { lim, off } = page(limit, offset, 50, 100);
      const sorted = [...media].sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return { rows: sorted.slice(off, off + lim).map((r) => ({ ...r })), total: media.length };
    }),
    getMedia: m(async (id) => { const r = media.find((x) => x.id === id); return r ? { ...r } : null; }),
    updateMedia: m(async (id, { alt }) => {
      const r = media.find((x) => x.id === id);
      if (!r) throw storeError('not_found');
      r.alt = String(alt || '');
      return { ...r };
    }),
    deleteMedia: m(async (id) => { const i = media.findIndex((x) => x.id === id); if (i < 0) return false; media.splice(i, 1); return true; }),

    // ---------------------------------------------------------------- audit
    addAudit: m(async ({ user_id, action, target, detail }) => {
      audit.push({ id: ++auditSeq, at: new Date().toISOString(), user_id: user_id || null, action: String(action).slice(0, 80), target: String(target || '').slice(0, 300), detail: clone(detail || {}) });
    }),
    listAudit: m(async ({ limit, offset } = {}) => {
      const { lim, off } = page(limit, offset, 50, 200);
      const sorted = [...audit].sort((a, b) => b.id - a.id);
      return {
        rows: sorted.slice(off, off + lim).map((a) => {
          const u = a.user_id ? users.find((x) => x.id === a.user_id) : null;
          return { id: a.id, at: a.at, user_id: a.user_id, user_name: u ? (u.name || u.email) : null, user_email: u ? u.email : null, action: a.action, target: a.target, detail: clone(a.detail) };
        }),
        total: audit.length,
      };
    }),

    ensureReady: m(async () => true),
    close: async () => {},
  };
}

module.exports = { createMemoryStore, UUID_RE };
