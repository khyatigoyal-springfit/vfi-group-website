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
api/content.js       GET /api/content: published site content (CDN cached), ?draft=1 for the preview
api/admin/[action].js  Admin API: login, session, users, enquiries, content, publish, history, media, audit
lib/                 http, validate, csv, mail, media, auth/ (passwords, sessions, roles), content/ (validation,
                     defaults, diff), db/ (pool, migrations, Postgres store), store/ (selection + memory store)
db/migrations/       SQL schema, applied automatically on first use
tests/               node:test suite (npm test)
public/admin/        Admin panel (static)
public/content/      default.json: the bundled site content (seed and fallback)
public/index.html    All page markup (pages are <div class="view" data-view="…">)
public/css/style.css Styles
public/js/app.js     Router, configurator, sliders, forms + all editable content
public/assets/img/   Images and logos
```

## Pages
/ · /about · /manufacturing · /innovation · /products · /brands · /partnerships ·
/sustainability · /careers · /contact · /privacy · /terms · /code-of-conduct (unknown URLs show a 404 page)

## Editing content
Site content is served from `/api/content` and edited in the admin panel (`/admin`, Content area): edit a draft,
preview it at `/?preview=1`, publish it, and roll back from History if needed. The bundled defaults live in
`public/content/default.json` (first-run seed, and the fallback if the database is unreachable); the editor form is
described by `public/admin/content-schema.json`.

Content sources: company facts, timeline, brands, technologies, CSR policy and code of conduct were taken from
www.vfigroup.org (home, /innovation, /vfi-corporate-profile, /vfi-group-code-of-conduct). Images in
`assets/img/caps`, `tech`, `story`, `brands`, `partners`, `awards` and `certs` come from the same site, optimised.

## Backend

**Architecture.** The site is static (`public/`) plus three Vercel Node functions: `api/enquiry.js`, `api/content.js` and
`api/admin/[action].js` (the Hobby plan allows 12; we keep at most 4). Data lives in **Neon Postgres** (via the `pg`
driver, `DATABASE_URL`, server-side only) and uploaded images in **Vercel Blob**. Without `DATABASE_URL` the same handlers use a
local in-memory store (development and tests only). On Vercel or with `NODE_ENV=production` a missing `DATABASE_URL`
fails closed: enquiry and admin answer 503 `unavailable`, while `/api/content` serves the bundled defaults
(header `X-Content-Source: defaults`) so the public site never goes blank.

**Self-migrating.** On first use each server instance takes a Postgres advisory lock, creates `schema_migrations`,
applies any pending `db/migrations/NNN_*.sql` in order, then (when the tables are empty) creates the bootstrap admin and
seeds the content from `public/content/default.json` as the draft and revision #1. There is no manual migration step;
running it twice or from several instances at once is safe.

### Setup (from scratch)
1. **Vercel project.** Import the repository. Framework preset "Other"; `vercel.json` handles the rest.
2. **Database.** Vercel dashboard > Storage > Create > **Neon** (free plan). Connect it to the project for Production and
   Preview. This sets `DATABASE_URL` for you.
   Functions are pinned to `sin1` in `vercel.json`: keep that equal to the Neon region. Neon scales to zero when idle, so the first
   queries after a pause may fail while it wakes; the DB layer retries connection-level failures (300/1000/2000 ms).
3. **Blob store.** Vercel dashboard > Storage > Create > **Blob**. Connect it to the project. This sets `BLOB_READ_WRITE_TOKEN`.
4. **Other variables** (Settings > Environment Variables, Production and Preview), see `.env.example`:
   - `SESSION_SECRET`: `openssl rand -hex 32` (at least 32 characters, otherwise admin returns 503 `admin_not_configured`)
   - `IP_SALT`: `openssl rand -hex 32` (**required in production**, at least 16 characters: without it the enquiry form and admin
     answer 503 `not_configured`. There is no fallback to `SESSION_SECRET`.)
   - `BLOB_PUBLIC_HOST` (optional): your Blob store's own host, e.g. `abc123xyz.public.blob.vercel-storage.com`. When set, image
     fields only accept uploaded images from exactly that host; when unset, any `*.public.blob.vercel-storage.com` host is accepted.
   - `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` (at least 12 characters): the first administrator
   - optional `SMTP_*`, `ENQUIRY_TO`, `ENQUIRY_FROM` for enquiry notification email
5. **Deploy.** The first request creates the tables, the first admin and the initial content automatically.
6. **First login.** Open `/admin`, sign in with the bootstrap email and password. You are asked to choose a new password
   (12 characters or more) before anything else. Then delete `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` from the
   Vercel variables (they are only used while the users table is empty; **leaving them set keeps a known initial password in your
   environment, so delete them right after the first login**), create editor and sales users under **Users**, and
   check the public site.
7. **Verify.** Edit one text in Content, Save draft, Preview, Publish, then roll it back in History.

### Roles
| | admin | editor | sales |
|---|---|---|---|
| View, update and export enquiries | yes | yes | yes |
| Edit draft content, upload media, preview, publish, roll back | yes | yes | no |
| Manage users, read the audit log | yes | no | no |
| Change own name and password | yes | yes | yes |

At least one active admin always remains (the last one cannot be demoted or deactivated). Deactivating a user, resetting
their password or changing their password ends their sessions immediately. **Logging out also revokes the session server side**
(the user's `session_version` is bumped, so a copied cookie stops working; this signs that user out of all their browsers).
Login is rate limited per 15 minutes: 10 failed attempts per visitor (IP), 5 per email from the same visitor, and a loose backstop of
50 per email overall, after which login returns 429. The attempt is recorded atomically before the password is checked, so
parallel guesses cannot slip past the limit.

### Local development
```
npm install
npm start          # http://localhost:3000 (in-memory store unless DATABASE_URL is set)
npm test           # offline: memory store and a fake Blob uploader; no database or network needed
```
To use `/admin` locally set `SESSION_SECRET` (32+ characters) and a bootstrap admin, e.g.
```
SESSION_SECRET=$(openssl rand -hex 32) BOOTSTRAP_ADMIN_EMAIL=me@example.com BOOTSTRAP_ADMIN_PASSWORD='a long local password' npm start
```
The memory store forgets users and content edits on restart (the bootstrap admin is recreated each time). Image uploads need a real
`BLOB_READ_WRITE_TOKEN`; without one the Media library answers 503 `media_not_configured` and everything else works.

**Postgres integration tests** run only when `TEST_DATABASE_URL` points at a throwaway database (its `public` schema is dropped
and recreated for each test):
```
TEST_DATABASE_URL=postgres://postgres@127.0.0.1:5432/vfi_test npm test
```
The same store test suite then runs against both the memory store and Postgres.

### API
Admin responses are JSON `{ok:true,...}` or `{ok:false,error,code}` with `Cache-Control: no-store`.
All non-GET admin requests need the header `X-Requested-With: vfi-admin`. Write actions are recorded in the audit log.

| Method and path | Role | Purpose |
|---|---|---|
| `POST /api/enquiry` | public | Submit an enquiry. JSON <= 32 KB. 200 `{ref}`, 400, 405, 413, 415, 422 (`errors{}`), 429, 503. Honeypot `website` or `t < 2500` ms returns a fake success and stores nothing |
| `GET /api/content` | public | Published content JSON. `s-maxage=60, stale-while-revalidate=300`, `ETag` (304 on match) |
| `GET /api/content?draft=1` | editor, admin | Draft content for the preview, `no-store` |
| `POST /api/admin/login` | none | `{email,password}` -> `{user}` and a 12 h `vfi_admin` cookie. 401, 429, 503 |
| `POST /api/admin/logout`, `GET /api/admin/session` | any | Sign out; `{authenticated, user?}` |
| `POST /api/admin/password` | any | `{current,next}`: change own password (re-issues the cookie, ends other sessions) |
| `PATCH /api/admin/account` | any | `{name}`: change own name |
| `GET/PATCH /api/admin/enquiries`, `GET /api/admin/export` | any | List (`?status=&q=&page=&pageSize=`), update `{id,status?,notes?}`, CSV export |
| `GET/PUT /api/admin/content` | editor, admin | Read the draft; save `{draft, base_updated_at}` (409 `conflict` if someone saved since) |
| `POST /api/admin/publish` | editor, admin | `{note?}`: publish the draft as a new revision |
| `GET /api/admin/revisions`, `GET /api/admin/revision?id=` | editor, admin | History list; one revision with the sections that differ from live |
| `POST /api/admin/rollback` | editor, admin | `{id}`: restore revision `id` as the draft and publish it as a new revision |
| `POST /api/admin/discard` | editor, admin | Reset the draft to the published revision |
| `GET/POST/PATCH/DELETE /api/admin/media` | editor, admin | List; upload a raw PNG/JPEG/WebP body (<= 4 MB, header `X-Filename`, optional `X-Alt`); set alt `{id,alt}`; delete `?id=` (409 `in_use` while referenced by draft or published content) |
| `GET/POST/PATCH /api/admin/users` | admin | List; create `{email,name,role,password}`; update `{id,role?,active?,name?,resetPassword?}` (409 `last_admin`) |
| `GET /api/admin/audit` | admin | Audit log, paged |

Content is validated on every save against `public/admin/content-schema.json` (512 KB cap, unknown keys rejected, `https://`,
`/`, `mailto:` or `tel:` links only, images must be `/assets/` files or uploaded Blob images). Images: PNG, JPEG and WebP only
(checked by magic bytes; SVG is refused).

