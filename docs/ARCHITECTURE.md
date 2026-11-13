# VFI Group website — architecture (lead engineer)

Status: approved. Engineers implement against this document; the PM breaks it into tasks in `docs/TASKS.md`.

## 1. System overview

```
Browser ──► Vercel (static: /public)              www.vfigroup.org (apex 308 → www)
        └─► Vercel Functions (/api/*, Node 20) ──► Supabase Postgres (RPC only, via PostgREST)
                                                └─► optional SMTP email (nodemailer)
Admin   ──► /admin (static page) ──► /api/admin/* (cookie session)
Local   ──► server.js (Express) mounts the SAME handler modules; memory/file store when Supabase env is absent
```

- Public site: existing static SPA in `public/` (hand-written HTML/CSS/JS, no framework, no build step). Keep it that way.
- Backend: Vercel Node functions. **Max 4 function files** (Hobby plan limit is 12; keep headroom).
- Database: Supabase Postgres. The functions only ever call **SECURITY DEFINER RPC functions** through PostgREST using the
  project's publishable (anon) key, which lives only in Vercel env vars and is never sent to the browser.
  Tables have RLS enabled and **no policies**, and `anon`/`authenticated` have no table privileges, so the key alone can do
  nothing except call the RPCs below. Every RPC additionally requires a server-held secret (`SUPABASE_ADMIN_SECRET`) whose
  SHA-256 hash is stored in `private.app_secrets` (the `private` schema is not exposed by the API).

## 2. Files and ownership

| Path | Owner |
|---|---|
| `supabase/migrations/0001_init.sql`, `0002_harden_submit.sql` (apply in this order; never edit an applied migration) | Backend engineer |
| `lib/**` (validation, store, session, http helpers, mail) | Backend engineer |
| `api/enquiry.js`, `api/admin/[action].js` | Backend engineer |
| `server.js` (local dev only), `package.json`, `vercel.json`, `.env.example`, `tests/**` | Backend engineer |
| `public/admin/index.html`, `public/admin/admin.css`, `public/admin/admin.js` | Admin UI engineer |
| `public/index.html`, `public/404.html` (exact copy of index.html), `public/js/app.js`, `public/css/style.css`, `public/robots.txt`, `public/sitemap.xml` | Site engineer |

Do not edit files you don't own. Do not run git commands (the lead commits).

## 3. Data model (Supabase)

```sql
create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;

create table public.enquiries (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,                 -- e.g. VFI-261113-A1B2C3
  type        text not null,                        -- one of ENQUIRY_TYPES
  name        text not null,
  company     text not null,
  email       text not null,
  country     text not null default '',
  volume      text not null default '',             -- one of VOLUMES
  message     text not null,
  source_page text not null default '',
  ip_hash     text not null default '',             -- HMAC of IP with IP_SALT, never the raw IP
  user_agent  text not null default '',
  status      text not null default 'new' check (status in ('new','in_progress','contacted','closed','spam')),
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index on public.enquiries (created_at desc);
create index on public.enquiries (status, created_at desc);
create index on public.enquiries (ip_hash, created_at desc);
alter table public.enquiries enable row level security;   -- no policies on purpose
revoke all on public.enquiries from anon, authenticated;

create table private.app_secrets (name text primary key, hash text not null);
```

### RPC functions (all `security definer`, `set search_path = ''`, fully-qualified names inside)

Revoke `execute` from `public` on every function, then `grant execute ... to anon` explicitly.

1. `public.submit_enquiry(p_secret text, p jsonb) returns jsonb` (migration 0002; 0001 created a one-argument version that 0002 drops)
   - First calls `private.assert_admin(p_secret)`: the same server-held `SUPABASE_ADMIN_SECRET` protects every RPC, so the anon key alone cannot insert.
   - `p.ip_hash` is mandatory: empty/missing → `invalid_input` (`22023`), so the rate limit cannot be skipped.
   - Re-validates server-side (lengths below, type/volume whitelists, email regex). Raises `invalid_input` (SQLSTATE `22023`) on failure.
   - Rate limit: if ≥ 5 rows with the same non-empty `ip_hash` in the last 10 minutes → raise `rate_limited` (SQLSTATE `P0429`).
   - Generates `ref` = `'VFI-' || to_char(now() at time zone 'Asia/Kolkata','YYMMDD') || '-' || upper(substr(encode(extensions.gen_random_bytes(3),'hex'),1,6))`.
   - Returns `{"ref": "...", "id": "..."}`.
