# CMS task breakdown

Binding design: `docs/CMS-ARCHITECTURE.md`. Requirements: `docs/CMS-PRD.md`. Do not change technical decisions; raise questions with the PM. Edit only files you own (no overlap). No git commands. Section numbers (§) refer to CMS-ARCHITECTURE.

Owners: **BE** Backend (Sonnet), **SITE** Public site (Sonnet), **ADMIN** Admin UI (Sonnet), **DOCS** Documentation (Haiku).

Order: BE and SITE start in parallel. ADMIN starts when SITE-1 and SITE-2 (`default.json`, `content-schema.json`) are delivered and may use BE API stubs per §6 meanwhile. DOCS starts after ADMIN is done. Shared contracts: `public/content/default.json`, `public/admin/content-schema.json` (owned by SITE; changes need PM approval and notice to BE and ADMIN).

---

## BE: Backend

### BE-1 Migration and DB layer
- Owner BE. Files: `db/migrations/001_init.sql`, `lib/db/pool.js`, `lib/db/migrate.js`, `lib/db/store.js`
- Implement §1 and §2: `pg` pool (max 3, SSL rule), advisory-lock self-migration, bootstrap admin, seed content from `public/content/default.json` (draft + revision #1). Store exposes users, login_attempts, enquiries, content (draft/published/revisions), media, audit. Parameterised SQL only.
- Acceptance:
  - [ ] Migration applies to an empty Postgres and is safe to run twice; two concurrent instances do not double-apply.
  - [ ] Bootstrap admin created only when `users` is empty and both env vars set; password never logged; `must_change_password` true.
  - [ ] Seed inserts exactly one `content_state` row, revision 1 equals `default.json`.
  - [ ] Integration test against local Postgres runs when `TEST_DATABASE_URL` is set, skipped otherwise.
  - [ ] No string-concatenated SQL anywhere (grep check).

### BE-2 Memory store
- Owner BE. Files: `lib/store/index.js`, `lib/store/memory.js` (remove `lib/store/supabase.js`)
- `createStore()` returns the Postgres store when `DATABASE_URL` is set, memory otherwise; fail closed (503) in production without it. Memory store implements the same interface for users, content, revisions, media, audit, login attempts, enquiries.
- Acceptance:
  - [ ] One shared store test-suite runs against memory (and Postgres when `TEST_DATABASE_URL` set) with identical results.
  - [ ] Production without `DATABASE_URL`: enquiry and admin 503 `unavailable`; `/api/content` returns defaults with `X-Content-Source: defaults`.

### BE-3 Auth
- Owner BE. Files: `lib/auth/password.js`, `lib/auth/session.js`, `lib/auth/ratelimit.js`, `lib/auth/guard.js` (role check helper). Existing `lib/session.js`, `lib/ratelimit.js` may be re-exported or removed.
- Implement §4: scrypt hash/verify (constant time), cookie sign/verify, per-request user reload (active, session_version), DB login rate limit (10/IP/15 min, 5/email/15 min), `must_change_password` gating, 12-char password policy, temporary password generator (crypto random).
- Acceptance:
  - [ ] Tampered, expired, malformed cookies rejected; deactivated user and bumped `session_version` rejected on the next request.
  - [ ] 11th failed login from one IP and 6th for one email return 429; success does not reset another key's counter.
  - [ ] Login timing and message identical for unknown email and wrong password.
  - [ ] `SESSION_SECRET` < 32 chars: admin returns 503 `admin_not_configured`.
  - [ ] Password < 12 chars rejected with field error.

### BE-4 Content validation and defaults loading
- Owner BE. Files: `lib/content/validate.js`, `lib/content/defaults.js`, `lib/content/diff.js`
- `validate(content, schema)` per §5: size cap 512 KB, walks `content-schema.json`, trims and caps strings, URL rules (`https://`, `/`, `mailto:`, `tel:`), image rules (`/assets/` or Blob host), rejects unknown keys, required fields, returns `{ok, value, errors:{ "brands[3].url": msg }}`. `defaults.js` loads `default.json` and the schema (works on Vercel with `includeFiles`). `diff.js` returns list of changed top-level section keys between two contents.
- Acceptance:
  - [ ] `default.json` validates clean against the schema.
  - [ ] Rejected: `javascript:` and `data:` URLs, `http://`, image URL on another host, unknown key, over-length string, 513 KB payload, wrong types.
  - [ ] Error paths use `section[index].field` format and match schema keys.
  - [ ] Unit tests for each rule with boundary lengths.

### BE-5 Media
- Owner BE. Files: `lib/media.js`
- `@vercel/blob` `put`/`del` behind an injectable uploader. Accept PNG/JPEG/WebP only, check magic bytes not just header, <= 4 MB, safe filename (`media/<uuid>-<slug>`), read width/height when cheap, reject SVG. Delete refuses (409) when URL used in draft or published content.
- Acceptance:
  - [ ] Fake uploader used in tests; no network in `npm test`.
  - [ ] Renamed `.exe`/HTML with image header or SVG rejected; 4 MB + 1 byte rejected; path traversal in `X-Filename` neutralised.
  - [ ] Missing `BLOB_READ_WRITE_TOKEN` returns 503 `media_not_configured`, rest of admin unaffected.

### BE-6 Content API and admin actions
- Owner BE. Files: `api/content.js`, `api/admin/[action].js`, `lib/http.js` (extend only)
- Implement every action in §6 with role checks from §3, CSRF header on non-GET, audit log entry on each write (login ok/fail, save, publish, rollback, discard, media, user changes, enquiry update/export), 409 `conflict` on stale `base_updated_at` (response includes current `updated_at` and updater name), last-admin protection, `must_change_password` gating, ETag and `Cache-Control` per §6 on `/api/content`, `?draft=1` requires editor/admin, never returns `password_hash`.
- Acceptance:
  - [ ] Role matrix test: for every action x role (none, sales, editor, admin) assert exact allowed/denied (401 vs 403).
  - [ ] Save with stale `base_updated_at` returns 409 and changes nothing.
  - [ ] Publish creates revision N+1 and `/api/content` serves it; rollback to #K creates a new revision equal to K and sets draft; discard resets draft.
  - [ ] Demoting or deactivating the only active admin returns 409 `last_admin`; with two admins it works.
  - [ ] Reset password returns the temporary password once, sets `must_change_password`, invalidates the target's sessions.
  - [ ] `/api/content` sends `s-maxage=60, stale-while-revalidate=300` and a valid ETag (304 on match); `?draft=1` is `no-store`.
  - [ ] Error bodies never include stack traces, SQL, or secrets.

### BE-7 Enquiry endpoint and server
- Owner BE. Files: `api/enquiry.js`, `server.js`
- Switch `api/enquiry.js` to the new store (HTTP contract unchanged). `server.js` serves static files plus `/api/content`, `/api/admin/*`, `/api/enquiry` locally with the memory store, mapping `[action]` routes.
- Acceptance:
  - [ ] All existing enquiry and admin-enquiry tests pass (updated for named users only where login changed).
  - [ ] `node server.js` runs with no env vars; a dev bootstrap admin can be set via env and logged in.

### BE-8 Config, cleanup, docs, tests
- Owner BE. Files: `package.json`, `vercel.json`, `.env.example`, `README.md`, `tests/**`; delete `supabase/` and `lib/store/supabase.js`
- Add `pg`, `@vercel/blob`; CSP `img-src` adds `https://*.public.blob.vercel-storage.com`; `functions` `includeFiles` for `public/content/default.json`, `public/admin/content-schema.json`, `db/migrations/**`; keep <= 4 functions; no new cache rules that break `/admin` no-store. `.env.example` per §9 (no `ADMIN_PASSWORD`, no `SUPABASE_*`). README: Neon setup, Blob store, env vars, first login, local dev, tests.
- Acceptance:
  - [ ] `npm test` passes offline; no references to Supabase or `ADMIN_PASSWORD` remain (`grep -ri`).
  - [ ] `vercel.json` headers still contain the existing security headers; CSP only widened for the Blob host.
  - [ ] README steps reproduce a working deployment from scratch.

---

## SITE: Public site

**Hard rule for all SITE tasks: zero visual and behavioural change for visitors.** With default content the site must look and act exactly as it does today. Before touching anything, capture baseline screenshots (SITE-0); after every task re-capture and compare.

### SITE-0 Baseline capture
- Owner SITE. Files: none in repo (store images under the scratchpad, not committed).
- Using Playwright against the current `server.js`, screenshot every route (`home, about, manufacturing, innovation, products, brands, partnerships, sustainability, careers, contact, privacy, terms, code-of-conduct, 404`) at 1440x900 and 390x844 (full page), after fonts and images load; also record HTML text of `main` per route and the document `title`/meta description per route.
- Acceptance:
  - [ ] 28 baseline screenshots plus text/meta dumps exist and are reproducible by a script.

### SITE-1 default.json
- Owner SITE. Files: `public/content/default.json`
- Extract ALL current content verbatim from `public/js/app.js` (CAPS, PORTFOLIO, PLOGOS, CERTS, TECH, APPS, PRODCATS, BRANDS, ROUTES, RETAIL, HOTELS, MARKETS, AWARDS, WHATWEDO, FOAM, PRESENCE, GLANCE, JOURNEY, PROC, SUS, VALS, ROLES, CONDUCT, SITE, DESC/PAGES/TITLES SEO text, hero slides, scale figures) into the §5 top-level keys, plus `texts` for every heading, intro and paragraph that gets a `data-cms` attribute in SITE-4. Do not edit wording, order or punctuation; do not "fix" typos.
- Acceptance:
  - [ ] Valid JSON, < 512 KB, only the §5 top-level keys.
  - [ ] A script rebuilds each old array from `default.json` and deep-equals the original array from `app.js` (every array, every item).
  - [ ] Every image path in the file exists under `public/assets/` (script check).
  - [ ] Every `texts` key matches exactly one `data-cms` attribute in `index.html` and its value equals the current element text (script check).

### SITE-2 content-schema.json
- Owner SITE. Files: `public/admin/content-schema.json`
- Describe every key and nested field in `default.json` in the §5 schema format with a friendly `label`, short `description` per section, `help` where non-obvious (e.g. "Shown under the logo, about 120 characters"), `required`, and `max` for length-sensitive fields. List item fields use `list` with `fields`; tuple-style arrays (e.g. `["CMAS","Carbon manganese..."]`) are modelled as lists of objects in `default.json` (document the mapping in the file's top `_notes` field only if the validator allows it, otherwise in a comment to PM).
- Acceptance:
  - [ ] Script proves every leaf in `default.json` has a schema field and every schema field exists in `default.json` (no orphans either way).
  - [ ] `type` values only from the §5 set; every `image` field points to a path or URL; every list has `fields`.
  - [ ] Labels are plain English (no JSON key names), reviewed by PM.
  - [ ] BE-4 validator accepts `default.json` against it.

### SITE-3 Boot from content
- Owner SITE. Files: `public/js/app.js`
- Replace the hard-coded arrays with values read from a content object, implementing §7: `boot()` fetches `/api/content` (`cache:'no-cache'`, 2.5 s timeout), falls back to `/content/default.json`; then runs the existing renderers unchanged in logic. Reading from tuple-style data must keep current rendering. Render user content via `textContent` or the existing escaping helper only. Keep one content request on the happy path (no extra calls, no `default.json` fetch unless fallback needed). Avoid layout shift: do not show empty containers longer than the current site does; keep scripts `defer` as now.
- Acceptance:
  - [ ] With `/api/content` returning `default.json`, all 14 routes match baselines (SITE-0) pixel for pixel at both viewports, and `main` text dumps are identical.
  - [ ] With `/api/content` blocked (network error, 500, invalid JSON, 3 s delay), pages render identically from `default.json` with no console errors visible to users.
  - [ ] Changing one brand description in served JSON changes only that text.
  - [ ] Content with `<script>` or HTML in any field renders as literal text (test with an injected value).
  - [ ] Network panel shows exactly one content request on the happy path; no new third-party hosts.
  - [ ] Router, enquiry form, carousel, keyboard and focus behaviour unchanged (manual checklist in the task report).

### SITE-4 data-cms attributes
- Owner SITE. Files: `public/index.html`, `public/404.html` (must remain an exact byte copy of `index.html`; verify with `cmp`)
- Add `data-cms="key"` to editable headings, intros, and paragraphs (page H1s, section headings, intro text) with stable lowercase keys (`home.hero...`, `about.intro`...). Markup, classes and text otherwise untouched; app.js sets `textContent` when the key exists in `content.texts`.
- Acceptance:
  - [ ] `diff` of the HTML before/after shows only added `data-cms` attributes.
  - [ ] `cmp public/index.html public/404.html` identical.
  - [ ] Elements containing nested markup (links, `<em>`) are not given `data-cms` unless their structure is preserved by the renderer; list them in the report.
  - [ ] Baseline comparison (SITE-0) passes on all routes and both viewports.

### SITE-5 Preview mode and banner
- Owner SITE. Files: `public/js/app.js`, `public/css/*` (banner styles only, additive)
- `?preview=1` fetches `/api/content?draft=1` with same-origin credentials; on 401/failure uses published content. Fixed banner "Preview of draft content. Visitors do not see this." with "Exit preview" link (removes `preview` param). Banner is not shown without `?preview=1`; internal links keep `?preview=1` while previewing; `noindex` meta added in preview only.
- Acceptance:
  - [ ] Without the param nothing differs from baselines (re-run full comparison).
  - [ ] With param and an editor cookie, a draft-only change appears; without cookie, published content shows (no error).
  - [ ] Banner is keyboard reachable, does not cover the header nav or the cookie/enquiry controls on mobile; Exit works.
  - [ ] Navigating between routes in preview keeps preview.

### SITE-6 Final zero-change verification
- Owner SITE. Files: none (report only)
- Re-run SITE-0 capture on the finished site and compare against the baseline.
- Acceptance:
  - [ ] All 28 screenshots identical (zero differing pixels, or differences explained by animation timing and re-run clean).
  - [ ] Text/meta dumps identical; Lighthouse performance score and LCP within 5% of baseline (3 runs median).
  - [ ] Report lists any deviation; any deviation blocks the task.

---

## ADMIN: Admin UI

Starts after SITE-1 and SITE-2. Consumes §6; no innerHTML with content values (use `textContent`/DOM APIs); CSP-safe (no inline scripts or handlers); no build step.

### ADMIN-1 App shell, login, account
- Owner ADMIN. Files: `public/admin/index.html`, `public/admin/admin.css`, `public/admin/admin.js` (router/shell/api helper), `public/admin/js/*.js` (additional modules, all `defer`)
- Login (email + password), forced password change, left nav by role, hash routing, toasts, confirm dialog component, `api()` helper that adds `X-Requested-With`, handles 401 (back to login), 403, 429, 503 with plain messages, My account (name, password). Reuse existing styling.
- Acceptance:
  - [ ] Sales sees only Enquiries and My account; editor adds Content, Media, History; admin adds Users, Audit.
  - [ ] `must_change_password` user cannot reach any other view until changed.
  - [ ] 429 and 401 show distinct clear messages; no password stored in the DOM after submit.
  - [ ] Works at 360 px for login and nav (collapsing menu); focus order and labels correct.

### ADMIN-2 Enquiries view
- Owner ADMIN. Files: `public/admin/js/enquiries.js`, `admin.css`
- Port existing enquiries dashboard behaviour (filters, search, status, notes, CSV export, paging) into the new shell unchanged functionally; add mobile card layout.
- Acceptance:
  - [ ] Every feature of the current dashboard still works against the API.
  - [ ] At 360 px the list is cards and detail is full screen; no horizontal scroll.
  - [ ] CSV export downloads with the current filters.

### ADMIN-3 Schema-driven content editor
- Owner ADMIN. Files: `public/admin/js/content.js`, `public/admin/js/form.js`, `admin.css`
- Load `content-schema.json` and `GET content`; section list with error counts; generate controls for text, textarea, url, number, image, select, stringList, object, list (add, remove, duplicate, move up/down, keyboard accessible); counters for `max`; inline validation mirroring server rules (required, https/`/`/mailto/tel URLs, number, length); status bar (Saved / Unsaved changes / Unpublished changes / Published, last saved by/at); Save draft button and Ctrl/Cmd+S; `beforeunload` and in-app unsaved-changes warnings; map server field-path errors onto fields; conflict dialog on 409 per PRD §4.5.
- Acceptance:
  - [ ] Every field in `default.json` is editable and round-trips: open, save without changes, resulting draft deep-equals the original.
  - [ ] Editing then closing the tab, or navigating to Media/History/other section area, warns; after Save it does not.
  - [ ] Invalid URL, over-length text, missing required field show a message under the field, block Save, and focus the first error.
  - [ ] Ctrl/Cmd+S saves and prevents the browser save dialog.
  - [ ] 409 shows dialog naming the other editor and time; "reload theirs" and "keep editing / download my draft" both work and nothing is silently lost.
  - [ ] List reorder, duplicate, remove work by mouse and keyboard; screen reader announces moves.
  - [ ] Content values containing `<img onerror>` display as text in forms.

### ADMIN-4 Media library and image picker
- Owner ADMIN. Files: `public/admin/js/media.js`, `public/admin/js/image-field.js`, `admin.css`
- Grid view, drag-drop and button upload, client-side canvas resize (long edge <= 2000 px, JPEG/WebP, keep PNG with transparency if small), type and size checks before upload, alt text, copy URL, delete with usage-conflict message; image field control with thumbnail, "Choose from media", "Upload", "Remove".
- Acceptance:
  - [ ] Uploading a 6 MB photo results in <= 4 MB, <= 2000 px image; SVG and PDF are refused with a clear message.
  - [ ] Uploaded image can be picked in a Brand logo field, saved, and shown in Preview.
  - [ ] Deleting an in-use image shows where it is used and does not delete.
  - [ ] Upload progress and error states visible; keyboard operable picker dialog.

### ADMIN-5 Publish, preview, history, rollback
- Owner ADMIN. Files: `public/admin/js/publish.js`, `public/admin/js/history.js`, `admin.css`
- Preview button (opens `/?preview=1`, requires saved draft), Publish dialog (changed-sections summary, optional note), Discard draft (confirm), History list (paged), per-revision changed sections vs live, Rollback with confirm.
- Acceptance:
  - [ ] Full loop in the UI: edit, save, preview shows change, publish with note, public page shows change within cache time, History lists it as Live.
  - [ ] Rollback to previous revision restores the old text on the public site and adds a new "Rollback to #N" revision; draft equals it.
  - [ ] Publish disabled when there is nothing to publish; Preview/Publish prompt to save when unsaved.
  - [ ] Discard returns draft to live and form reflects it.

### ADMIN-6 Users and audit log
- Owner ADMIN. Files: `public/admin/js/users.js`, `public/admin/js/audit.js`, `admin.css`
- Users table, create user (email, name, role, initial password with generator), change role, deactivate/reactivate, reset password (one-time temporary password with copy and warning), last-admin controls disabled with explanation, audit table with paging.
- Acceptance:
  - [ ] Created editor can log in, is forced to change password, and sees only editor navigation.
  - [ ] Attempt to demote or deactivate the last admin shows the server `last_admin` message.
  - [ ] Temporary password is shown once and not retained in the DOM after closing.
  - [ ] Audit log lists the actions from this session in order with user and target.

### ADMIN-7 Polish and cross-browser check
- Owner ADMIN. Files: admin files above
- Accessibility pass (labels, focus, contrast >= 4.5:1, `aria-live`, reduced motion), loading and empty states, noindex meta, Chrome/Firefox/Safari desktop and iOS/Android width check for Enquiries.
- Acceptance:
  - [ ] axe (or equivalent) reports no serious/critical issues on every view.
  - [ ] Full keyboard-only run through login, edit, publish, rollback succeeds.
  - [ ] No console errors on any view; no inline scripts/styles violating CSP.

---

## DOCS: Staff documentation

Starts after ADMIN is done. Plain language, short sentences, numbered steps, no jargon, one screenshot placeholder `[screenshot: ...]` per task where helpful. Verify each step by actually following it in the running admin. Only edit `docs/ADMIN-GUIDE.md`.

### DOCS-1 Getting started
- Files: `docs/ADMIN-GUIDE.md`
- Sections: what the admin panel is; the three roles and what each can do (table); how to log in; first-login password change; how to log out; what to do if locked out (ask an admin).
- Acceptance:
  - [ ] Steps match the real login screens and messages.
  - [ ] Role table matches CMS-ARCHITECTURE §3.

### DOCS-2 Editing content
- Files: `docs/ADMIN-GUIDE.md`
- Sections: how the Content area is organised; change text in a section; add/remove/reorder items in a list; edit a brand; edit figures on the home page; upload a logo and use it; save draft (button and Ctrl/Cmd+S); what the status messages mean; the unsaved-changes warning.
- Acceptance:
  - [ ] A reader can complete "change one brand description" and "replace one brand logo" using only this text.
  - [ ] Each field-type used in the editor is explained once in a short table.

### DOCS-3 Preview, publish, rollback
- Files: `docs/ADMIN-GUIDE.md`
- Sections: preview before publishing; publish with a note; wait time (up to about a minute); read History; roll back; discard a draft; what to do if "someone else saved" appears.
- Acceptance:
  - [ ] Each procedure is numbered and tested end to end.
  - [ ] Explains the difference between Save draft and Publish in two sentences.

### DOCS-4 Users and enquiries
- Files: `docs/ADMIN-GUIDE.md`
- Sections (admin): add a user, change role, deactivate, reset password, read the audit log, why the last admin cannot be removed. Sections (all): change your password and name; enquiries (filter, open, update status, add notes, export CSV, using a phone).
- Acceptance:
  - [ ] Matches real screens and labels.
  - [ ] Includes a "do not share passwords" and "use a long password" note.

### DOCS-5 Launch checklist and troubleshooting
- Files: `docs/ADMIN-GUIDE.md`
- Owner launch checklist: create Neon database via Vercel; create Blob store; set env vars (list from `.env.example`); set first admin and log in; change the bootstrap password; create editor and sales users; verify public site unchanged; test one publish and one rollback; remove temporary credentials. Troubleshooting table: cannot log in, change not visible yet, image refused, "conflict", site shows old content.
- Acceptance:
  - [ ] Every env var name matches `.env.example`.
  - [ ] Checklist has checkboxes and no secrets.

---

## Integration and review checklist (reviewers)

Run after all tasks, against `server.js` (memory store) and, where possible, a Neon branch. Any failure blocks release.

### Security
- [ ] Every action in `api/admin/[action].js` checks session and role server-side; role x action matrix test exists and passes; `/api/content?draft=1` denied to anonymous and sales.
- [ ] IDOR: ids of users, revisions, media, enquiries cannot be used across roles; sales cannot read revisions, media, users, audit; editors cannot touch users or audit.
- [ ] CSRF: non-GET without `X-Requested-With: vfi-admin` is rejected; cookie is HttpOnly, Secure (non-localhost), SameSite=Strict.
- [ ] XSS: content containing `<script>`, `<img onerror>`, `javascript:` URLs, and long strings is rejected by validation or rendered as text on the public site and in admin; CSP header present and no inline scripts needed.
- [ ] Upload: only PNG/JPEG/WebP by magic bytes, <= 4 MB, no SVG, safe filenames, no path traversal, in-use images cannot be deleted.
- [ ] Rate limits: login (IP and email) and enquiry limits enforced; 429 responses; limiter keyed on hashed IP; no raw IP, password or token in logs or audit.
- [ ] Passwords: scrypt only, never returned by any endpoint; temp password shown once; password change and deactivation revoke old sessions.
- [ ] No secrets in repo; `.env.example` placeholders only; `ADMIN_PASSWORD` and `SUPABASE_*` gone; admin responses `no-store`.
- [ ] SQL: all queries parameterised; error responses leak no stack or SQL.

### Functional
- [ ] Full loop: login -> edit brand text and logo -> save draft -> preview shows it, public does not -> publish -> public shows it -> rollback -> public shows the old version; history lists all three.
- [ ] Roles: admin, editor, sales each see only their navigation and are blocked by the API outside their rights.
- [ ] Last-admin protection (demote, deactivate) works; with two admins it is allowed.
- [ ] Conflict: two browsers edit the same draft; second save gets the conflict dialog, no data lost.
- [ ] Unsaved-changes warnings, Ctrl/Cmd+S, per-field validation messages, error summary all work.
- [ ] Forced password change flow cannot be bypassed via direct API calls.
- [ ] Existing enquiry flow (form -> API -> dashboard -> status -> CSV) works with named users; enquiry notification mail behaviour unchanged.
- [ ] Bootstrap and seed: fresh database yields one admin, content revision #1 identical to `default.json`.
- [ ] Docs: following `docs/ADMIN-GUIDE.md` literally completes every listed task.

### Performance and fallback
- [ ] Public site: all 14 routes pixel-identical to the pre-CMS baseline at 1440 and 390 px with default content.
- [ ] Happy path makes exactly one content request; `/api/content` cached 60 s with ETag; Lighthouse performance and LCP within 5% of baseline.
- [ ] Kill the database (bad `DATABASE_URL`): public site and enquiry form behaviour: site renders from defaults (header `X-Content-Source: defaults`), enquiry returns a graceful error, admin shows a clear unavailable message.
- [ ] Block `/api/content` entirely: site renders from bundled `default.json` within 2.5 s timeout plus fetch, no visible error.
- [ ] Admin actions respond < 1 s typical on Neon (cold start noted separately); function count <= 4; `npm test` green offline.