### Admin and CSV export
Open `/admin` and sign in with your email and password. "Export" downloads the current filter as UTF-8 CSV (BOM, RFC 4180
quoting; cells starting with `= + - @` get a leading `'` to defuse spreadsheet formulas). Max 2000 rows (newest first).

### Client IP and `TRUST_PROXY`
Rate limiting keys on a salted hash of the client IP (IPv6 reduced to its /64, IPv4-mapped addresses treated as IPv4).
On Vercel the IP comes from `x-vercel-forwarded-for`, then `x-real-ip`, then the first `x-forwarded-for` hop. Anywhere else
(`server.js`, local) the socket address is used and `X-Forwarded-For` is **ignored** unless `TRUST_PROXY=1`. Set it only
behind a reverse proxy you control that overwrites that header, otherwise clients can spoof it to dodge the rate limit.

### Operational limits
Email notification waits at most 3 s (SMTP timeouts are 3 s too); a slow or failing mail server never fails or delays the
request beyond that. Vercel `maxDuration` is 15 s. Routing is case-sensitive: `/ABOUT` is a 404.

### Privacy
Raw IP addresses are never stored, logged or returned. Only a salted HMAC (`IP_SALT`) is kept for rate limiting
(5 enquiries per 10 minutes per visitor) and is never exposed by the admin API. On Vercel the client address is taken from
`x-vercel-forwarded-for`, then `x-real-ip` (never from `x-forwarded-for`, which a client can set).

