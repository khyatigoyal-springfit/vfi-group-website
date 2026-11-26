# VFI Group website: admin guide

For VFI staff who update the website. No technical skills are needed.

---

## 1. Before you start

- The admin area is at **https://www.vfigroup.org/admin**.
- You can change text, figures, brands, logos and photos on the public website.
- Nothing goes live until you **publish** it.
- Use a computer for Content, Media, History, Users and Audit log. Enquiries also work on a phone.
- Use a password of **12 characters or more**. Never share your password, and never send it by email or chat.

---

## 2. Signing in

### Sign in

1. Open https://www.vfigroup.org/admin.
2. Type your email in **Email**.
3. Type your password in **Password**.
4. Click **Sign in**.

A wrong email or password shows **"Incorrect email or password."** Check the spelling and the Caps Lock key.

### First sign-in: set a new password

After your first sign-in, or after an Admin resets your password, you see **Set a new password**. You cannot open other pages until you change it.

1. Type the temporary password in **Current password**.
2. Type your new password in **New password**. It must be at least 12 characters and different from the old one.
3. Type it again in **Confirm new password**.
4. Click **Set new password**.

Tip: a phrase of four or five unrelated words, such as "copper harbour lantern maple", is strong and easy to remember.

### Sign out

Click **Sign out** at the top right. You stay signed in for 12 hours. After that you see **"Your session expired. Please sign in again."**

### If you are locked out

- **"Too many attempts. Try again in 15 minutes."** Stop trying. Wait 15 minutes.
- Still locked out, or you forgot your password? Ask an **Admin** to reset it (section 8).

---

## 3. Roles

The menu shows only the pages your role can use.

| What you can do | Admin | Editor | Sales |
|---|:-:|:-:|:-:|
| Enquiries: view, search, change status, add notes, export CSV | Yes | Yes | Yes |
| Content: edit the draft, Save draft, Preview, Publish, Discard draft | Yes | Yes | No |
| Media: upload, edit alt text, copy address, delete images | Yes | Yes | No |
| History: see past versions, roll back | Yes | Yes | No |
| Users: add people, change roles, deactivate, reset passwords | Yes | No | No |
| Audit log: see who changed what | Yes | No | No |
| My account: change your own name and password | Yes | Yes | Yes |

- **Admin** sees: Enquiries, Content, Media, History, Users, Audit log, My account.
- **Editor** sees: Enquiries, Content, Media, History, My account.
- **Sales** sees: Enquiries, My account.

---

## 4. How publishing works

1. **Draft.** Save your edits with **Save draft**. Only staff see the draft.
2. **Preview.** Look at the draft on the real site. Visitors still see the old version.
3. **Publish.** The draft becomes the live site.

**Save draft** keeps changes inside the admin area. **Publish** makes them live for everyone.

### Status bar

| Status text | Meaning |
|---|---|
| **Unsaved changes** | Your edits are not saved yet. Click **Save draft**. |
| **Saving…** | Wait. |
| **Draft saved — not published** | Saved, but the live site still shows the old version. |
| **All changes published** | The draft matches the live site. |

The bar also shows who last saved the draft and the live version number (for example "Live: revision #12").

### Buttons

| Button | What it does |
|---|---|
| **Save draft** | Saves your edits. Shortcut: **Ctrl+S** (Windows) or **Cmd+S** (Mac). |
| **Preview** | Opens the real site in a new tab, showing the draft. Save first. |
| **Publish…** | Opens a box for an optional note, then **Publish** makes the draft live. |
| **Discard draft** | Resets the draft to the live site. Unpublished changes are lost. This cannot be undone. |

### Publish step by step

1. Click **Content** and make your changes.
2. Click **Save draft**. Wait for **Draft saved — not published**.
3. Click **Preview** and check the new tab.
4. Back in the admin, click **Publish…**.
5. Optional: type a short note, such as "Updated Kenstar description".
6. Click **Publish**.

Visitors see the change within about a minute.

### Roll back step by step

1. Click **History**. The live version has a **Live** badge.
2. Click **View changes** to see what a version changed.
3. Click **Roll back** on the version you want.
4. Click **Roll back and publish**.

The site returns to that version within about a minute. A new version called "Rollback to #N" is added, so nothing is lost.

### Unsaved changes

