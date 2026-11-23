# VFI Group website: CMS and admin panel, product requirements

Technical design (binding): `docs/CMS-ARCHITECTURE.md`. Section keys, roles, API and storage are defined there; this document says what staff must be able to do and how it must feel. Owner decisions: Neon Postgres, draft -> preview -> publish with history and rollback, named users with roles admin / editor / sales.

## 1. Goals
1. Staff change website text, figures, brands, logos and images without a developer or a redeploy.
2. Nothing goes live by accident: edits are drafts, previewed on the real site, then published deliberately.
3. Any publish can be undone in two clicks (rollback), and we know who changed what and when.
4. The public site is no slower than today and never goes blank, even if the API or database is down.
5. Existing enquiry handling keeps working and gets named users.

## 2. Personas
| Persona | Needs | Role |
|---|---|---|
| Marketing editor (Meera) | Update brands, hero slides, figures, awards, SEO text; upload logos; preview before publish; undo mistakes. Desktop, not technical. | editor |
| Sales (Sanjay) | Read, filter, update status/notes, export enquiries, often from a phone. Must not see or change content. | sales |
| Owner / admin (Vikram) | Everything above plus add/remove staff, reset passwords, see who changed what. | admin |

## 3. User stories
- As an editor I log in with my email and password and land on Content.
- As an editor I open a section (e.g. Brands), change a description, and press Save draft; I see "Saved" and "Unpublished changes".
- As an editor I open Preview and see the real site with my draft and a clear "Preview" banner; visitors still see the old version.
- As an editor I publish with a short note, and the live site shows the change within about a minute.
- As an editor I upload a logo, give it alt text, and pick it in a brand field.
- As an editor I open History, see who published what, and roll back to a previous version.
- As an editor I discard my draft to start again from what is live.
- As sales I filter enquiries by status, open one, add a note, mark it contacted, export CSV.
- As an admin I add a user with a role and an initial password, change a role, deactivate a leaver, reset a forgotten password, and read the audit log.
- As any user I change my name and password.
- As an admin I cannot lock the company out: the last active admin cannot be demoted or deactivated.

## 4. Functional requirements

### 4.1 Login and accounts
- Email + password login; wrong credentials show one generic message (no hint which part was wrong).
- Repeated failures are rate-limited (429 message "Too many attempts, try again in 15 minutes").
- Users flagged `must_change_password` (first admin, after reset) are forced to a change-password screen before anything else.
- Password minimum 12 characters; show the rule and a live strength/length hint; confirm field.
- Session lasts 12 h; logout clears it; deactivation or password change signs the user out everywhere.
- First admin is created from environment variables (`BOOTSTRAP_ADMIN_*`); no sign-up page exists.

### 4.2 Roles
Exactly the matrix in CMS-ARCHITECTURE §3. The UI hides what a role cannot use (sales never sees Content, Media, History, Users, Audit), and the server enforces it independently.

### 4.3 Content editing (sections, per CMS-ARCHITECTURE §5)
Editable sections, in this order in the left list, each with plain-language label and description from `content-schema.json`:
Site settings and contacts (`settings`), SEO titles and descriptions (`seo`), Home hero slides (`hero`), Scale figures (`scale`), Portfolio categories (`portfolio`), Brands (`brands`), Capabilities (`capabilities`), Technologies (`technologies`), Foam (`foam`), Solutions (`solutions`), Partnership routes (`routes`), Retail partners (`retail`), Hotels (`hotels`), Markets (`markets`), Awards (`awards`), Timeline (`timeline`), Values (`values`), What we do (`whatWeDo`), At a glance (`glance`), Sustainability / CSR (`csr`), Code of conduct (`conduct`), Careers roles (`careers`), Process (`process`), Page headings and intro texts (`texts`).
- Forms are generated from the schema: text, textarea, url, number, image, select, string list, object, list.
- Lists support add, remove, duplicate, move up/down (buttons, keyboard accessible); removal asks for confirmation when the item has content.
- Each field shows label, help text, character counter where `max` applies, and required marker.
- Validation messages appear under the field, in plain words (e.g. "Website address must start with https://"); the section nav shows a count of errors; Save is blocked with a summary when invalid. Server errors with paths (`brands[3].url`) are mapped to the same fields.
- Image fields: show thumbnail, "Choose from media", "Upload", "Remove"; accepted values are bundled `/assets/` paths or uploaded media.
- A section a field belongs to is the unit of navigation only; one draft covers all sections.