### Content rules and retention
- Field types in the content schema: `text`, `textarea`, `url`, `image`, `email` (one plain address: no `? & , ; :` or spaces),
  `tel` (digits, spaces, `+ ( ) -`, 6 to 24 characters), `number`, `select`, `stringList`, `object`, `list`.
- Images are either `/assets/...` (letters, digits, `. _ - /`) or an uploaded Blob image (`https://<store>.public.blob.vercel-storage.com/<path>`
  with no query string or fragment; with `BLOB_PUBLIC_HOST` set, only that host).
- The keys `__proto__`, `constructor` and `prototype` are rejected anywhere in content ("Not allowed").
- Publishing needs a changed draft (`nothing_to_publish` otherwise). Only the newest 200 revisions are kept (the published one is
  never deleted); audit entries older than 365 days and login attempts older than 30 days are removed automatically.


### Troubleshooting
- **503 `unavailable`** on submit or in admin: the database is unreachable or `DATABASE_URL` is missing/wrong. The public site keeps
  working from the bundled defaults. Check the function logs (only error codes are logged, never credentials).
- **429 `rate_limited`**: more than 5 enquiries in 10 minutes from one visitor, or too many failed admin logins (10 per visitor, 5 per email per visitor, 50 per email overall, in 15 minutes). Wait and retry.
- **503 `admin_not_configured`**: `SESSION_SECRET` is missing or shorter than 32 characters.
- **503 `not_configured`**: in production `IP_SALT` is missing or shorter than 16 characters (enquiry form and admin are disabled; the reason is in the function log).
- **409 `nothing_to_publish`**: the draft is identical to the published revision.
- **409 `conflict`** on publish: the draft was saved by someone else after you opened it (the Publish request carries `base_updated_at`).
- **409 `missing_media`** on rollback: that revision uses uploaded images that are no longer in the media library.
- **409 `in_use`** on deleting an image: it is used by the draft, the published content or an older revision (`used_in` entries have `where` of `draft`, `published` or `revision`, the last with the revision `id`).
- **503 `media_not_configured`**: no Blob store connected (`BLOB_READ_WRITE_TOKEN`).
- **Cannot log in on a fresh deploy**: the bootstrap admin is created only when the users table is empty and both
  `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD` were set at the first request. Add them, then clear the `users` table or
  ask an existing admin to reset your password.
- **A published change is not visible yet**: the public content is cached for up to 60 seconds (plus up to 30 seconds of stale revalidation).

## Review notes before launch
Open any page with `?review` (e.g. `/?review`) and press **Review notes** to highlight every
item marked as needing confirmation (facts, logos, certifications, legal text).

## Deploy
- Any Node host (Render, Railway, a VPS): `npm install && npm start`.
- Vercel: import the folder; `vercel.json` handles clean URLs, security headers and the `api/` functions. See Backend > Setup.
