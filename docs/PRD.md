# VFI Group website: Enquiries backend and admin dashboard (PRD)

Technical decisions live in `docs/ARCHITECTURE.md` (binding). This document says *what* and *why*; `docs/TASKS.md` says who builds what.

## 1. Goals
1. Every enquiry from the public site is stored durably (Supabase) and never silently lost.
2. The sales team can triage enquiries in a password-protected dashboard: find, read, set status, add internal notes, export.
3. Spam and abuse are contained without hurting real buyers (honeypot, timing trap, rate limit, server validation).
4. The site is production-hardened: CSP, security headers, noindex for admin/API, no raw IPs stored.
5. Email notification is a bonus: only when SMTP env is set; never blocks or fails a submission.

## 2. Users
| User | Need |
|---|---|
| Retail / hospitality / OEM / private-label / foam / export buyers | Send an enquiry quickly, know it arrived, get a reference number. |
| Job seekers (Careers) | Same form, type "Careers". |
| Sales/admin team (internal, 1 to 5 people sharing one password) | See new enquiries first, work them through a status flow, keep notes, export for CRM/Excel, use it on a phone. |

## 3. User stories
- As a buyer, I get clear field-level errors so I can fix my form without losing what I typed.
- As a buyer, I see a reference number after sending so I can quote it later.
- As a buyer, if the server is down, I am told how to email care@vfigroup.org instead and my draft is kept.
- As a buyer who is rate limited, I am told to wait and try again later (or email).
- As sales, I log in and see counts per status and the newest "new" enquiries first.
- As sales, I search by ref, name, company, email, country or message text.
- As sales, I open an enquiry, read the full message, change status and save internal notes.
- As sales, I mark junk as spam so it leaves the default list.
- As sales, I export the current filter to CSV.
- As sales, if my session expires, I am sent to login with a clear message and do not lose typed notes.

## 4. Functional requirements

### 4a. Enquiry submission UX (drawer + inline contact form, shared `buildForm()`)
Statuses of the form:
| State | Behaviour |
|---|---|
| Idle | Draft auto-saved locally (existing). Status line: "Drafts are saved on this device until you send." |
| Validating | On submit, client validates (same rules as ARCHITECTURE §4). Errors appear under the field, field gets `aria-invalid`, focus goes to first invalid field. No request sent. |
| Sending | Submit button disabled and reads "Sending…"; status line (`role=status`) announces "Sending your enquiry…". A second submit is impossible. |
| Success | Form replaced by the thank-you panel showing the email and the reference number (e.g. VFI-261113-A1B2C3). Draft cleared. Panel is announced (aria-live) and focus moves to it. |
| Server field errors (422) | Messages from `errors{}` placed under the matching input; focus first; status line says "Please correct the highlighted fields." |
| Rate limited (429) | Message: too many enquiries from this connection; try again in about 10 minutes or email care@vfigroup.org. Draft kept; button re-enabled. |
| Network / 5xx / 503 / bad JSON | Message: "We could not send your enquiry right now." with a mailto link to care@vfigroup.org; draft kept; button re-enabled for retry. |
| Bot trap | Honeypot value or form open < 2.5 s: server fakes success (client shows normal success). Client sends `t` = ms since form rendered. |
Other codes (405/415/400) show the generic failure message; never show raw server text containing stack/internal detail.

### 4b. Admin dashboard (`/admin`)
- **Login**: password field, submit, error for wrong password ("Incorrect password"), lockout message on 429, "Admin is not configured" on 503. Password input has label, `autocomplete="current-password"`.
- **Session**: on load call `GET /api/admin/session`; show login or dashboard. Any 401 mid-use returns to login with "Your session expired. Please sign in again." and preserves unsaved note text in memory for re-display after login.
- **Logout** button; clears view state.
- **Status tabs with counts**: Active (all except spam, default), New, In progress, Contacted, Closed, Spam, All. Counts come from API `counts`; active count = new+in_progress+contacted+closed.
- **List**: columns/cards with ref, received date/time (local, relative + absolute title), name, company, type, country, status badge, message snippet (~120 chars). Newest first. Unread/new rows visually emphasised.
- **Search**: debounced (300 ms) text box, resets to page 1; clear button. Filter + search + page reflected in the URL query (`?status=&q=&page=`) so refresh/back work.
- **Pagination**: 25/page; Prev/Next, "Showing 26-50 of 133".
- **Detail view** (side panel on desktop, full-screen view on mobile): ref, created/updated, type, name, company, email (mailto), country, volume, source page, full message (preserving line breaks, rendered as text, never HTML), status select, notes textarea, Save. Esc/Back closes. Optimistic UI is not required; show "Saved" confirmation or error.
- **Status change**: new, in_progress, contacted, closed, spam; list row and counts update after save.
- **Notes**: up to 5000 chars with counter; saved with Save button; warning if closing with unsaved changes.
- **CSV export**: button exports the current status+search filter via `/api/admin/export` (download, not navigation to JSON); shows error if it fails.
- **States**: loading (skeleton/spinner, aria-busy), empty ("No enquiries match", with clear-filters action), error with Retry.
- **Mobile**: usable at 360 px: tabs scroll horizontally, list as cards, 44 px touch targets, no horizontal page scroll.

### 4c. Non-functional
- **Security**: per ARCHITECTURE §3, §5, §7, §8. Admin never reachable without a valid signed cookie; admin RPC secret never in browser; HTML-escaping everywhere user text is rendered (use `textContent`); CSV injection guard; CSRF header on state changes; no secrets in repo.
- **Accessibility (WCAG 2.1 AA basics)**: every input has a programmatic label; visible focus (reuse `:focus-visible`); everything operable by keyboard; drawer traps focus and Esc closes (existing); errors linked via `aria-describedby` and announced; status/results via `aria-live`; colour contrast >= 4.5:1; respects `prefers-reduced-motion`; status never conveyed by colour alone (text label).
- **Performance**: public site unchanged weight (+< 3 KB JS); admin page < 60 KB total, no framework; list API response < 1 s p95 for 25 rows; function timeout budget 10 s, Supabase call 8 s.
- **SEO**: `/admin` and `/api/*` send `X-Robots-Tag: noindex`, `<meta name="robots" content="noindex,nofollow">` on admin page, `Disallow: /admin` and `Disallow: /api/` in robots.txt; admin not in sitemap. Public pages keep existing metadata; `404.html` identical to `index.html`.
- **Privacy**: raw IP is never stored or logged; only HMAC `ip_hash` (salted). Admin API never returns `ip_hash`. User agent truncated. Privacy page wording unchanged unless the owner requests.
- **Reliability**: Supabase failure returns 503 `unavailable` (not 500); email failure never fails a submission.

## 5. Out of scope
Per-user admin accounts/roles, 2FA, SSO; replying to enquiries from the dashboard; attachments; CRM integrations; analytics dashboards; multi-language; CAPTCHA services; file/image uploads; deleting enquiries (use status spam); changes to public page content/design beyond the form flow.

## 6. Success metrics
- 100% of valid submissions appear in Supabase with a ref shown to the user (0 silent losses in smoke tests).
- Spam reaching the default admin list < 5% of submissions (after honeypot/timing/rate limit).
- Median time from enquiry to first status change visible in admin (tracked via `updated_at`) trending down; target < 1 working day.
- Lighthouse a11y >= 95 on `/contact` and `/admin`; no CSP violations in console on any page.
- `npm test` green; Playwright smoke (submit, error paths, admin flow) green at 360 px and 1280 px.