- Moving to another page with unsaved edits asks **Leave without saving?**. Choose **Save draft and leave** to keep your work.
- Closing the browser tab with unsaved edits shows a browser warning. Cancel, click **Save draft**, then close.

### Two people editing at once

There is only one shared draft. If two people edit at the same time, one person's work can replace the other's. Check **Draft last saved by** before you start. If someone else saved first, you see **Someone else saved changes**, with three choices:

- **Reload their version:** shows their draft. Your unsaved edits are lost.
- **Keep my edits:** your version replaces theirs.
- **Download my draft as JSON:** saves a copy of your edits. The box stays open.

---

## 5. Editing content

Open **Content**. The list on the left shows the sections. A red mark next to a section means a field there needs fixing.

| Section | What it controls |
|---|---|
| Settings & contact | Website address, contact details, factories, global offices, pop-out menu |
| SEO | Browser tab titles and search descriptions for each page |
| Home hero | The slideshow at the top of the home page |
| Scale figures | Counting numbers, fact boxes, highlight chips |
| Portfolio | Portfolio cards and brand logo strip |
| Brands | Each brand: name, logo, website, photo, description |
| Capabilities, Technologies, Foam, Solutions | Manufacturing and product content |
| Partnerships: routes / retailers / hotels / export markets | Partner buttons, retailer logos, hotels, countries |
| Awards | Award logos on the home page |
| About: timeline / values / what we do / at a glance | About page content |
| CSR focus areas, Code of conduct, Careers, Process | Matching pages |
| Page texts | Headings, intros and paragraphs on each page |

### Field types

| Field | What it looks like | Rules |
|---|---|---|
| Text / Long text | One line / several lines | A counter shows the limit. Press Enter for a new line in long text. |
| Link | A web address | Starts with **https://**, or **/** for a page on this site, **mailto:** for email, **tel:** for phone. |
| Number | A box for digits | Whole numbers only, no commas. |
| Picture | A thumbnail and buttons | See section 6. |
| Choice | A drop-down list | Pick one option. |
| Short list | One box per item | Click **Add** to add an item. |
| Group | Several fields under one heading | Fill in each field. |
| List | A card per item | Add, remove, duplicate, move up or down. |

In lists, click a card's title to open or close it. **↑** and **↓** move a card (on a keyboard, hold **Alt** and press an arrow). **Remove** asks you to confirm if the card has content.

### Change a brand's description

1. Click **Content**, then **Brands**.
2. Click the brand's name to open its card.
3. Edit **Description** (up to 800 characters).
4. Click **Save draft**, then **Preview** to check, then **Publish…**.

### Change a brand's website or logo

1. Open the brand's card under **Brands**.
2. Edit **Brand website**. Type the full address, starting with **https://**. Leave it empty if there is no website.
3. Under **Logo**, click **Choose from media library** and pick the image. If it is not there yet, click **Upload new** (section 6). **Clear** removes the logo.
4. Click **Save draft**, then **Preview**, then **Publish…**.

### Add a new brand

1. Open **Content**, then **Brands**.
2. Click **Add brand** at the bottom of the list.
3. Open the new card. Fill in **Brand name** and **Description** (both required). Add a **Tagline**, **Since line**, **Collections** and **Logo** (a transparent PNG).
4. For a section on the Brands page, add a **Brand photo**.
5. Click **Save draft**, then **Preview**, then **Publish…**.

### Reorder brands

1. Open **Content**, then **Brands**.
2. Click **↑** or **↓** on the brand's card. The brand moves one place.
3. Click **Save draft**, then **Preview**, then **Publish…**.

### Update the key figures

1. Open **Content**, then **Scale figures**.
2. Under **Counting figures**, edit **Number** (whole number, no commas), **Symbol after the number** or **Label**.
3. Under **Fact boxes**, edit **Figure** and **Label**.
4. Under **Highlight chips**, each line is one tag.
5. Click **Save draft**, then **Preview**, then **Publish…**.

### Change a hero slide's heading or photo

1. Open **Content**, then **Home hero**.
2. Open the slide's card under **Slides**. Slide 1 is the main heading of the home page.
3. Edit **Small label**, **Heading** (up to 120 characters) or **Supporting text**.
4. For a new photo, click **Choose from media library** or **Upload new** under **Background photo**. Use a wide photo at least 1600 px across.
5. Click **Save draft**, then **Preview**, then **Publish…**. Keep three or four slides.

