# VFI Group website

Corporate website for Varahamurti Flexirub Industries Pvt. Ltd.

## Run locally
```
npm install
npm start          # http://localhost:3000
```

## Structure
```
server.js            Express server: clean URLs, enquiry API, security headers
lib/enquiry.js       Enquiry validation, spam honeypot, optional email (shared)
api/enquiry.js       Same API as a Vercel serverless function
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

## Enquiries
The contact form and "Partner with us" drawer POST to `/api/enquiry`.
- On the Node server every enquiry is appended to `data/enquiries.jsonl`.
- To also email them, copy `.env.example` values into the host's environment variables
  (SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ENQUIRY_TO, ENQUIRY_FROM).
- On Vercel there is no disk, so SMTP variables are required to receive enquiries.

## Review notes before launch
Open any page with `?review` (e.g. `/?review`) and press **Review notes** to highlight every
item marked as needing confirmation (facts, logos, certifications, legal text).

## Deploy
- Any Node host (Render, Railway, a VPS): `npm install && npm start`.
- Vercel: import the folder; `vercel.json` handles clean URLs and `api/enquiry.js`.
