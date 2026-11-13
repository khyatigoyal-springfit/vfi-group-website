# Task breakdown

Source of truth: `docs/ARCHITECTURE.md` (binding), `docs/PRD.md`. Three engineers; edit only your own files (ARCHITECTURE §2). No git commands. Tasks are ordered; later tasks may depend on earlier ones. The API contract is ARCHITECTURE §5; do not deviate.

Owners: **BE** = Backend (Sonnet), **ADMIN** = Admin UI (Sonnet), **SITE** = Public site (Haiku).

---

## BE: Backend

### BE-1 Migration SQL
- Owner: BE. Files: `supabase/migrations/0001_init.sql`
- Implement §3 exactly: extension, `private` schema, `public.enquiries` (+3 indexes, RLS on, no policies, revoke from anon/authenticated), `private.app_secrets`, `private.assert_admin(text)`, and the four RPCs (`submit_enquiry`, `admin_list_enquiries`, `admin_update_enquiry`, `admin_export_enquiries`). All `security definer`, `set search_path = ''`, fully-qualified names. `revoke execute ... from public` then `grant execute ... to anon` on the 4 public RPCs only (not on `assert_admin`). SQLSTATEs: `22023` invalid_input, `P0429` rate_limited, `P0403` forbidden, `P0404` not_found. Validation mirrors §4. No secrets in the file.
- Acceptance:
  - [ ] File applies cleanly on an empty Postgres/Supabase DB and is re-runnable safe where practical (`if not exists`).
  - [ ] `anon` cannot `select` from `public.enquiries` (documented check in README).
  - [ ] `submit_enquiry` returns `{ref,id}`, ref matches `^VFI-\d{6}-[A-F0-9]{6}$`; 6th submit from same ip_hash within 10 min raises `P0429`.
  - [ ] Admin RPCs raise `P0403` with a wrong/missing secret; `p_limit` clamped 1..100; list result has `rows,total,counts` with all 5 count keys and no `ip_hash`.
  - [ ] Default list (null/'' status) excludes spam; `'all'` includes it; search matches ref, name, company, email, country, message case-insensitively (escape `%`/`_` in `p_q`).
  - [ ] Update with null args leaves fields unchanged and bumps `updated_at`; missing id raises `P0404`; invalid status raises `22023`.

### BE-2 Core lib modules
- Owner: BE. Files: `lib/validate.js`, `lib/http.js`, `lib/session.js`, `lib/mail.js`, `lib/csv.js`, `lib/ratelimit.js` (names fixed so others can read them). Remove or replace the old `lib/enquiry.js` once nothing imports it.
- `validate.js`: `validateEnquiry(body)` returns `{ok, value, errors{field:msg}}` per §4 (trim, control-char strip, whitelists, `type` fallback `Other`, maps body `msg`->`message`, `page`->`source_page`). Messages are user-friendly ("Enter your full name").
- `http.js`: `readJson(req, maxBytes=32768)` (works for Vercel parsed body and raw stream; throws coded errors `bad_json`/`too_large`/`unsupported_media`), `send(res,status,obj)` adding `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `X-Robots-Tag: noindex`; `clientIp(req)` from `x-forwarded-for` first hop; `ipHash(ip)` = HMAC-SHA256 with `IP_SALT` (hex, never store raw IP).
- `session.js`: sign/verify cookie per §5 using `crypto.timingSafeEqual`; `parseCookies`, `setCookie`/`clearCookie` with the §5 attributes; verify rejects expired/tampered/malformed values.
- `ratelimit.js`: in-memory sliding window used for admin login (10 failures/15 min per ip hash).
- `csv.js`: `toCsv(rows)` with BOM, CRLF, RFC 4180 quoting, `'` prefix for cells starting `= + - @` (also tab/CR).
- `mail.js`: `notify(enquiry)` uses nodemailer only if `SMTP_HOST` set; lazy `require`; never throws (catches and logs without PII beyond ref); add `nodemailer` to dependencies.
- Acceptance:
  - [ ] Unit tests (BE-6) cover every rule in §4 including boundary lengths (120/160/200/80/5000) and bad type/volume.
  - [ ] Tampered signature, altered payload, expired `exp`, and garbage cookies all fail verification.
  - [ ] CSV: field with comma, quote, newline round-trips; `=1+1` becomes `'=1+1`.
  - [ ] No module logs a raw IP, password or secret.

