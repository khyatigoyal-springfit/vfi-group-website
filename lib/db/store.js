'use strict';
// Postgres store (node-postgres). Parameterised SQL only: no value is ever concatenated into a query string.
// Every method first waits for ready() (migrate + bootstrap admin + seed content, once per instance).
const crypto = require('crypto');
const { same, changedSections } = require('../content/diff');
const { getPool } = require('./pool');
const { prepareDatabase } = require('./migrate');

const APP_CODES = new Set(['conflict', 'last_admin', 'email_taken', 'not_found', 'invalid_input', 'rate_limited', 'nothing_to_publish']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RATE_MAX = 5;
const EXPORT_MAX = 2000;
const ADMIN_LOCK_ID = 727002;
const KEEP_REVISIONS = 200;        // newest revisions kept; the published one is never deleted
const AUDIT_DAYS = 365;
const LOGIN_ATTEMPT_DAYS = 30;
const likeEscape = (s) => String(s).replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');

const appError = (code, extra) => Object.assign(new Error(code), { code }, extra || {});
const iso = (d) => (d ? new Date(d).toISOString() : null);
const intId = (v) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n < 2147483647 ? n : null; };

function istDate(d) {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', year: '2-digit', month: '2-digit', day: '2-digit' })
    .formatToParts(d).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  return p.year + p.month + p.day;
}

const mapUser = (r) => (r ? {
  id: r.id, email: r.email, name: r.name, role: r.role, password_hash: r.password_hash,
  must_change_password: r.must_change_password, active: r.active, session_version: r.session_version,
  created_at: iso(r.created_at), updated_at: iso(r.updated_at), last_login_at: iso(r.last_login_at),
} : null);
const noHash = (u) => { if (!u) return u; const { password_hash, ...rest } = u; return rest; };
const mapEnquiry = (r) => ({
  id: r.id, ref: r.ref, type: r.type, name: r.name, company: r.company, email: r.email, country: r.country, volume: r.volume,
  message: r.message, source_page: r.source_page, user_agent: r.user_agent, status: r.status, notes: r.notes,
  created_at: iso(r.created_at), updated_at: iso(r.updated_at),
});
const mapMedia = (r) => ({
  id: r.id, url: r.url, pathname: r.pathname, content_type: r.content_type, size: r.size, width: r.width, height: r.height,
  alt: r.alt, uploaded_by: r.uploaded_by, created_at: iso(r.created_at),
});

// Shared enquiry filter. $1 status ('all' | 'active' | a status), $2 LIKE pattern or null.
const ENQ_WHERE = `($1 = 'all' or ($1 = 'active' and e.status <> 'spam') or e.status = $1)
  and ($2::text is null or e.ref ilike $2 escape '\\' or e.name ilike $2 escape '\\' or e.company ilike $2 escape '\\'
       or e.email ilike $2 escape '\\' or e.country ilike $2 escape '\\' or e.message ilike $2 escape '\\')`;
const ENQ_STATUSES = ['all', 'active', 'new', 'in_progress', 'contacted', 'closed', 'spam'];
const NEXT_DRAFT_TS = `greatest(date_trunc('milliseconds', clock_timestamp()), cs.draft_updated_at + interval '1 millisecond')`;

const SQL_ENQ_LIST = `select e.* from enquiries e where ${ENQ_WHERE} order by e.created_at desc, e.id limit $3 offset $4`;
const SQL_ENQ_TOTAL = `select count(*)::int as n from enquiries e where ${ENQ_WHERE}`;
const SQL_ENQ_EXPORT = `select e.* from enquiries e where ${ENQ_WHERE} order by e.created_at desc, e.id limit $3`;
// Tab counts honour the search text but not the status filter ($1 = LIKE pattern or null).
const SQL_ENQ_COUNTS = `select count(*) filter (where e.status = 'new')::int as new, count(*) filter (where e.status = 'in_progress')::int as in_progress,
    count(*) filter (where e.status = 'contacted')::int as contacted, count(*) filter (where e.status = 'closed')::int as closed,
    count(*) filter (where e.status = 'spam')::int as spam
  from enquiries e where ($1::text is null or e.ref ilike $1 escape '\\' or e.name ilike $1 escape '\\' or e.company ilike $1 escape '\\'
       or e.email ilike $1 escape '\\' or e.country ilike $1 escape '\\' or e.message ilike $1 escape '\\')`;
