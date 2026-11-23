# VFI Group website — CMS & admin panel architecture (v2, lead engineer)

Status: approved. Supersedes the Supabase parts of `docs/ARCHITECTURE.md` (§1, §3, §6, §7). HTTP contract for
`POST /api/enquiry` (§5 of ARCHITECTURE.md) is unchanged. Owner decisions: **Neon Postgres (free)**,
**draft → preview → publish with revisions/rollback**, **named users with roles**.

## 1. Overview

```
Visitor ──► Vercel static /public ──► GET /api/content (published JSON, CDN-cached 60 s)
                                       app.js renders every data-driven section + [data-cms] texts from it
Admin   ──► /admin (static SPA) ──► /api/admin/* (cookie session, role checks)
                                     ├─ Postgres (Neon) via `pg` (DATABASE_URL, server-only)
                                     └─ Vercel Blob (BLOB_READ_WRITE_TOKEN) for uploaded images
Local/tests ──► server.js + memory store (no DATABASE_URL) — same handlers
```

- Functions (Hobby limit 12, keep ≤ 4): `api/enquiry.js`, `api/content.js`, `api/admin/[action].js`.
- Driver: **`pg`** (node-postgres) Pool, `max: 3`, `ssl: { rejectUnauthorized: true }` when the URL has `sslmode=require`
  or host ends with `neon.tech`; reused across invocations (module scope). Works with Neon and local Postgres.
- **Self-migrating:** on first DB use per instance, `lib/db/migrate.js` takes `pg_advisory_lock(727001)`, creates
  `schema_migrations(version text primary key, applied_at timestamptz)`, applies pending `db/migrations/NNN_*.sql`
  in order (each in a transaction), releases the lock. Migrations must be idempotent-safe and contain no secrets.
- **Bootstrap admin:** after migrating, if `users` is empty and env `BOOTSTRAP_ADMIN_EMAIL` + `BOOTSTRAP_ADMIN_PASSWORD`
  are set, create that user with role `admin` and `must_change_password = true`. Never log the password.
- **Seed content:** if `content_state` has no row, insert the bundled defaults (`public/content/default.json`) as both the
  draft and revision #1 (published), author "system".
- Fail closed: in production (`VERCEL` or `NODE_ENV=production`) without `DATABASE_URL`, enquiry and admin endpoints
  return 503 `unavailable`; `/api/content` returns the bundled defaults with header `X-Content-Source: defaults`.
- The Supabase store/migrations are removed (`supabase/`, `lib/store/supabase.js`); `SUPABASE_*` env no longer used.

## 2. Data model (`db/migrations/001_init.sql`)

```sql
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,                 -- stored lower-case
  name text not null default '',
  role text not null check (role in ('admin','editor','sales')),
  password_hash text not null,                -- scrypt: "scrypt$N$r$p$saltB64$hashB64"
  must_change_password boolean not null default false,
  active boolean not null default true,
  session_version int not null default 1,     -- bump to revoke all sessions of the user
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);
create table if not exists login_attempts (
  id bigserial primary key, ip_hash text not null, email text not null default '',
  ok boolean not null, at timestamptz not null default now());
create index if not exists login_attempts_ip_at on login_attempts (ip_hash, at desc);

create table if not exists enquiries ( ...same columns as ARCHITECTURE.md §3... );   -- + same indexes

create table if not exists content_state (
  id int primary key check (id = 1),
  draft jsonb not null,
  draft_updated_at timestamptz not null default now(),
  draft_updated_by uuid references users(id),
  published_revision int not null              -- references content_revisions(id)
);
create table if not exists content_revisions (
  id serial primary key,
  data jsonb not null,
  note text not null default '',
  published_by uuid references users(id),     -- null = system seed
  published_at timestamptz not null default now()
);
create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  url text not null, pathname text not null, content_type text not null, size int not null,
  width int, height int, alt text not null default '',
  uploaded_by uuid references users(id), created_at timestamptz not null default now()
);
create table if not exists audit_log (
  id bigserial primary key, user_id uuid references users(id), action text not null,
  target text not null default '', detail jsonb not null default '{}', at timestamptz not null default now());
create index if not exists audit_log_at on audit_log (at desc);
```
`gen_random_uuid()` is built into Postgres 13+. All SQL from JS uses parameterised queries only.