### BE-3 Store abstraction
- Owner: BE. Files: `lib/store/index.js` (`createStore()`), `lib/store/supabase.js`, `lib/store/memory.js`
- Implement §6. Supabase: `fetch` to `/rest/v1/rpc/<fn>` with `apikey` + `Authorization: Bearer`, 8 s AbortController timeout, map errors by SQLSTATE/message to `rate_limited|invalid_input|forbidden|not_found|unavailable` (thrown as `Error` with `.code`). Memory: same semantics incl. 5/10 min rate limit, ref format, status filter rules, search, counts, 5000 export cap; persists to `data/enquiries.json` unless `process.env.VERCEL` is set (create dir; atomic write; ignore corrupt file). `data/` added to a `.gitignore` note in README (do not edit other files).
- Acceptance:
  - [ ] Both stores pass the same shared test-suite (BE-6) run against each (supabase store tested with a mocked `fetch`).
  - [ ] Timeout and network error map to `unavailable`.
  - [ ] Store chosen by `SUPABASE_URL` presence; supabase URL/keys never appear in thrown messages.

### BE-4 Function: `api/enquiry.js`
- Owner: BE. Files: `api/enquiry.js` (replaces current behaviour; keep default export `(req,res)` handler).
- Implement §5 `POST /api/enquiry` order: method (405 + `Allow: POST`) -> content-type (415) -> body (400 `bad_json`, 413 `too_large` if >32 KB) -> honeypot/`t<2500` (200 `{ok:true,ref:"VFI-OK"}`, store nothing) -> validate (422 `invalid_input` + `errors`) -> store (429 `rate_limited`, 503 `unavailable`) -> `mail.notify` fire-and-forget (awaited with catch, must not fail request) -> 200 `{ok:true,ref}`. Non-numeric/missing `t` is treated as a bot (< 2500). Error JSON always has `error` (human) and `code`.
- Acceptance:
  - [ ] Each status code in §5 reproducible by a test; `Allow` header present on 405.
  - [ ] Honeypot and `t<2500` responses are indistinguishable from success and nothing is stored.
  - [ ] Unhandled exceptions return 503/500 JSON, never HTML or stack traces.
  - [ ] SMTP failure still returns 200.

### BE-5 Function: `api/admin/[action].js`
- Owner: BE. Files: `api/admin/[action].js`
- Implement every row of the §5 admin table: `login`, `logout`, `session`, `enquiries` (GET list, PATCH update), `export`. `page`/`pageSize` -> offset/limit (pageSize clamp 1..100, page >= 1, invalid -> defaults). Auth check (valid cookie) before any store call (401 `unauthenticated`). Login: constant-time password compare (`timingSafeEqual` over equal-length hashes), 400 ms delay on failure, 429 `rate_limited` after 10 failures/15 min per ip hash, 503 `admin_not_configured` if `ADMIN_PASSWORD` or `SESSION_SECRET` missing. POST/PATCH require `X-Requested-With: vfi-admin` else 403 `csrf`. PATCH validates `status` in the 5 values and `notes` <= 5000 (422 with `errors`); 404 on `not_found`. Export streams CSV with headers per §5 (date in Asia/Kolkata). Unknown action 404 `not_found`; wrong method 405. Store `forbidden` is returned to the client as 503 `unavailable` (it means server misconfiguration) and logged.
- Acceptance:
  - [ ] Every row of the table has a passing test; unauthenticated requests never reach the store.
  - [ ] Cookie has HttpOnly, SameSite=Strict, Path=/, Max-Age=43200, and Secure in production.
  - [ ] Response bodies never include `ip_hash`.
  - [ ] Response to wrong password and unknown user look identical (single-password system).

### BE-6 Tests
- Owner: BE. Files: `tests/*.test.js` (`node --test`), `package.json` (`"test": "node --test tests/"`)
- Cover everything listed in §9, against the memory store, with no network. Use env set in-test (`IP_SALT`, `SESSION_SECRET`, `ADMIN_PASSWORD`), call handlers with lightweight mock req/res or boot the Express app on an ephemeral port.
- Acceptance:
  - [ ] `npm test` passes offline in < 30 s and leaves no `data/enquiries.json` behind (use temp path via env).
  - [ ] Includes: validation, honeypot, timing trap, rate limit (5 ok, 6th 429), 405/415/400/422, login success/failure/lockout/not-configured, tampered/expired session, list/filter/search/pagination, update, export quoting + injection, CSRF header, supabase-store error mapping with mocked fetch.