2. `public.admin_list_enquiries(p_secret text, p_status text, p_q text, p_limit int, p_offset int) returns jsonb`
   - `p_status` null/'' = all except spam; 'all' = everything; otherwise exact status.
   - `p_q` case-insensitive match on ref, name, company, email, country, message.
   - `p_limit` clamped 1..100. Order `created_at desc`.
   - Returns `{"rows":[...enquiry objects without ip_hash...], "total": n, "counts": {"new":n,"in_progress":n,"contacted":n,"closed":n,"spam":n}}`.
3. `public.admin_update_enquiry(p_secret text, p_id uuid, p_status text, p_notes text) returns jsonb` — null args mean "unchanged"; sets `updated_at`; returns the row (without ip_hash). Raises `not_found` (SQLSTATE `P0404`).
4. `public.admin_export_enquiries(p_secret text, p_status text, p_q text) returns jsonb` — same filters, max **2000** rows (newest first), array.
- Every admin RPC first calls `private.assert_admin(p_secret)` which raises `forbidden` (SQLSTATE `P0403`) unless
  `encode(extensions.digest(p_secret,'sha256'),'hex')` equals `private.app_secrets.hash` where `name='admin_api'`.
- The lead inserts the secret hash after applying the migration; the migration must NOT contain any secret.

## 4. Validation rules (identical in JS `lib/validate.js` and SQL)

| Field | Rule |
|---|---|
| type | one of: `Retail partnership, Hospitality, OEM manufacturing, Private label, Foam supply, International, Careers, Other`; anything else → `Other` (JS) |
| name | required, 1–120 chars after trim |
| company | required, 1–160 |
| email | required, ≤ 200, `^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$` and no `..` anywhere (rejects consecutive dots, leading/trailing domain dots, spaces) |
| country | optional, ≤ 80 |
| volume | one of `'', Exploring options, Under 500 units a month, 500 to 2,000 units a month, Over 2,000 units a month` |
| message | required, 1–5000 |
| page | optional, ≤ 200 |
Strip ASCII control chars (including `\r`; except `\n` `\t`) from all strings, then trim. Single-line fields (everything except message) additionally collapse `[\r\n\t]+` to one space. SQL (`private.clean_text` / `private.clean_line`) matches `lib/validate.js`.

## 5. HTTP API contract

All JSON responses: `{"ok": true, ...}` or `{"ok": false, "error": "<human message>", "code": "<machine code>"}`.
Headers on every API response: `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`.

### `POST /api/enquiry`
Body (JSON, ≤ 32 KB): `{type, name, company, email, country, volume, msg, page, website, t}`
- `website` = honeypot; non-empty → respond `200 {"ok":true,"ref":"VFI-OK"}` and store nothing.
- `t` = milliseconds the form was open (client sends `Date.now() - renderedAt`). `t < 2500` → treat as bot exactly like honeypot.
- 400 `bad_json` · 405 `method_not_allowed` (with `Allow: POST`) · 415 if content-type is not JSON · 422 `invalid_input` with field-level `errors: {field: message}` · 429 `rate_limited` · 503 `unavailable` if the store fails · 200 `{ok:true, ref}`.
- After a successful insert, send email notification if SMTP env is configured; the request waits at most 3000 ms for it (SMTP timeouts 3 s); email failure or timeout must NOT fail the request (log it).

### Admin (`api/admin/[action].js`, `action` from `req.query.action`)
Session cookie `vfi_admin`: value `base64url(JSON{exp}) + "." + base64url(HMAC-SHA256(SESSION_SECRET, payload))`,
`HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=43200`. Payload is `{exp, v}` where `v` = first 16 hex chars of HMAC-SHA256(SESSION_SECRET, ADMIN_PASSWORD); tokens whose `v` does not match are rejected, so changing the password or secret logs everyone out. (Omit `Secure` only when `NODE_ENV !== 'production'` and host is localhost.)
State-changing admin requests (POST/PATCH) must also carry header `X-Requested-With: vfi-admin` (CSRF defence in depth).