### Add an award or retail partner logo

- **Award:** open **Content**, then **Awards**. Click **Add award**, fill in **Award name** and choose a PNG under **Award logo**.
- **Retail partner:** open **Partnerships: retailers**. Click **Add retailer**, fill in **Retailer name** and choose a transparent PNG under **Logo**.
- Then click **Save draft**, **Preview**, **Publish…**.

### Update contact details or the factory list

1. Open **Content**, then **Settings & contact**.
2. Open **Contact details** to edit the offices. Each group has a heading, address, phone, email and optional Google Maps link.
3. To change a factory, open its card under **Manufacturing units**. Click **Add manufacturing unit** for a new one.
4. Click **Save draft**, then **Preview**, then **Publish…**.

### Edit page headings and text

1. Open **Content**, then **Page texts**.
2. The boxes are grouped by page, such as **Home · Overview · Heading**.
3. Edit a box. **Leave a box empty to keep the original wording.**
4. Click **Save draft**, then **Preview**, then **Publish…**.

### Change search descriptions (SEO)

1. Open **Content**, then **SEO**, then the page, such as **Brands page**.
2. Edit **Browser tab title** (keep under 60 characters) and **Search result description** (keep under 160 characters).
3. Click **Save draft**, then **Preview**, then **Publish…**. Search engines can take days or weeks to update.

---

## 6. Images

| Image | File type | Size | Notes |
|---|---|---|---|
| Logo or award logo | PNG, transparent background | About 600 px wide | Transparency lets the logo sit on any colour. |
| Photo (hero, brand, capability, technology) | JPG or WebP | At least 1600 px wide | Photos larger than 2000 px are reduced automatically. |

- Accepted: **PNG, JPG (JPEG) and WebP**. Maximum **4 MB** after reduction.
- Not accepted: **SVG** and **PDF**. The admin refuses them.

### Upload to the library

1. Click **Media**, then **Upload images**. You can also drag files onto the page.
2. Click **Choose an image** and pick the file.
3. Type **Alt text**.
4. Click **Upload**.

### Alt text

Alt text is a short description of the picture. Screen readers read it aloud to people who cannot see the image.

- Good: "Stacked mattresses in a warehouse".
- Not good: "IMG_2041".
- Keep it under 200 characters. Change it later with **Edit alt text**.

### Delete an image

1. Click **Media**, then **Delete** on the image, then confirm.
2. If the image is still used, the admin does not delete it. The box **This image is in use** lists where.
3. Remove or replace the image in each place, click **Save draft** and **Publish…**, then delete it.

---

## 7. Enquiries

Everyone who signs in can use Enquiries.

| Status | Use it for |
|---|---|
| **New** | Nobody has looked at it yet. |
| **In progress** | Someone is working on it. |
| **Contacted** | You have replied to the person. |
| **Closed** | Finished. |
| **Spam** | Junk. Hidden from the Active tab. |

1. Click **Enquiries**. The **Active** tab shows everything except spam. Use the other tabs to narrow the list.
2. To search, type in **Search enquiries** and press Enter. Click **×** to clear it.
3. Click the reference in the first column to open an enquiry.
4. Change **Status**. Type staff-only notes in **Internal notes** (up to 5000 characters).
5. Click **Save**. The box shows **Saved**.

**Export CSV** downloads a file called **vfi-enquiries-** and today's date, ending in **.csv**. It holds the enquiries that match your current tab and search.

On a phone, each enquiry is a card. Tap it to open it full screen.

---

## 8. Users and audit log (Admin only)

Only Admins can open **Users** and **Audit log**. Anyone else sees "You do not have access to this page."

### Add a user

1. Click **Users**, then **Add user**.
2. Type the **Email address** and **Name**.
3. Choose a **Role**: Admin, Editor or Sales.
4. Type an **Initial password** of at least 12 characters, or click **Generate**.
5. Click **Create user**.
6. Give the password to the person yourself. The new user must change it at first sign-in.

### Change a role

1. Click **Users**, then **Edit** on the person's row.
2. Change **Role**, then click **Save**.

### Deactivate or reactivate

1. Click **Users**, then **Deactivate** on the row, then confirm.
2. The person is signed out at once and cannot sign in.
3. To restore access, click **Reactivate**.