### BE-7 `server.js`, `vercel.json`
- Owner: BE. Files: `server.js`, `vercel.json`
- `server.js`: Express mounts the SAME handler modules (`app.all('/api/enquiry', ...)`, `app.all('/api/admin/:action', ...)` setting `req.query.action`), serves `public/` statically with `/admin` -> `public/admin/index.html`, serves `404.html` with status 404 for unknown non-asset paths, SPA page paths -> `index.html`, sets the same security headers and CSP as §8 and `X-Robots-Tag: noindex` for `/admin` and `/api`, honours `PORT`, disables `x-powered-by`, no body-parser on api routes that would break `readJson` (or ensure `readJson` handles it).
- `vercel.json`: keep existing rewrites/asset cache; add `/admin` -> `/admin/index.html` rewrite (cleanUrls on), global headers per §8 (HSTS, nosniff, Referrer-Policy, Permissions-Policy, X-Frame-Options, CSP verbatim), `X-Robots-Tag: noindex` for `/admin(.*)` and `/api/(.*)`, `functions` config only if needed (maxDuration 10).
- Acceptance:
  - [ ] `PORT=3111 node server.js` runs with no env set (memory store, admin login returns 503 `admin_not_configured`).
  - [ ] `curl -I` on `/`, `/admin`, `/api/enquiry` shows every header in §8 (CSP string identical to §8) and noindex on the last two.
  - [ ] `vercel.json` is valid JSON; `/about` still serves the SPA; unknown path serves 404.html with 404 status locally.
  - [ ] No more than 2 function files exist under `api/`.

### BE-8 `.env.example` and README
- Owner: BE. Files: `.env.example`, `README.md` (add/replace a "Backend" section only; keep the rest)
- `.env.example`: all variables from §7 with placeholder values and one-line comments (how to generate secrets: `openssl rand -hex 32`); `NEVER commit real values`.
- README Backend section: architecture in 5 lines, setup steps (create Supabase project, run migration, insert admin secret hash with the exact SQL `insert into private.app_secrets(name,hash) values ('admin_api', encode(extensions.digest('<SECRET>','sha256'),'hex')) on conflict (name) do update set hash=excluded.hash;`), Vercel env, local dev (`npm install`, `npm start`, `npm test`), API summary table, admin URL, CSV export, privacy note (no raw IPs), troubleshooting (503 unavailable, 429, admin_not_configured).
- Acceptance:
  - [ ] Every env var read anywhere in code appears in `.env.example` (grep check).
  - [ ] A new developer can run the site and tests locally following only the README.

---

## ADMIN: Admin dashboard

All three files must work under the CSP in ARCHITECTURE §8: no inline `<script>`, no inline event-handler attributes, no `javascript:` URLs. Inline `style=` attributes are allowed but avoid them. Render all data with `textContent`/DOM APIs (never `innerHTML` with data). Consume exactly the §5 contract; always send `credentials:'same-origin'` and, on POST/PATCH, `X-Requested-With: vfi-admin`.

Design: match the public site (`public/css/style.css`): font `"Hanken Grotesk"` via the same Google Fonts link (weights 200-600), tokens copied into `:root` of `admin.css`: `--black:#111315; --black-2:#1B1E21; --marine:#153B59; --butter:#DCCB91; --ivory:#F4F1E9; --paper:#FAF8F3; --ink:#111315; --ink-2:#5A5F66; --line:rgba(17,19,21,.12)`; light by default with the same dark-mode overrides (`prefers-color-scheme` + `[data-theme]`), `:focus-visible{outline:2px solid var(--butter)}`, thin rule lines and square-ish 3 px radii, light font weights for headings.