## 3. Roles & permissions

| Capability | admin | editor | sales |
|---|---|---|---|
| View/update/export enquiries | ✓ | ✓ | ✓ |
| Edit draft content, upload media, preview, publish, rollback | ✓ | ✓ | – |
| Manage users (create, change role, deactivate, reset password), view audit log | ✓ | – | – |
| Change own name/password | ✓ | ✓ | ✓ |
A deactivated user or bumped `session_version` invalidates sessions immediately (checked on every request).
At least one active admin must always remain (block demoting/deactivating the last one).

## 4. Auth

- Passwords: Node `crypto.scrypt` (N=16384, r=8, p=1, 32-byte salt, 64-byte key), constant-time compare. Policy: ≥ 12 chars.
- Session cookie `vfi_admin` = `base64url(JSON{uid, v, exp}) + "." + HMAC-SHA256(SESSION_SECRET)`; HttpOnly; Secure
  (except localhost dev); SameSite=Strict; Path=/; 12 h. Every request loads the user (id, role, active,
  session_version) and rejects mismatches with 401.
- Login rate limit in DB: > 10 failed attempts per ip_hash in 15 min, or > 5 failed per email in 15 min → 429.
- CSRF: all non-GET admin requests require header `X-Requested-With: vfi-admin` (as today).
- `must_change_password` users can only call `session`, `logout`, `me/password` until they change it.
- `SESSION_SECRET` ≥ 32 chars, else admin returns 503 `admin_not_configured`. `ADMIN_PASSWORD` is retired.

## 5. Content model

Single JSON document. Shape is defined by **`public/content/default.json`** (the current site content, extracted
verbatim from `public/js/app.js` data arrays and the hero/section texts) and described for the editor by
**`public/admin/content-schema.json`**. Both are created by the Site engineer and are the shared contract.

Top-level keys (each a section in the editor):
`settings` (site url, contact office/sales/careers, factories, presence/branches, social links),
`seo` (title + description per route), `hero` (slides: kicker, heading, sub, image, buttons),
`scale` (figures: value, suffix, label; highlight chips), `portfolio` (categories), `brands`
(name, sub, tag, since, logo, url, image, description, collections), `capabilities`, `technologies`, `foam`,
`solutions` (the APPS tabs), `routes` (partnership routes), `retail` (name, logo), `hotels`, `markets`, `awards`
(name, image), `timeline`, `values`, `whatWeDo`, `glance`, `csr`, `conduct`, `careers` (roles), `process`,
`texts` (map of `data-cms` key → string for headings/intros/paragraphs in index.html that are editable).

Schema format (`content-schema.json`): `{ "sections": [ { "key", "label", "description", "fields": [Field] } ] }`,
Field = `{ "key", "label", "type", "help"?, "required"?, "max"?, "options"?, "fields"? (for list/object) }`,
`type` ∈ `text | textarea | url | number | image | select | stringList | object | list`.
`list` = ordered array of objects with `fields`; editor supports add, remove, reorder, duplicate.
`image` fields hold a URL: either a bundled `/assets/...` path or an uploaded Blob URL.

Server validation (`lib/content/validate.js`): JSON ≤ 512 KB; walks the schema; strings trimmed and length-capped
(`max` or 2000); urls must be `https://`, `/` or `mailto:`/`tel:`; image urls must be `/assets/` paths or the Blob
store host; unknown keys rejected; required fields present. Returns field-path errors (`brands[3].url`).

## 6. HTTP API (additions)

`GET /api/content` → published JSON. `Cache-Control: public, s-maxage=60, stale-while-revalidate=300`, `ETag`.
`GET /api/content?draft=1` → draft JSON, requires editor/admin session, `Cache-Control: no-store`.

Admin actions (`/api/admin/<action>`), JSON `{ok, ...}` / `{ok:false, error, code}` as before:

| Method action | Role | Body/query → result |
|---|---|---|
| POST `login` | – | `{email,password}` → `{user}` + cookie |
| POST `logout` | any | clears cookie |
| GET `session` | – | `{authenticated, user?}` (user: id,email,name,role,must_change_password) |
| POST `password` | any | `{current,next}` → bumps session_version, re-issues cookie |
| GET/PATCH `enquiries`, GET `export` | any | unchanged contract |
| GET `content` | editor | `{draft, draft_updated_at, draft_updated_by, published_revision, hasUnpublished}` |
| PUT `content` | editor | `{draft, base_updated_at}` → validates, saves draft; 409 `conflict` if `base_updated_at` ≠ current (someone else saved) |
| POST `publish` | editor | `{note}` → new revision from draft, sets published; returns `{revision}` |
| GET `revisions` | editor | `?page` → list (id, note, published_by name, published_at, is_current) |
| GET `revision` | editor | `?id` → full data |
| POST `rollback` | editor | `{id}` → copies revision into draft AND publishes it as a new revision (note "Rollback to #id") |
| POST `discard` | editor | resets draft to the published revision |
| GET `media` | editor | list (paged) |
| POST `media` | editor | raw body, `Content-Type: image/png|jpeg|webp|svg+xml`, header `X-Filename`, ≤ 4 MB → Blob `put('media/<uuid>-<safe-name>')` → row |
| DELETE `media` | editor | `?id` → deletes blob + row (refuse with 409 if the URL is used in draft or published content) |
| GET `users` / POST `users` / PATCH `users` | admin | list / create `{email,name,role,password}` / update `{id, role?, active?, name?, resetPassword?}` (reset → returns a generated temporary password once, sets must_change_password, bumps session_version) |
| GET `audit` | admin | paged audit log |
Every write action appends to `audit_log`. SVG uploads: reject unless sanitised — simplest: **do not accept SVG**.

## 7. Public site rendering

- `public/js/app.js` gets content via `boot()`: `fetch('/api/content', {cache:'no-cache'})` with a 2.5 s timeout;
  on any failure use the bundled `public/content/default.json` (fetched the same way) — never a blank page.
- With `?preview=1`, fetch `/api/content?draft=1` (credentials same-origin); on 401 fall back to published.
  Show a fixed "Preview — draft content" banner with an "Exit preview" link.
- All current data arrays (CAPS, APPS, BRANDS, ROUTES, RETAIL, HOTELS, MARKETS, AWARDS, JOURNEY, PROC, SUS, VALS,
  ROLES, CONDUCT, TECH, FOAM, PRESENCE, GLANCE, WHATWEDO, PRODCATS, PORTFOLIO, SITE, DESC, scale figures, hero slides)
  are read from the content object. Elements with `data-cms="key"` get `textContent = content.texts[key]` when present.
- Render user content with textContent / escaped templates only (content is editable by staff; still treat as untrusted).
- CSP `img-src` adds the Blob public host `https://*.public.blob.vercel-storage.com`.

## 8. Admin UI (`public/admin/`)

Single page app, no build step, CSP-safe, extends the existing enquiries dashboard:
Login (email + password) → forced password change if required → app shell with left nav by role:
**Enquiries** (existing), **Content** (section list from schema → generated form editor; draft status bar "Saved /
Unsaved changes / Published"; Save draft (also Ctrl/Cmd+S), Preview (opens `/?preview=1` in new tab), Publish (with
note), Discard draft; conflict dialog on 409), **Media** (grid, upload with drag-drop + client-side resize to ≤ 2000 px
JPEG/WebP via canvas, alt text, copy URL, delete), **History** (revisions, view diff summary of changed sections,
rollback with confirm), **Users** (admin), **Audit log** (admin), **My account** (name, change password).
Image fields offer "Choose from media" and "Upload". Lists support add/remove/reorder (buttons + keyboard).
Never use innerHTML with content values.

## 9. Environment (Vercel Production + Preview)
`DATABASE_URL` (from Neon integration), `BLOB_READ_WRITE_TOKEN` (from Blob store), `SESSION_SECRET`, `IP_SALT`,
`BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, optional SMTP_*. Remove `ADMIN_PASSWORD`, `SUPABASE_*`.

## 10. Tests
`npm test` (node:test) must run without network: memory store implements users/content/revisions/media/audit;
Blob calls go through `lib/media.js` with an injectable uploader (fake in tests). Integration tests against a local
Postgres run only when `TEST_DATABASE_URL` is set. Reviewers run Playwright against `server.js`.