const SQL_SAVE_DRAFT = `update content_state cs set draft = $1::jsonb, draft_updated_at = ${NEXT_DRAFT_TS}, draft_updated_by = $2
  where cs.id = 1 and cs.draft_updated_at = $3::timestamptz returning cs.draft_updated_at`;
const SQL_ROLLBACK_STATE = `update content_state cs set draft = (select data from content_revisions where id = $1), draft_updated_at = ${NEXT_DRAFT_TS},
  draft_updated_by = $2, published_revision = $1 where cs.id = 1 returning cs.draft_updated_at`;
const SQL_DISCARD = `update content_state cs set draft = rv.data, draft_updated_at = ${NEXT_DRAFT_TS}, draft_updated_by = $1
  from content_revisions rv where rv.id = cs.published_revision and cs.id = 1 returning cs.draft_updated_at`;

function enquiryFilter(status, q) {
  const st = status || 'active';
  if (!ENQ_STATUSES.includes(st)) throw appError('invalid_input');
  const needle = String(q || '').trim();
  const like = needle ? '%' + needle.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_') + '%' : null;
  return [st, like];
}

// ---- transient connection failures (Neon scale-to-zero wake-up, restarts, pooler hiccups) ----
const TRANSIENT_SQLSTATE = new Set(['57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006', '53300']);
const TRANSIENT_NODE_CODES = new Set(['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN']);
const TRANSIENT_MESSAGE = /Connection terminated|timeout|ECONNRESET|ECONNREFUSED|socket hang up|Client has encountered a connection error|terminating connection/i;
const RETRY_BACKOFF_MS = [300, 1000, 2000];
const RETRY_BUDGET_MS = 11000; // stay well inside maxDuration (15 s): never start a retry that would overrun this

function isTransientError(e) {
  if (!e) return false;
  const code = e.code;
  if (code) return TRANSIENT_SQLSTATE.has(code) || TRANSIENT_NODE_CODES.has(code);
  return TRANSIENT_MESSAGE.test(String(e.message || ''));
}

/** Log line for a failed database call: code, name and message (URLs stripped, truncated). Never throws. */
function describeError(e) {
  const msg = String((e && e.message) || '').replace(/postgres(ql)?:\/\/[^\s]+/g, '[url]').slice(0, 200);
  return `code=${(e && e.code) || '-'} name=${(e && e.name) || '-'} message=${msg}`;
}