### ADMIN-1 Page shell, login, session
- Owner: ADMIN. Files: `public/admin/index.html`, `public/admin/admin.css`, `public/admin/admin.js`
- `index.html`: `<meta name="robots" content="noindex,nofollow">`, viewport, title "VFI Admin", fonts link, `<link rel="stylesheet" href="/admin/admin.css">`, `<script src="/admin/admin.js" defer>`; landmarks (`header`, `main`), skip link, `<noscript>` message. Containers: `#loginView`, `#appView` (hidden attribute toggled), `#toast` (aria-live=polite).
- `admin.js`: single IIFE, small `api(method,path,body)` wrapper that parses JSON, maps non-OK to `{status,code,error}`, and on 401 `unauthenticated` calls `showLogin('Your session expired. Please sign in again.')`. Boot: `GET /api/admin/session`. Login form: labelled password field, submit disabled while sending, errors: 401 "Incorrect password", 429 "Too many attempts. Try again in 15 minutes.", 503 `admin_not_configured` "Admin is not configured on this server.", network "Could not reach the server."; focus returns to the password field on error. Logout button -> `POST /api/admin/logout` -> login view.
- Acceptance:
  - [ ] Wrong password shows the message and does not reveal the dashboard; correct password shows the dashboard without page reload.
  - [ ] Reload while logged in goes straight to dashboard; after logout, reload shows login.
  - [ ] Browser console shows zero CSP violations.
  - [ ] Login works with keyboard only (Enter submits).

### ADMIN-2 List, tabs, search, pagination, URL state
- Owner: ADMIN. Files: same three.
- Tabs (role=tablist, arrow-key navigation, `aria-selected`): Active (status param empty), New, In progress, Contacted, Closed, Spam, All (`all`), each with a count badge from `counts` (Active = new+in_progress+contacted+closed; All = Active+spam). Debounced (300 ms) search input with label and clear button. Rows per §4b (list on desktop as table with real `<th scope>`, cards on <= 640 px). Pagination 25/page with Prev/Next disabled at ends and "Showing a-b of N". URL `?status=&q=&page=` read on load and updated with `history.replaceState`/`pushState`. Out-of-order response protection (ignore stale responses). States: loading (`aria-busy`, skeleton), empty (with "Clear filters"), error (message + Retry).
- Acceptance:
  - [ ] Switching tabs/searching/paging issues exactly one request each and resets page to 1 where appropriate.
  - [ ] Typing fast never shows results of an older query.
  - [ ] Refresh preserves tab, query and page; Back button works.
  - [ ] Counts update after a status change without a manual reload.
  - [ ] At 360 px width there is no horizontal page scroll and tap targets >= 44 px.

### ADMIN-3 Detail view, status, notes
- Owner: ADMIN. Files: same three.
- Clicking/Enter on a row opens detail (right-hand panel >= 900 px; full-screen view below). Shows every field in §4b, message in a `white-space:pre-wrap` block, email as `mailto:` link, source page as text. Status `<select>` + notes `<textarea maxlength=5000>` with counter + Save button -> `PATCH /api/admin/enquiries {id,status,notes}`; send only changed fields. Disable Save while saving; show "Saved" toast; on 404 show "This enquiry no longer exists" and refresh list; on 422 show field errors; on 401 handled by wrapper keeping the note text in memory and restoring it into the same open detail after re-login. Warn (confirm dialog) when closing with unsaved edits. Esc closes; focus returns to the originating row; focus trapped in full-screen mobile view.
- Acceptance:
  - [ ] Changing status new -> in_progress -> contacted -> closed persists after reload and moves the row between tabs/counts.
  - [ ] Setting spam removes it from the Active tab and increments Spam count.
  - [ ] A message containing `<img src=x onerror=alert(1)>` renders as literal text.
  - [ ] Notes with line breaks and 5000 chars save and reload intact.

### ADMIN-4 CSV export, polish, a11y
- Owner: ADMIN. Files: same three.
- Export button: fetch `/api/admin/export?status=&q=` with current filters, create a Blob and download via a temporary `<a download>` (filename from `Content-Disposition`, fallback `vfi-enquiries.csv`); show progress state and error toast on failure/401. Visible relative+absolute timestamps (`<time datetime>`), status badges with text label (not colour only), `prefers-reduced-motion` respected, `prefers-color-scheme` dark mode working, `color-scheme` set, contrast >= 4.5:1, header shows "VFI Admin" with logo text only (no external images required).
- Acceptance:
  - [ ] Exported file opens in Excel with correct accents (BOM) and contains exactly the filtered rows.
  - [ ] Lighthouse accessibility >= 95 on login and dashboard.
  - [ ] Whole flow (login, search, open, change status, note, export, logout) is completable by keyboard alone.
  - [ ] No console errors at 360 px and 1280 px, light and dark.

---

