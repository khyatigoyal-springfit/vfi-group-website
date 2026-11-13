'use strict';
// Local development / generic Node host. Mounts the SAME handler modules Vercel runs from api/.
const path = require('path');
const fs = require('fs');
const express = require('express');

const enquiryHandler = require('./api/enquiry');
const adminHandler = require('./api/admin/[action]');

const PUBLIC = path.join(__dirname, 'public');
const VIEWS = ['about', 'manufacturing', 'innovation', 'products', 'brands', 'partnerships', 'sustainability', 'careers', 'contact', 'privacy', 'terms', 'code-of-conduct'];

// Keep in sync with vercel.json (ARCHITECTURE section 8).
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'";
const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': CSP,
};

function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('case sensitive routing', true); // /ABOUT is a 404, like Vercel
  app.set('strict routing', false);       // optional trailing slash, like the vercel.json rewrite

  app.use((req, res, next) => {
    res.set(SECURITY_HEADERS);
    if (/^\/(admin(\/|$)|api(\/|$))/.test(req.path)) res.set('X-Robots-Tag', 'noindex');
    next();
  });

  // --- API (no body parser: the handlers read the raw stream themselves) ---
  app.all('/api/enquiry', (req, res) => enquiryHandler(req, res));
  app.all('/api/admin/:action', (req, res) => {
    req.query = Object.assign({}, req.query, { action: req.params.action });
    return adminHandler(req, res);
  });
  app.all('/api/*', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.status(404).json({ ok: false, error: 'Not found', code: 'not_found' });
  });

  // --- static site ---
  const sendFile = (file, status) => (req, res, next) => {
    res.set('Cache-Control', 'no-cache');
    res.status(status || 200).sendFile(file, (err) => { if (err) next(err); });
  };
  const indexFile = path.join(PUBLIC, 'index.html');
  const adminFile = path.join(PUBLIC, 'admin', 'index.html');
  const notFoundFile = fs.existsSync(path.join(PUBLIC, '404.html')) ? path.join(PUBLIC, '404.html') : indexFile;

  app.get(['/', ...VIEWS.map((v) => '/' + v)], sendFile(indexFile));
  app.get(['/admin', '/admin/', '/admin/index.html'], sendFile(adminFile));
  app.get(['/index.html', '/404.html'], (req, res) => res.redirect(301, '/'));

  app.use(express.static(PUBLIC, {
    index: false,
    setHeaders(res, file) {
      res.set('Cache-Control', /[\\/]assets[\\/]/.test(file) ? 'public, max-age=2592000' : 'public, max-age=300');
    },
  }));

  app.use((req, res) => {
    res.set('Cache-Control', 'no-cache');
    res.status(404).sendFile(notFoundFile);
  });

  // Last-resort error handler: never leak stack traces.
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('Server error:', err && err.name);
    if (res.headersSent) return;
    if (req.path.startsWith('/api/')) return res.status(500).json({ ok: false, error: 'Server error', code: 'server_error' });
    res.status(500).type('text/plain').send('Server error');
  });
  return app;
}

if (require.main === module) {
  const PORT = process.env.PORT || 3000;
  createApp().listen(PORT, () => console.log(`VFI Group website running at http://localhost:${PORT}`));
}

module.exports = { createApp, CSP };
