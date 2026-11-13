'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { setupEnv, boot } = require('./_helpers');
setupEnv();
const { CSP } = require('../server');

let srv;
test.before(async () => { srv = await boot(); });
test.after(async () => { await srv.close(); });
const PUB = path.join(__dirname, '..', 'public');
const HSTS = 'max-age=63072000; includeSubDomains; preload';

function assertSecHeaders(r) {
  assert.equal(r.headers.get('strict-transport-security'), HSTS);
  assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(r.headers.get('referrer-policy'), 'strict-origin-when-cross-origin');
  assert.equal(r.headers.get('permissions-policy'), 'camera=(), microphone=(), geolocation=()');
  assert.equal(r.headers.get('x-frame-options'), 'DENY');
  assert.equal(r.headers.get('content-security-policy'), CSP);
  assert.equal(r.headers.get('x-powered-by'), null);
}

test('security headers on /, /admin, /api/enquiry, 404; noindex only on admin/api', async () => {
  for (const p of ['/', '/admin', '/api/enquiry', '/nope']) {
    const r = await fetch(srv.base + p);
    assertSecHeaders(r);
    const robots = r.headers.get('x-robots-tag');
    if (p === '/admin' || p.startsWith('/api')) assert.equal(robots, 'noindex', p); else assert.equal(robots, null, p);
  }
});

test('vercel.json is valid, equivalent to server.js headers, keeps required keys', () => {
  const v = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'vercel.json'), 'utf8'));
  assert.equal(v.framework, null); assert.equal(v.buildCommand, ''); assert.equal(v.outputDirectory, 'public'); assert.equal(v.cleanUrls, true);
  const all = v.headers.find((h) => h.source === '/(.*)');
  const map = Object.fromEntries(all.headers.map((h) => [h.key, h.value]));
  assert.equal(map['Content-Security-Policy'], CSP);
  assert.equal(map['Strict-Transport-Security'], HSTS);
  assert.equal(map['X-Frame-Options'], 'DENY');
  assert.ok(v.headers.find((h) => h.source === '/assets/(.*)'));
  for (const s of ['/admin(.*)', '/api/(.*)']) assert.equal(v.headers.find((h) => h.source === s).headers.find((x) => x.key === 'X-Robots-Tag').value, 'noindex');
  assert.ok(v.rewrites.some((r) => r.source === '/admin' && r.destination === '/admin/index.html'));
  assert.ok(!v.rewrites.some((r) => r.source === '/(.*)' || r.source === '/:path*'), 'no catch-all rewrite');
  const files = fs.readdirSync(path.join(__dirname, '..', 'api'), { recursive: true }).filter((f) => f.endsWith('.js'));
  assert.ok(files.length <= 4, 'function count');
});

test('clean URLs serve index.html with 200', async () => {
  const index = fs.readFileSync(path.join(PUB, 'index.html'), 'utf8');
  for (const p of ['/', '/about', '/manufacturing', '/innovation', '/products', '/brands', '/partnerships', '/sustainability', '/careers', '/contact', '/privacy', '/terms', '/code-of-conduct']) {
    const r = await fetch(srv.base + p);
    assert.equal(r.status, 200, p);
    assert.equal(await r.text(), index, p);
  }
});

test('unknown paths: 404 with the app html body', async () => {
  const body404 = fs.readFileSync(path.join(PUB, fs.existsSync(path.join(PUB, '404.html')) ? '404.html' : 'index.html'), 'utf8');
  for (const p of ['/nope', '/about/x', '/admin/nope', '/assets/img/missing.png']) {
    const r = await fetch(srv.base + p);
    assert.equal(r.status, 404, p);
    assert.equal(await r.text(), body404);
  }
});

test('unknown /api path is JSON 404', async () => {
  const r = await fetch(srv.base + '/api/nothing');
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'not_found');
});

test('/admin serves public/admin/index.html when it exists', async (t) => {
  const f = path.join(PUB, 'admin', 'index.html');
  if (!fs.existsSync(f)) return t.skip('public/admin/index.html not present yet');
  const r = await fetch(srv.base + '/admin');
  assert.equal(r.status, 200);
  assert.equal(await r.text(), fs.readFileSync(f, 'utf8'));
});

test('static assets are served with cache headers', async () => {
  const r = await fetch(srv.base + '/assets/img/favicon.png');
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('cache-control'), 'public, max-age=2592000');
});