## SITE: Public site (small, explicit, mechanical)

All edits are in `public/`. Do not change visual design. Work in the order given. After editing `public/index.html`, ALWAYS copy it over `public/404.html` (SITE-5).

### SITE-1 Send the timing field `t`
- Owner: SITE. Files: `public/js/app.js` (function `buildForm(host,key)`)
- Steps: (1) near the top of `buildForm`, after `const w=host.lastElementChild,...` add `let renderedAt=Date.now();` (2) inside the submit handler, where `const d={type,website:hp.value,page:location.pathname};` is built, add `t:Date.now()-renderedAt` to `d`. (3) In the `[data-reset]` click handler and after a successful send, set `renderedAt=Date.now();`. Also set `renderedAt=Date.now()` in `openDrawer()` for `dF` by exposing `resetClock` in the object returned by `buildForm` (`return{setType,setMsg,resetClock:()=>{renderedAt=Date.now()},w}`) and calling `dF.resetClock()` at the start of `openDrawer`.
- Acceptance:
  - [ ] Request payload (DevTools Network) contains numeric `t`.
  - [ ] Submitting within 2.5 s of opening the drawer still shows normal success (server fakes success) and a real submission after 3+ seconds is stored.

### SITE-2 Handle all API errors in `buildForm()`
- Owner: SITE. Files: `public/js/app.js` (the `fetch('/api/enquiry'...)` chain inside `buildForm`)
- Replace the existing `.then/.catch` with explicit handling. Keep a small helper `const showErr=(name,msg)=>{...}` that finds `$('[name='+name+']',form)`, adds class `bad` to its `.fl`, sets `.err` text, sets `aria-invalid=true`. Parse `r.json().catch(()=>({}))`. Map:
  - `200 && j.ok`: existing success path (show `j.ref`).
  - `422 invalid_input`: for each `[field,msg]` in `j.errors` map keys `{name:'name',company:'company',email:'email',country:'country',volume:'volume',message:'msg',msg:'msg',type:null,page:null}` to the input name and call `showErr`; focus first erroring input; if a key has no input, put it in the status line. Status line: "Please correct the highlighted fields."
  - `429 rate_limited`: status line "Too many enquiries from your connection. Please wait about 10 minutes and try again, or email care@vfigroup.org."
  - `405`, `415`, `400 bad_json`, `413`, `503 unavailable`, other 5xx, non-JSON, or `fetch` rejection (offline): status line "We could not send your enquiry right now. Your message is saved on this device. Please try again, or email care@vfigroup.org." Do not display `j.error` raw for these.
  - Status line is `role=status` already; for errors also add `stat.setAttribute('role','alert')` and restore `'status'` before the next submit.
  - Draft must remain (do not call `store.set(key,'')`/`form.reset()` except on success).
  - The mailto text "care@vfigroup.org" must be a real `<a href="mailto:care@vfigroup.org">` created with `document.createElement('a')` and `textContent` (no innerHTML with server data).
- Acceptance:
  - [ ] With the API stubbed to return each of 400/405/413/415/422/429/503/500 and with network offline, the form shows the message above, keeps the typed text, and the button re-enables.
  - [ ] 422 with `errors:{email:'x',message:'y'}` shows messages under Work email and "How can we help?" and focuses Work email.
  - [ ] Starting to type in a field clears only its own error (existing behaviour kept).

### SITE-3 No double submit; success panel shows ref
- Owner: SITE. Files: `public/js/app.js` (`buildForm`), `public/index.html` (`<template id="formTpl">` only if needed)
- Steps: add `let busy=false;` in `buildForm`; at the start of the submit handler `if(busy)return;` after validation set `busy=true`; in `.finally` set `busy=false`. Keep `sb.disabled=true` while sending. On success: set `[data-sent-ref]` text to `j.ref`, and if `j.ref==='VFI-OK'` still show it (that is the honeypot reply, acceptable). Add `tabindex="-1"` to the `.done` container in the template and call `$('.done',w).focus()` after adding class `sent`. Ensure the ref is selectable (`user-select:text` already default; do not change).
- Acceptance:
  - [ ] Double-clicking or pressing Enter twice rapidly sends exactly one request (check Network).
  - [ ] Success panel shows the email and the reference (e.g. `VFI-261113-A1B2C3`); screen reader announces it (aria-live exists) and focus lands on the panel.
  - [ ] "Write another enquiry" returns to an empty form with working submit.

