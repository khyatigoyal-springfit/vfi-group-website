# VFI Group website

Corporate website for Varahamurti Flexirub Industries Pvt. Ltd.

## Run locally
```
npm install
npm start          # http://localhost:3000
```

## Structure
```
server.js            Express dev server: clean URLs, mounts api/ handlers, security headers
api/enquiry.js       POST /api/enquiry (Vercel function, also mounted by server.js)
api/admin/[action].js  Admin API: login, logout, session, enquiries, export
lib/                 validate, http, session, ratelimit, csv, mail, store/ (supabase + memory)
supabase/migrations/ Database schema and RPC functions
tests/               node:test suite (npm test)
public/admin/        Admin dashboard (static)
public/index.html    All page markup (pages are <div class="view" data-view="…">)
public/css/style.css Styles
public/js/app.js     Router, configurator, sliders, forms + all editable content
public/assets/img/   Images and logos
```

## Pages
/ · /about · /manufacturing · /innovation · /products · /brands · /partnerships ·
/sustainability · /careers · /contact · /privacy · /terms · /code-of-conduct (unknown URLs show a 404 page)

## Editing content
Most text lives in arrays at the top of `public/js/app.js` (CAPS, APPS, BRANDS, PARTNERS, JOURNEY, ROLES …).
Contact details, factory list and site URL: `SITE` at the top of `public/js/app.js` (filled from www.vfigroup.org; empty fields stay hidden).

Content sources: company facts, timeline, brands, technologies, CSR policy and code of conduct were taken from
www.vfigroup.org (home, /innovation, /vfi-corporate-profile, /vfi-group-code-of-conduct). Images in
`assets/img/caps`, `tech`, `story`, `brands`, `partners`, `awards` and `certs` come from the same site, optimised.

## Backend

**Architecture.** The site is static (`public/`) plus two Vercel Node functions (`api/enquiry.js`, `api/admin/[action].js`).
The functions store enquiries in Supabase Postgres by calling `SECURITY DEFINER` RPC functions through PostgREST with the
publishable (anon) key. Tables have RLS on, no policies and no grants, so the key alone can only call the four RPCs.
Admin RPCs also require `SUPABASE_ADMIN_SECRET`, whose SHA-256 hash lives in `private.app_secrets`.
Without `SUPABASE_URL` the same handlers use a local memory store persisted to `data/enquiries.json`
(add `data/` to `.gitignore`; it is never used on Vercel).

### Setup
1. Create a Supabase project.
2. Run `supabase/migrations/0001_init.sql` in the SQL editor (safe to re-run; it contains no secrets).
3. Generate an admin API secret (`openssl rand -hex 32`) and store its hash (replace `<SECRET>`):
   ```sql
   insert into private.app_secrets(name,hash) values ('admin_api', encode(extensions.digest('<SECRET>','sha256'),'hex'))
   on conflict (name) do update set hash=excluded.hash;
   ```
4. In Vercel (Production and Preview) set the variables listed in `.env.example`:
   `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_ADMIN_SECRET` (the `<SECRET>` from step 3), `ADMIN_PASSWORD`,
   `SESSION_SECRET`, `IP_SALT`, and optionally `SMTP_*`, `ENQUIRY_TO`, `ENQUIRY_FROM`.
5. Check privacy: as `anon`, `select * from public.enquiries;` must fail with `permission denied`
   (SQL editor: `set role anon; select * from public.enquiries;`).

### Local development
```
npm install
npm start          # http://localhost:3000 (memory store unless SUPABASE_URL is set)
npm test           # offline, no Supabase needed
```
Set `ADMIN_PASSWORD` and `SESSION_SECRET` (see `.env.example`) to use `/admin` locally; without them login returns 503
`admin_not_configured`. The server reads real environment variables, so e.g.
`ADMIN_PASSWORD=pw SESSION_SECRET=$(openssl rand -hex 32) npm start`.

### API
All responses are JSON `{ok:true,...}` or `{ok:false,error,code}` with `Cache-Control: no-store`.

| Method and path | Purpose | Notes |
|---|---|---|
| `POST /api/enquiry` | Submit an enquiry | JSON <= 32 KB. 200 `{ref}`, 400, 405, 413, 415, 422 (`errors{}`), 429, 503. Honeypot `website` or `t < 2500` ms returns a fake success and stores nothing |
| `POST /api/admin/login` | Sign in | `{password}`; sets 12 h `vfi_admin` cookie; 401, 429 after 10 failures/15 min, 503 if not configured |
| `POST /api/admin/logout` | Sign out | |
| `GET /api/admin/session` | `{authenticated}` | |
| `GET /api/admin/enquiries` | List | `?status=&q=&page=&pageSize=`; status empty = all but spam, `all`, or one status |
| `PATCH /api/admin/enquiries` | Update | `{id, status?, notes?}` |
| `GET /api/admin/export` | CSV download | same `status`/`q` filters |

POST/PATCH admin requests need the header `X-Requested-With: vfi-admin`.

### Admin and CSV export
Open `/admin`, sign in with `ADMIN_PASSWORD`. "Export" downloads the current filter as UTF-8 CSV (BOM, RFC 4180 quoting;
cells starting with `= + - @` get a leading `'` to defuse spreadsheet formulas). Max 5000 rows.

### Privacy
Raw IP addresses are never stored, logged or returned. Only a salted HMAC (`IP_SALT`) is kept for rate limiting
(5 enquiries per 10 minutes per visitor) and is never exposed by the admin API.

### Troubleshooting
- **503 `unavailable`** on submit or in admin: Supabase unreachable, migration not applied, wrong `SUPABASE_URL`/`SUPABASE_ANON_KEY`,
  or (admin only) `SUPABASE_ADMIN_SECRET` does not match the hash in `private.app_secrets`. Check the function logs.
- **429 `rate_limited`**: more than 5 enquiries in 10 minutes from one visitor, or 10 failed admin logins in 15 minutes. Wait and retry.
- **503 `admin_not_configured`**: `ADMIN_PASSWORD` or `SESSION_SECRET` is not set in the environment.
- **Enquiries vanish on Vercel**: `SUPABASE_URL` is unset, so the ephemeral memory store is in use.

## Review notes before launch
Open any page with `?review` (e.g. `/?review`) and press **Review notes** to highlight every
item marked as needing confirmation (facts, logos, certifications, legal text).

## Deploy
- Any Node host (Render, Railway, a VPS): `npm install && npm start`.
- Vercel: import the folder; `vercel.json` handles clean URLs, security headers and the `api/` functions. See Backend > Setup.
