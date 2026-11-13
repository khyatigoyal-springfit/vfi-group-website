'use strict';
const path = require('path');
const fs = require('fs');
const express = require('express');
const { validate, notify } = require('./lib/enquiry');

const app = express();
const PORT = process.env.PORT || 3000;
const PUBLIC = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const VIEWS = ['about', 'manufacturing', 'innovation', 'products', 'brands', 'partnerships', 'sustainability', 'careers', 'contact', 'privacy', 'terms', 'code-of-conduct'];

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Frame-Options': 'SAMEORIGIN',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  });
  next();
});

// --- enquiries API -------------------------------------------------------
const hits = new Map(); // naive per-IP rate limit: 5 enquiries / 10 min
function limited(ip) {
  const now = Date.now(), win = 10 * 60 * 1000;
  const list = (hits.get(ip) || []).filter(t => now - t < win);
  list.push(now); hits.set(ip, list);
  return list.length > 5;
}

app.post('/api/enquiry', express.json({ limit: '32kb' }), async (req, res) => {
  if (limited(req.ip)) return res.status(429).json({ ok: false, error: 'Too many enquiries. Please wait a few minutes.' });
  const v = validate(req.body);
  if (!v.ok) return res.status(v.status).json({ ok: false, error: v.error });
  if (v.spam) return res.json({ ok: true, ref: 'VFI-OK' });
  const e = v.enquiry;
  try {
    fs.mkdirSync(DATA, { recursive: true });
    fs.appendFileSync(path.join(DATA, 'enquiries.jsonl'), JSON.stringify({ ...e, ip: req.ip }) + '\n');
  } catch (err) { console.error('Could not save enquiry', err); }
  let emailed = false;
  try { emailed = await notify(e); } catch (err) { console.error('Could not email enquiry', e.ref, err.message); }
  console.log(`Enquiry ${e.ref} from ${e.company} (${e.type})${emailed ? ' emailed' : ''}`);
  res.json({ ok: true, ref: e.ref });
});
app.all('/api/*', (req, res) => res.status(404).json({ ok: false, error: 'Not found' }));

// --- static site ---------------------------------------------------------
app.use(express.static(PUBLIC, {
  index: false,
  setHeaders(res, file) {
    if (/\/assets\//.test(file)) res.set('Cache-Control', 'public, max-age=2592000');
    else res.set('Cache-Control', 'public, max-age=300');
  },
}));

const indexHtml = () => fs.readFileSync(path.join(PUBLIC, 'index.html'));
app.get(['/', ...VIEWS.map(v => '/' + v)], (req, res) => res.type('html').send(indexHtml()));
app.get('/index.html', (req, res) => res.redirect(301, '/'));
app.use((req, res) => res.status(404).type('html').send(indexHtml())); // app renders its 404 view

app.listen(PORT, () => console.log(`VFI Group website running at http://localhost:${PORT}`));