### SITE-4 CSP compliance sweep
- Owner: SITE. Files: `public/index.html`, `public/js/app.js`, `public/css/style.css`
- Check and fix: no inline `<script>` other than `type="application/ld+json"` (already the case); no attributes `onclick=`, `onerror=`, `onload=`, `onchange=`, etc. in index.html or in HTML strings built in app.js (assigning `el.onclick=` in JS is allowed and fine); no `javascript:` URLs; no external scripts/styles/fonts besides `fonts.googleapis.com`/`fonts.gstatic.com`; images only from `self` or `data:` (check `<img src>` and CSS `url()` for external hosts and replace with local assets if any, or report to PM if not possible); no `eval`/`new Function`/string `setTimeout`. Run these greps and record the result in your report: `grep -nE ' on[a-z]+="' public/index.html`, same on `public/js/app.js`, `grep -n "javascript:" -r public`, `grep -nE "https?://" public/index.html public/css/style.css public/js/app.js`.
- Acceptance:
  - [ ] Loading `/`, `/products`, `/contact` and opening the drawer + configurator produce zero CSP violations in the console when served by `node server.js` (BE-7 headers).
  - [ ] Grep commands above return no violations (ld+json and allowed hosts excepted).

### SITE-5 `404.html` exact copy
- Owner: SITE. Files: `public/404.html`
- After every change to `public/index.html`, run `cp public/index.html public/404.html`.
- Acceptance:
  - [ ] `cmp public/index.html public/404.html` prints nothing.

### SITE-6 robots.txt and sitemap
- Owner: SITE. Files: `public/robots.txt`, `public/sitemap.xml`
- `robots.txt` becomes exactly:
  ```
  User-agent: *
  Allow: /
  Disallow: /admin
  Disallow: /api/
  Sitemap: https://www.vfigroup.org/sitemap.xml
  ```
  Confirm `sitemap.xml` contains no `/admin` or `/api` URLs (remove if present).
- Acceptance:
  - [ ] `curl /robots.txt` shows both Disallow lines; `grep -c admin public/sitemap.xml` is 0.

### SITE-7 Form accessibility touch-ups (in `buildForm`)
- Owner: SITE. Files: `public/js/app.js`
- Mark required inputs (`required`) with `aria-required="true"` (add inside the existing `$$('.fl',form).forEach` loop where `aria-describedby` is set). Give each `.err` element `role="alert"` is NOT allowed (too noisy); instead keep them referenced by `aria-describedby` only. Add visible " (required)" is out of scope. Set `autocomplete` already present; do not change.
- Acceptance:
  - [ ] Name, company, email, message inputs have `aria-required="true"` in the DOM; axe reports no form-label errors on `/contact`.

---

## Integration & review checklist (reviewers)

1. `npm install && npm test` passes offline; no stray `data/enquiries.json` committed.
2. `PORT=<n> node server.js`: `curl` each status code from §5 (400, 405+Allow, 415, 422 with `errors`, 429 after 5 posts, 200 with `ref`); honeypot and `t<2500` return `VFI-OK` and store nothing.
3. Headers: `curl -I` on `/`, `/admin`, `/api/enquiry` match §8 exactly (CSP string verbatim; noindex on admin/api). `vercel.json` valid and equivalent.
4. Playwright at 360 px and 1280 px: submit from drawer and inline form (success with ref, each error path via route stubbing, no double submit, draft kept on failure); zero CSP/console errors on `/`, `/contact`, `/admin`.
5. Admin end-to-end: not-configured 503, wrong password, lockout, login, tabs+counts, search, pagination, detail, status flow, spam, notes, CSV export (BOM, quoting, `'=` guard), session expiry (delete cookie then act), logout; keyboard-only pass; XSS payload renders as text.
6. Data/privacy: no raw IP anywhere (DB, logs, responses); `ip_hash` never returned by admin API; no secrets in repo; `.env.example` complete.
7. Supabase: `anon` cannot read/write tables directly; admin RPCs reject wrong secret; migration idempotent and contains no secret.
8. Ownership: each engineer touched only their files; `cmp public/index.html public/404.html` clean; `robots.txt` has both Disallow lines.
9. PRD coverage: every state in PRD §4a/§4b demonstrably works; success metrics smoke-checked.