function createPgStore(env = process.env, opts = {}) {
  const pool = opts.pool || getPool(env.DATABASE_URL);
  const backoff = opts.backoffMs || RETRY_BACKOFF_MS;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /** Run fn(); on a transient error retry (after 300/1000/2000 ms) as long as fn is safe to repeat and the time budget allows. */
  async function withRetry(fn) {
    const t0 = Date.now();
    for (let i = 0; ; i++) {
      try { return await fn(); } catch (e) {
        if (i >= backoff.length || !isTransientError(e) || Date.now() - t0 + backoff[i] > RETRY_BUDGET_MS) throw e;
        await sleep(backoff[i]);
      }
    }
  }
  // Failed connects are always safe to retry (nothing ran yet).
  const connect = () => withRetry(() => pool.connect());
  const READ_ONLY = /^\s*(select|with)\b(?![\s\S]*\b(for\s+update|insert|update|delete)\b)/i;

  let readyP = null;
  const ready = () => {
    // prepareDatabase is one idempotent transaction, so the whole step may be repeated. A failure is never cached.
    if (!readyP) readyP = withRetry(() => prepareDatabase(pool, env)).catch((e) => { readyP = null; throw e; });
    return readyP;
  };

  /** Single statement. Retried as a whole only when read-only; writes are retried only if the connect failed. */
  async function q(text, params) {
    const readOnly = READ_ONLY.test(text);
    const once = async () => {
      const c = await connect();
      let broken = false;
      try { return await c.query(text, params); } catch (e) { broken = isTransientError(e); throw e; } finally { c.release(broken); }
    };
    return readOnly ? withRetry(once) : once();
  }
  /** Transaction. Retried only if the failure happened before BEGIN completed; never once it may have committed. */
  async function tx(fn) {
    const c = await withRetry(async () => {
      const cl = await pool.connect();
      try { await cl.query('begin'); } catch (e) { cl.release(true); throw e; }
      return cl;
    });
    let broken = false;
    try {
      const r = await fn(c);
      await c.query('commit');
      return r;
    } catch (e) {
      broken = isTransientError(e);
      try { await c.query('rollback'); } catch (e2) { broken = true; /* connection gone */ }
      throw e;
    } finally { c.release(broken); }
  }

  /** Wrap a method: wait for ready(), pass app errors through, turn everything else into 'unavailable' (never leak SQL). */
  const m = (fn) => async (...args) => {
    try {
      await ready();
      return await fn(...args);
    } catch (e) {
      if (e && APP_CODES.has(e.code)) throw e;
      console.error('Database error:', describeError(e));
      throw appError('unavailable');
    }
  };

  /** Keep the newest KEEP_REVISIONS revisions (plus the published one, always). Runs inside the publish/rollback transaction. */
  async function pruneRevisions(c) {
    await c.query(
      `delete from content_revisions where id not in (select id from content_revisions order by id desc limit $1)
         and id <> (select published_revision from content_state where id = 1)`, [KEEP_REVISIONS]);
  }

  const store = {
    kind: 'postgres',

    // ---------------------------------------------------------------- enquiries
    submitEnquiry: m(async (e) => {
      const ipHash = String(e.ip_hash || '').slice(0, 128);
      if (!ipHash || !e.name || !e.company || !e.email || !e.message || !e.type) throw appError('invalid_input');
      return tx(async (c) => {
        await c.query('select pg_advisory_xact_lock(hashtext($1))', [ipHash]);
        const n = await c.query(`select count(*)::int as n from enquiries where ip_hash = $1 and created_at > now() - interval '10 minutes'`, [ipHash]);
        if (n.rows[0].n >= RATE_MAX) throw appError('rate_limited');
        for (let i = 0; i < 5; i++) {
          const ref = `VFI-${istDate(new Date())}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
          const r = await c.query(
            `insert into enquiries (ref, type, name, company, email, country, volume, message, source_page, ip_hash, user_agent)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict (ref) do nothing returning id, ref`,
            [ref, e.type, e.name, e.company, e.email, e.country || '', e.volume || '', e.message, e.source_page || '', ipHash, String(e.user_agent || '').slice(0, 300)]);
          if (r.rows.length) return { ref: r.rows[0].ref, id: r.rows[0].id };
        }
        throw new Error('ref_collision');
      });
    }),
    listEnquiries: m(async ({ status, q: search, limit, offset } = {}) => {
      const [st, like] = enquiryFilter(status, search);
      const n = limit === undefined || limit === null ? 25 : Math.trunc(Number(limit));
      const lim = Math.min(Math.max(Number.isFinite(n) ? n : 25, 1), 100);
      const off = Math.max(Math.trunc(Number(offset)) || 0, 0);
      const [rows, total, counts] = await Promise.all([
        q(SQL_ENQ_LIST, [st, like, lim, off]),
        q(SQL_ENQ_TOTAL, [st, like]),
        q(SQL_ENQ_COUNTS, [like]),
      ]);
      return { rows: rows.rows.map(mapEnquiry), total: total.rows[0].n, counts: counts.rows[0] };
    }),
    updateEnquiry: m(async ({ id, status, notes }) => {
      if (status !== undefined && status !== null && !['new', 'in_progress', 'contacted', 'closed', 'spam'].includes(status)) throw appError('invalid_input');
      if (notes !== undefined && notes !== null && String(notes).length > 5000) throw appError('invalid_input');
      if (!UUID_RE.test(String(id))) throw appError('not_found');
      const r = await q(
        `update enquiries set status = coalesce($2, status), notes = coalesce($3, notes), updated_at = now() where id = $1 returning *`,
        [id, status == null ? null : status, notes == null ? null : String(notes)]);
      if (!r.rows.length) throw appError('not_found');
      return mapEnquiry(r.rows[0]);
    }),
    exportEnquiries: m(async ({ status, q: search } = {}) => {
      const [st, like] = enquiryFilter(status, search);
      const r = await q(SQL_ENQ_EXPORT, [st, like, EXPORT_MAX]);
      return r.rows.map(mapEnquiry);
    }),

    // ---------------------------------------------------------------- users
    createUser: m(async ({ email, name, role, password_hash, must_change_password }) => {
      try {
        const r = await q(
          `insert into users (email, name, role, password_hash, must_change_password) values ($1,$2,$3,$4,$5) returning *`,
          [String(email).toLowerCase(), name || '', role, password_hash, Boolean(must_change_password)]);
        return mapUser(r.rows[0]);
      } catch (e) {
        if (e && e.code === '23505') throw appError('email_taken');
        throw e;
      }
    }),
    getUserById: m(async (id) => {
      if (!UUID_RE.test(String(id))) return null;
      return mapUser((await q('select * from users where id = $1', [id])).rows[0]);
    }),
    getUserByEmail: m(async (email) => mapUser((await q('select * from users where email = $1', [String(email).toLowerCase()])).rows[0])),
    listUsers: m(async () => (await q('select * from users order by created_at, email')).rows.map((r) => noHash(mapUser(r)))),
    updateUser: m(async (id, patch = {}) => {
      if (!UUID_RE.test(String(id))) throw appError('not_found');
      return tx(async (c) => {
        await c.query('select pg_advisory_xact_lock($1)', [ADMIN_LOCK_ID]); // serialise role/active changes (last-admin rule)
        const cur = (await c.query('select * from users where id = $1 for update', [id])).rows[0];
        if (!cur) throw appError('not_found');
        const losesAdmin = cur.role === 'admin' && cur.active && ((patch.role !== undefined && patch.role !== 'admin') || patch.active === false);
        if (losesAdmin) {
          const others = await c.query(`select count(*)::int as n from users where role = 'admin' and active and id <> $1`, [id]);
          if (others.rows[0].n === 0) throw appError('last_admin');
        }
        const r = await c.query(
          `update users set name = coalesce($2, name), role = coalesce($3, role), active = coalesce($4, active),
             password_hash = coalesce($5, password_hash), must_change_password = coalesce($6, must_change_password),
             session_version = session_version + $7, updated_at = now() where id = $1 returning *`,
          [id, patch.name === undefined ? null : patch.name, patch.role === undefined ? null : patch.role,
            patch.active === undefined ? null : patch.active, patch.password_hash === undefined ? null : patch.password_hash,
            patch.must_change_password === undefined ? null : patch.must_change_password, patch.bump_session ? 1 : 0]);
        return mapUser(r.rows[0]);
      });
    }),
    recordLogin: m(async (id) => { if (UUID_RE.test(String(id))) await q('update users set last_login_at = now() where id = $1', [id]); }),

    // ---------------------------------------------------------------- login attempts
    /**
     * Atomic check + record. In one transaction: take advisory locks (per email, per ip; always in ascending key order, so
     * two transactions can never deadlock), count recent failures, and when under every limit insert the attempt as a
     * failure (ok = false). The caller flips it with markLoginSuccess() once the password verifies.
     */
    reserveLoginAttempt: m(async ({ ip_hash, email, sinceMs, limits }) => {
      const ip = String(ip_hash).slice(0, 128);
      const em = String(email || '').slice(0, 254);
      return tx(async (c) => {
        const keys = (await c.query(`select hashtext('loginip:' || $1::text) as ip_key, hashtext('login:' || $2::text) as email_key`, [ip, em])).rows[0];
        const lockKeys = em ? [keys.ip_key, keys.email_key] : [keys.ip_key];
        for (const k of [...new Set(lockKeys)].sort((x, y) => x - y)) await c.query('select pg_advisory_xact_lock($1::bigint)', [k]);
        const r = await c.query(
          `select count(*) filter (where ip_hash = $1)::int as ip,
                  count(*) filter (where $2 <> '' and email = $2 and ip_hash = $1)::int as email_ip,
                  count(*) filter (where $2 <> '' and email = $2)::int as email
             from login_attempts where ok = false and at > now() - ($3::double precision * interval '1 millisecond') and (ip_hash = $1 or email = $2)`,
          [ip, em, sinceMs]);
        const n = r.rows[0];
        if (n.ip >= limits.ip || (em !== '' && (n.email_ip >= limits.emailIp || n.email >= limits.email))) return { limited: true };
        const ins = await c.query('insert into login_attempts (ip_hash, email, ok) values ($1, $2, false) returning id', [ip, em]);
        return { limited: false, id: String(ins.rows[0].id) };
      });
    }),
    markLoginSuccess: m(async (id) => { if (/^[0-9]{1,18}$/.test(String(id))) await q('update login_attempts set ok = true where id = $1', [String(id)]); }),
    countFailedAttempts: m(async ({ ip_hash, email, sinceMs }) => {
      const r = await q(
        `select count(*) filter (where ip_hash = $1)::int as ip,
                count(*) filter (where $2 <> '' and email = $2 and ip_hash = $1)::int as email_ip,
                count(*) filter (where $2 <> '' and email = $2)::int as email
           from login_attempts where ok = false and at > now() - ($3::double precision * interval '1 millisecond') and (ip_hash = $1 or email = $2)`,
        [ip_hash, email || '', sinceMs]);
      return r.rows[0];
    }),
    /** Opportunistic retention: login_attempts older than 30 days, audit_log older than 365 days (both indexed on `at`). */
    pruneOld: m(async () => {
      const a = await q('delete from login_attempts where at < now() - ($1::int * interval \'1 day\')', [LOGIN_ATTEMPT_DAYS]);
      const b = await q('delete from audit_log where at < now() - ($1::int * interval \'1 day\')', [AUDIT_DAYS]);
      return { login_attempts: a.rowCount, audit_log: b.rowCount };
    }),

    // ---------------------------------------------------------------- content
    getContentState: m(async () => {
      const r = await q(
        `select cs.draft, cs.draft_updated_at, cs.draft_updated_by, u.name as by_name, u.email as by_email, cs.published_revision, rv.data as published
           from content_state cs left join users u on u.id = cs.draft_updated_by left join content_revisions rv on rv.id = cs.published_revision
          where cs.id = 1`);
      const x = r.rows[0];
      if (!x) return null;
      return {
        draft: x.draft, draft_updated_at: iso(x.draft_updated_at), draft_updated_by_id: x.draft_updated_by,
        draft_updated_by_name: x.draft_updated_by ? (x.by_name || x.by_email) : null,
        published_revision: x.published_revision, published: x.published,
      };
    }),
    getPublished: m(async () => {
      const r = await q(`select rv.id, rv.data, rv.published_at from content_state cs join content_revisions rv on rv.id = cs.published_revision where cs.id = 1`);
      return r.rows[0] ? { revision: r.rows[0].id, data: r.rows[0].data, published_at: iso(r.rows[0].published_at) } : null;
    }),
    saveDraft: m(async ({ data, base_updated_at, user_id }) => {
      const r = await q(SQL_SAVE_DRAFT, [JSON.stringify(data), user_id || null, base_updated_at]);
      if (r.rows.length) return { draft_updated_at: iso(r.rows[0].draft_updated_at), draft_updated_by_id: user_id || null };
      const cur = await q(`select cs.draft_updated_at, cs.draft_updated_by, u.name, u.email from content_state cs left join users u on u.id = cs.draft_updated_by where cs.id = 1`);
      if (!cur.rows[0]) throw appError('not_found');
      throw appError('conflict', { current: { updated_at: iso(cur.rows[0].draft_updated_at), updated_by_id: cur.rows[0].draft_updated_by, updated_by_name: cur.rows[0].draft_updated_by ? (cur.rows[0].name || cur.rows[0].email) : null } });
    }),
    /**
     * Publish the draft. Everything happens under the content_state row lock:
     *  - base_updated_at (optional) must equal the draft's current updated_at, else 'conflict' (the draft changed since the editor looked)
     *  - check(draft) (optional) re-validates the locked draft; returns null or an errors object -> 'invalid_input' with .errors
     *  - the draft must differ from the published revision, else 'nothing_to_publish'
     * Then old revisions beyond the newest KEEP_REVISIONS are deleted (never the published one).
     */
    publish: m(async ({ user_id, note, base_updated_at, check }) => tx(async (c) => {
      // Lock first, read second: a single "select ... for update" with joins would re-check only the locked row after waiting
      // and could pair the new draft with a stale published revision.
      await c.query('select 1 from content_state where id = 1 for update');
      const st = await c.query(
        `select cs.draft, cs.draft_updated_at, cs.draft_updated_by, u.name, u.email, rv.data as published
           from content_state cs left join users u on u.id = cs.draft_updated_by left join content_revisions rv on rv.id = cs.published_revision
          where cs.id = 1`);
      const x = st.rows[0];
      if (!x) throw appError('not_found');
      if (base_updated_at && new Date(base_updated_at).getTime() !== new Date(x.draft_updated_at).getTime()) {
        throw appError('conflict', { current: { updated_at: iso(x.draft_updated_at), updated_by_id: x.draft_updated_by, updated_by_name: x.draft_updated_by ? (x.name || x.email) : null } });
      }
      if (typeof check === 'function') {
        const errors = check(x.draft);
        if (errors) throw appError('invalid_input', { errors });
      }
      if (same(x.draft, x.published)) throw appError('nothing_to_publish');
      const rev = await c.query(
        `insert into content_revisions (data, note, published_by) select draft, $1, $2 from content_state where id = 1 returning id, note, published_at`,
        [String(note || ''), user_id || null]);
      await c.query('update content_state set published_revision = $1 where id = 1', [rev.rows[0].id]);
      await pruneRevisions(c);
      return { id: rev.rows[0].id, note: rev.rows[0].note, published_at: iso(rev.rows[0].published_at), sections: changedSections(x.draft, x.published) };
    })),
    rollback: m(async ({ id, user_id }) => {
      const rid = intId(id);
      if (!rid) throw appError('not_found');
      return tx(async (c) => {
        const lock = await c.query('select 1 from content_state where id = 1 for update');
        if (!lock.rows.length) throw appError('not_found');
        const rev = await c.query(
          `insert into content_revisions (data, note, published_by) select data, $2, $3 from content_revisions where id = $1 returning id, note, published_at`,
          [rid, `Rollback to #${rid}`, user_id || null]);
        if (!rev.rows.length) throw appError('not_found');
        const st = await c.query(SQL_ROLLBACK_STATE, [rev.rows[0].id, user_id || null]);
        await pruneRevisions(c);
        return { revision: { id: rev.rows[0].id, note: rev.rows[0].note, published_at: iso(rev.rows[0].published_at) }, draft_updated_at: iso(st.rows[0].draft_updated_at) };
      });
    }),
    discardDraft: m(async ({ user_id }) => {
      const r = await q(SQL_DISCARD, [user_id || null]);
      if (!r.rows.length) throw appError('not_found');
      return { draft_updated_at: iso(r.rows[0].draft_updated_at) };
    }),
    listRevisions: m(async ({ limit, offset } = {}) => {
      const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 25, 1), 100);
      const off = Math.max(Math.trunc(Number(offset)) || 0, 0);
      const [rows, total, cur] = await Promise.all([
        q(`select rv.id, rv.note, rv.published_at, rv.published_by, u.name, u.email from content_revisions rv left join users u on u.id = rv.published_by
            order by rv.id desc limit $1 offset $2`, [lim, off]),
        q('select count(*)::int as n from content_revisions'),
        q('select published_revision from content_state where id = 1'),
      ]);
      return {
        rows: rows.rows.map((x) => ({ id: x.id, note: x.note, published_at: iso(x.published_at), published_by_id: x.published_by, published_by_name: x.published_by ? (x.name || x.email) : 'System' })),
        total: total.rows[0].n, published_revision: cur.rows[0] ? cur.rows[0].published_revision : null,
      };
    }),
    getRevision: m(async (id) => {
      const rid = intId(id);
      if (!rid) return null;
      const r = await q(
        `select rv.id, rv.data, rv.note, rv.published_at, rv.published_by, u.name, u.email from content_revisions rv left join users u on u.id = rv.published_by where rv.id = $1`, [rid]);
      const x = r.rows[0];
      return x ? { id: x.id, data: x.data, note: x.note, published_at: iso(x.published_at), published_by_id: x.published_by, published_by_name: x.published_by ? (x.name || x.email) : 'System' } : null;
    }),

    /** Ids (newest first, at most `limit`) of revisions whose content contains this exact string value. */
    findRevisionsUsing: m(async (value, limit = 20) => {
      const needle = '%' + likeEscape(JSON.stringify(String(value))) + '%'; // the quoted JSON string, so a longer URL with the same prefix does not match
      const r = await q(`select id from content_revisions where data::text like $1 escape '\\' order by id desc limit $2`, [needle, Math.min(Math.max(Math.trunc(Number(limit)) || 20, 1), 100)]);
      return r.rows.map((x) => x.id);
    }),
    /** Subset of `urls` that has no row in the media table. */
    findMissingMedia: m(async (urls) => {
      const list = [...new Set((urls || []).map(String))];
      if (!list.length) return [];
      const have = new Set((await q('select url from media where url = any($1::text[])', [list])).rows.map((x) => x.url));
      return list.filter((u) => !have.has(u));
    }),

    // ---------------------------------------------------------------- media
    addMedia: m(async (x) => {
      const r = await q(
        `insert into media (url, pathname, content_type, size, width, height, alt, uploaded_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [x.url, x.pathname, x.content_type, x.size, x.width == null ? null : x.width, x.height == null ? null : x.height, x.alt || '', x.uploaded_by || null]);
      return mapMedia(r.rows[0]);
    }),
    listMedia: m(async ({ limit, offset } = {}) => {
      const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 100);
      const off = Math.max(Math.trunc(Number(offset)) || 0, 0);
      const [rows, total] = await Promise.all([q('select * from media order by created_at desc, id limit $1 offset $2', [lim, off]), q('select count(*)::int as n from media')]);
      return { rows: rows.rows.map(mapMedia), total: total.rows[0].n };
    }),
    getMedia: m(async (id) => {
      if (!UUID_RE.test(String(id))) return null;
      const r = await q('select * from media where id = $1', [id]);
      return r.rows[0] ? mapMedia(r.rows[0]) : null;
    }),
    updateMedia: m(async (id, { alt }) => {
      if (!UUID_RE.test(String(id))) throw appError('not_found');
      const r = await q('update media set alt = $2 where id = $1 returning *', [id, String(alt || '')]);
      if (!r.rows.length) throw appError('not_found');
      return mapMedia(r.rows[0]);
    }),
    deleteMedia: m(async (id) => (UUID_RE.test(String(id)) ? (await q('delete from media where id = $1', [id])).rowCount > 0 : false)),

    // ---------------------------------------------------------------- audit
    addAudit: m(async ({ user_id, action, target, detail }) => {
      await q('insert into audit_log (user_id, action, target, detail) values ($1, $2, $3, $4::jsonb)',
        [user_id || null, String(action).slice(0, 80), String(target || '').slice(0, 300), JSON.stringify(detail || {})]);
    }),
    listAudit: m(async ({ limit, offset } = {}) => {
      const lim = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 200);
      const off = Math.max(Math.trunc(Number(offset)) || 0, 0);
      const [rows, total] = await Promise.all([
        q(`select a.id, a.at, a.user_id, a.action, a.target, a.detail, u.name, u.email from audit_log a left join users u on u.id = a.user_id order by a.at desc, a.id desc limit $1 offset $2`, [lim, off]),
        q('select count(*)::int as n from audit_log'),
      ]);
      return {
        rows: rows.rows.map((x) => ({ id: Number(x.id), at: iso(x.at), user_id: x.user_id, user_name: x.user_id ? (x.name || x.email) : null, user_email: x.email || null, action: x.action, target: x.target, detail: x.detail })),
        total: total.rows[0].n,
      };
    }),

    /** Force startup (migrate/bootstrap/seed) now; used by tests and health checks. */
    ensureReady: m(async () => true),
    close: async () => {},
  };
  return store;
}

module.exports = { createPgStore, isTransientError, describeError };