| Method + path | Body / query | Response |
|---|---|---|
| `POST /api/admin/login` | `{password}` | 200 sets cookie · 401 `bad_credentials` (after a ~400 ms delay) · 429 after 10 failures/15 min per IP hash (per-instance memory is acceptable) |
| `POST /api/admin/logout` | – | 200 clears cookie |
| `GET /api/admin/session` | – | 200 `{ok:true, authenticated:bool}` |
| `GET /api/admin/enquiries` | `?status=&q=&page=1&pageSize=25` | 200 `{ok, rows, total, counts, page, pageSize}` · 401 `unauthenticated` |
| `PATCH /api/admin/enquiries` | `{id, status?, notes?}` | 200 `{ok, row}` · 404 · 422 |
| `GET /api/admin/export` | `?status=&q=` | `text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="vfi-enquiries-YYYY-MM-DD.csv"`; UTF-8 BOM; RFC 4180 quoting; prefix cells starting with `= + - @` with `'` (CSV injection) |
Unknown action → 404 `not_found`.

## 6. Store abstraction (`lib/store/`)
`createStore()` returns `{ submitEnquiry(e), listEnquiries({status,q,limit,offset}), updateEnquiry({id,status,notes}), exportEnquiries({status,q}) }`.
- `supabase` implementation: every RPC (submit included) sends `p_secret` = `SUPABASE_ADMIN_SECRET`. `fetch(`${SUPABASE_URL}/rest/v1/rpc/<fn>`)` with headers `apikey` and `Authorization: Bearer <SUPABASE_ANON_KEY>`. Map PostgREST errors by SQLSTATE/message to codes: `rate_limited`, `invalid_input`, `forbidden`, `not_found`, else `unavailable`. 8 s timeout via AbortController.
- `memory` implementation (used when `SUPABASE_URL` is unset, **local/dev/tests only**): same behaviour incl. rate limiting, mandatory ip_hash and the 2000-row export cap, persisted to `data/enquiries.json` when not on Vercel.
- **Fail closed**: if `VERCEL` or `NODE_ENV=production` and `SUPABASE_URL` or `SUPABASE_ANON_KEY` is missing, `createStore()` returns a store whose every call throws code `unavailable` (handlers answer 503); the memory store is never used there.

## 7. Environment variables (Vercel → Production + Preview)
`SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_ADMIN_SECRET`, `ADMIN_PASSWORD`, `SESSION_SECRET`, `IP_SALT`,
`TRUST_PROXY` (optional, see below), optional `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ENQUIRY_TO`, `ENQUIRY_FROM`.
If `ADMIN_PASSWORD` is missing or shorter than 12 characters, or `SESSION_SECRET` is missing or shorter than 32, admin refuses everything (503 `admin_not_configured`, reason logged), never allows.

Client IP (rate limiting): on Vercel use the first value of `x-vercel-forwarded-for`, then `x-real-ip`, then the first `x-forwarded-for` hop. Elsewhere use the socket address and read `x-forwarded-for` only when `TRUST_PROXY=1`. IPv6 is truncated to its /64 and IPv4-mapped IPv6 is treated as IPv4 before HMAC hashing.

Routing: `server.js` is case-sensitive (`/ABOUT` → 404) like Vercel; the page rewrite in `vercel.json` accepts an optional trailing slash; no catch-all. Functions `maxDuration` is 15 s.

## 8. Security headers (`vercel.json`, all routes)
`Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`, `X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: camera=(), microphone=(), geolocation=()`,
`X-Frame-Options: DENY`, and CSP:
`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'`.
The public site and admin must work under this CSP (no inline `<script>` except `type="application/ld+json"`, no inline event-handler attributes, no `javascript:` URLs).
`/admin` and `/api/*` must send `X-Robots-Tag: noindex`.

## 9. Testing
- `npm test` runs `node --test tests/` with no network and no Supabase (memory store). Cover: validation, honeypot, timing trap, rate limit, 405/415/400/422, admin login success/failure/lockout, session tampering, list/filter/search/pagination, update, export CSV quoting + injection guard.
- Playwright smoke tests are run by reviewers against `PORT=<n> node server.js`.