Deactivate people who leave the organisation.

### Reset a password

1. Click **Users**, then **Reset password** on the row, then confirm.
2. The temporary password appears **once**. Click **Copy** and give it to the person yourself.
3. Click **I have copied it**. It cannot be shown again.

### Why the last admin cannot be removed

The system always keeps one active Admin. For the last one, **Deactivate** is disabled and the note "Last active admin: cannot be deactivated or demoted." appears. To change that Admin, first make another person an Admin.

### Audit log

Click **Audit log**. It lists sign-ins, failed sign-ins, saves, publishes, rollbacks, uploads, user changes and enquiry changes, newest first. It is read-only.

---

## 9. Troubleshooting and FAQ

| Problem | What to do |
|---|---|
| Incorrect email or password | Check the email, password and Caps Lock. Still stuck? Ask an Admin to reset it. |
| Too many attempts. Try again in 15 minutes. | Wait 15 minutes. |
| Your session expired | Sign in again. Save often. |
| Enter a valid https:// link / Links must start with https://, /, mailto: or tel: | Type the full address, such as https://www.example.com. |
| This field is required | Fill in the box. |
| Must be N characters or fewer | Shorten the text. The counter shows the limit. |
| Add at least one item | A list needs at least one card. |
| Image must be a /assets/ file or an uploaded image | Choose from the library, or click **Upload new**. |
| SVG images are not accepted / PDF files cannot be used here | Save as PNG, JPG or WebP and upload again. |
| This image is still larger than 4 MB after shrinking | Use a smaller picture. |
| Image uploads are not set up on this server yet | Tell an Admin. |
| This image is in use | Remove it where it is listed, publish, then delete. |
| Someone else saved changes | See "Two people editing at once" in section 4. |
| Could not reach the server | Check your connection and try again. |
| Preview shows old text | Click **Save draft** first, then **Preview**. Preview shows the saved draft only. |
| Publish… is greyed out | Nothing new to publish, or you have unsaved changes. Save first. |
| Live site still shows old text | Wait about a minute, then refresh. If still old after five minutes, tell an Admin. |
| No Content, Media or Users in the menu | Your role does not include them. Ask an Admin. |
| Published something wrong | Open **History**, click **Roll back** on the last good version, then **Roll back and publish**. |

**FAQ**

- **Does Save draft change the website?** No. Only **Publish** does.
- **Can visitors see my draft?** No.
- **Can I undo a publish?** Yes, with **History** and **Roll back**.
- **Can I add pages?** No. This area changes words, figures, brands, logos and photos only.

---

## 10. Launch checklist (owner)

Do not write passwords or keys on this page.

**Set-up (with your developer)**

- [ ] Neon Postgres database is connected through Vercel.
- [ ] Vercel Blob image store is connected, so the Media library works.
- [ ] Environment settings are in place: `DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `SESSION_SECRET`, `IP_SALT`, `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`. Optional email alerts: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `ENQUIRY_TO`, `ENQUIRY_FROM`.

**First admin and staff accounts**

- [ ] Sign in at https://www.vfigroup.org/admin with the first admin account.
- [ ] Change its password to a long one.
- [ ] Create a named **Admin** account for yourself.
- [ ] Create a named **Editor** account for each content person, and a **Sales** account for each enquiries person.
- [ ] Give each person a temporary password in person or by phone. They change it at first sign-in.
- [ ] Ask your developer to remove `BOOTSTRAP_ADMIN_EMAIL` and `BOOTSTRAP_ADMIN_PASSWORD`.
- [ ] Optional: deactivate the shared first admin. Only do this after another active Admin exists.

**Content and site**

- [ ] Review Settings & contact, SEO, Brands, Scale figures and Page texts.
- [ ] Check the public home, Brands and Contact pages look as before.
- [ ] Test a publish: change one word, **Save draft**, **Preview**, **Publish…**. Confirm it is live within about a minute.
- [ ] Test a rollback: in **History**, **Roll back** to the previous version and confirm the old text returns.
- [ ] Confirm the web address points to the site and https://www.vfigroup.org/admin opens with a padlock.
- [ ] If email alerts are set up, send a test enquiry from the Contact form. Check the email arrives at `ENQUIRY_TO`, then mark the test **Spam** or **Closed**.
- [ ] Tell all staff where the admin area is and who to ask for help.