### 4.4 Media library
- Grid of uploaded images with filename, size, dimensions, alt text; search not required.
- Upload by button or drag-and-drop; PNG, JPEG, WebP only (no SVG); max 4 MB after client-side resize (long edge <= 2000 px). Clear errors for wrong type/size.
- Alt text editable at upload; copy URL; delete is refused with a message naming where it is still used (draft or live).

### 4.5 Draft, preview, publish
- One shared draft. Status bar always shows: Saved / Unsaved changes (this browser) / Unpublished changes (draft differs from live) / Published, plus who last saved and when.
- Save draft: button, Ctrl/Cmd+S. No autosave (decision: avoids half-finished edits saved by accident and keeps conflict handling simple).
- Leaving the page, closing the tab or switching section with unsaved edits triggers a warning (`beforeunload` and in-app confirm); switching sections within the app keeps the in-memory edits.
- Preview opens `/?preview=1` in a new tab; requires a saved draft (prompt to save first if unsaved).
- Publish asks for an optional note, shows a short summary of changed sections, then makes the draft live as a new revision.
- Discard draft (confirm) resets draft to live.
- Conflict: if another user saved since you loaded, Save returns a clear dialog: "X saved changes at HH:MM". Options: reload their version (losing yours) or copy your changes out / keep editing (download my draft JSON). No silent overwrite.

### 4.6 History and rollback
- List of revisions: number, note, publisher, date, "Live" badge on current.
- Per revision: view which sections changed versus the live version.
- Rollback with confirm dialog; creates a new live revision "Rollback to #N" and replaces the draft. History is never deleted.

### 4.7 Users admin (admin only)
List (name, email, role, active, last login); create; change role; edit name; deactivate/reactivate; reset password (temporary password shown once with copy button). Last-admin protection shown as a disabled control with explanation.

### 4.8 Audit log (admin only)
Paged table: time, user, action, target, short detail. Covers login (failed and ok), content save/publish/rollback/discard, media upload/delete, user changes, enquiry updates/exports. Read-only.

### 4.9 Enquiries (existing, kept)
Current dashboard behaviour and API contract unchanged (filters, search, status/notes, CSV export), now behind named users for all three roles. Usable on a phone (list becomes cards, detail is full screen).

### 4.10 My account
Change display name and password; shows role and email (read-only).

## 5. UX requirements
- Desktop-first for Content, Media, History, Users, Audit (min 1024 px comfortable, works down to tablet); Enquiries and Login fully usable at 360 px.
- Plain-language labels, no jargon (say "Live", "Draft", not "published_revision").
- Every action gives visible feedback (toast or status line); destructive actions confirm.
- Keyboard operable everywhere; visible focus; focus moves sensibly after dialogs and list operations; errors announced via `aria-live`.
- Content values are never injected as HTML.
- Loading and empty states for every list; errors show a retry.

## 6. Non-functional requirements
- Security: server-side authorisation on every action, scrypt hashes, signed HttpOnly SameSite=Strict cookie, CSRF header, rate limits, upload validation, parameterised SQL, content validated server-side and rendered as text, no secrets in repo or logs, admin pages `noindex` and `no-store`.
- Performance: public page makes at most one content request (`/api/content`), CDN-cached 60 s with ETag; content fetch timeout 2.5 s; no extra render-blocking resources; Lighthouse performance and first render not worse than the current site (measured before/after); admin actions respond < 1 s typical.
- Accessibility: admin meets WCAG 2.1 AA for contrast, focus, labels, keyboard use; public site accessibility unchanged.
- Reliability: if `/api/content` fails, times out, or the database is down, the site renders from the bundled `default.json` with no visible error; enquiry form unaffected by content outages; DB migrations self-apply safely.
- Operability: runs locally and in tests without network (memory store); one README section covers setup (Neon, Blob, env vars, first login).

## 7. Out of scope
WYSIWYG or drag-and-drop page builder; adding new pages or routes; multi-language content; scheduled publishing; email invitations or password-reset emails (admin resets manually); per-field permissions; comments/approval workflows; two-factor auth; image editing beyond resize; SVG uploads.

## 8. Success criteria
1. An editor with only the admin guide changes a brand description and a logo, previews, publishes, and sees it live within about 2 minutes, with no developer help.
2. A bad publish is rolled back in under 1 minute.
3. With the database switched off, every public page still renders identically from defaults.
4. With default content, the public site is pixel-identical to today on all routes and viewport sizes.
5. Sales users cannot reach any content, media, user or audit endpoint (verified by tests).
6. Public page load metrics are within noise of the pre-CMS baseline.
7. All reviewer checklist items in `docs/CMS-TASKS.md` pass.
