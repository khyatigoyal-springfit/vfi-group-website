'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, validBody, boot, postJson, freshIp, mockReq, mockRes } = require('./_helpers');
setupEnv();
const { getStore } = require('../lib/store');
const { validateEnquiry } = require('../lib/validate');
const session = require('../lib/session');
const adminHandler = require('../api/admin/[action]');

const PW = process.env.ADMIN_PASSWORD;
const CSRF = { 'x-requested-with': 'vfi-admin' };
let srv;
test.before(async () => { srv = await boot(); });
test.after(async () => { await srv.close(); });

async function login(ip = freshIp(), password = PW) {
  const r = await postJson(srv.base, '/api/admin/login', { password }, { ...CSRF, 'x-forwarded-for': ip });
  const sc = r.headers.get('set-cookie');
  return { r, cookie: sc ? sc.split(';')[0] : '' };
}
const get = (p, cookie, h = {}) => fetch(srv.base + p, { headers: { ...(cookie ? { cookie } : {}), ...h } });
const patch = (body, cookie, h = CSRF) => fetch(srv.base + '/api/admin/enquiries', {
  method: 'PATCH', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...h }, body: JSON.stringify(body),
});
const seed = (over = {}) => getStore().submitEnquiry({ ...validateEnquiry(validBody(over)).value, ip_hash: '', user_agent: 'UA' });

test('login success sets a correct cookie; session endpoint reflects it', async () => {
  const { r, cookie } = await login();
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: true });
  const sc = r.headers.get('set-cookie');
  for (const part of ['vfi_admin=', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) assert.ok(sc.includes(part), part);
  assert.ok(!sc.includes('Secure'), 'localhost over http is not Secure');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await (await get('/api/admin/session', cookie)).json(), { ok: true, authenticated: true });
  assert.deepEqual(await (await get('/api/admin/session')).json(), { ok: true, authenticated: false });
});

test('cookie is Secure in production', async () => {
  process.env.NODE_ENV = 'production';
  try { const { r } = await login(); assert.ok(r.headers.get('set-cookie').includes('Secure')); }
  finally { delete process.env.NODE_ENV; }
});

test('wrong, missing and non-string passwords are all the same 401', async () => {
  const bodies = [{ password: 'nope' }, {}, { password: 123 }, { password: '' }, { user: 'admin', password: 'x' }];
  const seen = new Set();
  const ip = freshIp();
  for (const b of bodies) {
    const r = await postJson(srv.base, '/api/admin/login', b, { ...CSRF, 'x-forwarded-for': ip });
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('set-cookie'), null);
    seen.add(JSON.stringify(await r.json()));
  }
  assert.equal(seen.size, 1);
  assert.deepEqual(JSON.parse([...seen][0]), { ok: false, error: 'Incorrect password.', code: 'bad_credentials' });
});

test('failed login is delayed ~400 ms', async () => {
  const t0 = Date.now();
  await login(freshIp(), 'wrong');
  assert.ok(Date.now() - t0 >= 380);
});

test('lockout: 429 after 10 failures per IP, even with the right password; other IP fine', async () => {
  const ip = '192.0.2.200';
  for (let i = 0; i < 10; i++) assert.equal((await login(ip, 'bad' + i)).r.status, 401, 'attempt ' + i);
  const locked = await login(ip, PW);
  assert.equal(locked.r.status, 429);
  assert.equal((await locked.r.json()).code, 'rate_limited');
  assert.equal(locked.cookie, '');
  assert.equal((await login('192.0.2.201', PW)).r.status, 200);
});

test('successful login resets the failure counter', async () => {
  const ip = '192.0.2.210';
  for (let i = 0; i < 5; i++) await login(ip, 'bad');
  assert.equal((await login(ip, PW)).r.status, 200);
  for (let i = 0; i < 9; i++) await login(ip, 'bad');
  assert.equal((await login(ip, PW)).r.status, 200);
});

test('login requires CSRF header (403) and JSON (415/400)', async () => {
  const noHdr = await postJson(srv.base, '/api/admin/login', { password: PW });
  assert.equal(noHdr.status, 403);
  assert.equal((await noHdr.json()).code, 'csrf');
  const wrongHdr = await postJson(srv.base, '/api/admin/login', { password: PW }, { 'x-requested-with': 'XMLHttpRequest' });
  assert.equal(wrongHdr.status, 403);
  const ct = await fetch(srv.base + '/api/admin/login', { method: 'POST', headers: { ...CSRF, 'content-type': 'text/plain' }, body: 'x' });
  assert.equal(ct.status, 415);
  const bad = await postJson(srv.base, '/api/admin/login', '{x', CSRF);
  assert.equal(bad.status, 400);
});

test('not configured: 503 admin_not_configured, never allows', async () => {
  for (const missing of ['ADMIN_PASSWORD', 'SESSION_SECRET']) {
    const saved = process.env[missing];
    delete process.env[missing];
    try {
      const r = await postJson(srv.base, '/api/admin/login', { password: PW }, CSRF);
      assert.equal(r.status, 503, missing);
      assert.equal((await r.json()).code, 'admin_not_configured');
      assert.equal(r.headers.get('set-cookie'), null);
      const cookie = 'vfi_admin=' + session.sign(process.env.SESSION_SECRET || 'x');
      assert.equal((await get('/api/admin/enquiries', cookie)).status, 401);
    } finally { process.env[missing] = saved; }
  }
});

test('logout clears the cookie; requires CSRF header', async () => {
  const { cookie } = await login();
  const r = await fetch(srv.base + '/api/admin/logout', { method: 'POST', headers: { cookie, ...CSRF } });
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.ok(sc.startsWith('vfi_admin=;') && sc.includes('Max-Age=0'));
  assert.equal((await fetch(srv.base + '/api/admin/logout', { method: 'POST', headers: { cookie } })).status, 403);
});

test('unauthenticated: every data endpoint is 401 and never reaches the store', async () => {
  const store = getStore();
  const origs = {};
  for (const k of ['listEnquiries', 'updateEnquiry', 'exportEnquiries']) { origs[k] = store[k]; store[k] = () => { throw new Error('store reached'); }; }
  try {
    for (const p of ['/api/admin/enquiries', '/api/admin/export']) {
      const r = await get(p);
      assert.equal(r.status, 401, p);
      assert.deepEqual(await r.json(), { ok: false, error: 'Please sign in.', code: 'unauthenticated' });
    }
    assert.equal((await patch({ id: '00000000-0000-4000-8000-000000000000', status: 'closed' })).status, 401);
  } finally { Object.assign(store, origs); }
});

test('tampered, altered, expired and garbage cookies are rejected', async () => {
  const { cookie } = await login();
  const v = cookie.split('=')[1];
  const [p, sig] = v.split('.');
  const forged = Buffer.from(JSON.stringify({ exp: Date.now() + 1e9 })).toString('base64url');
  const expired = session.sign(process.env.SESSION_SECRET, Date.now() - 100000, 10);
  const wrongKey = session.sign('another-secret');
  for (const c of [`vfi_admin=${p}.${sig.slice(0, -3)}AAA`, `vfi_admin=${forged}.${sig}`, `vfi_admin=${expired}`, `vfi_admin=${wrongKey}`, 'vfi_admin=garbage', 'vfi_admin=', 'other=1']) {
    assert.equal((await get('/api/admin/enquiries', c)).status, 401, c);
    assert.equal((await (await get('/api/admin/session', c)).json()).authenticated, false);
  }
  assert.equal((await get('/api/admin/enquiries', cookie)).status, 200);
});

test('list: shape, no ip_hash, pagination params, filters, search, counts', async () => {
  const { cookie } = await login();
  const a = await seed({ name: 'Alice Zeta', company: 'Zeta Beds' });
  for (let i = 0; i < 4; i++) await seed({ name: 'Bulk ' + i });
  await patch({ id: a.id, status: 'spam' }, cookie);
  const r = await get('/api/admin/enquiries?pageSize=2&page=1', cookie);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.page, 1); assert.equal(j.pageSize, 2);
  assert.equal(j.rows.length, 2);
  assert.ok(j.total >= 4);
  for (const k of ['new', 'in_progress', 'contacted', 'closed', 'spam']) assert.equal(typeof j.counts[k], 'number');
  assert.ok(!JSON.stringify(j).includes('ip_hash'));
  const p2 = await (await get('/api/admin/enquiries?pageSize=2&page=2', cookie)).json();
  assert.notEqual(p2.rows[0].id, j.rows[0].id);
  const spam = await (await get('/api/admin/enquiries?status=spam', cookie)).json();
  assert.deepEqual(spam.rows.map((x) => x.name), ['Alice Zeta']);
  const dflt = await (await get('/api/admin/enquiries', cookie)).json();
  assert.ok(!dflt.rows.some((x) => x.status === 'spam'));
  const all = await (await get('/api/admin/enquiries?status=all&pageSize=100', cookie)).json();
  assert.ok(all.rows.some((x) => x.status === 'spam'));
  const q = await (await get('/api/admin/enquiries?status=all&q=beds%20zeta', cookie)).json();
  assert.equal(q.total, 0, 'multi-word search is a literal substring');
  const q2 = await (await get('/api/admin/enquiries?status=all&q=zeta', cookie)).json();
  assert.equal(q2.total, 1);
});

test('list: invalid page/pageSize fall back; pageSize clamped; bad status 422', async () => {
  const { cookie } = await login();
  const d = await (await get('/api/admin/enquiries?page=abc&pageSize=-4', cookie)).json();
  assert.equal(d.page, 1); assert.equal(d.pageSize, 25);
  assert.equal((await (await get('/api/admin/enquiries?page=0&pageSize=0', cookie)).json()).page, 1);
  assert.equal((await (await get('/api/admin/enquiries?pageSize=5000', cookie)).json()).pageSize, 100);
  const bad = await get('/api/admin/enquiries?status=bogus', cookie);
  assert.equal(bad.status, 422);
  assert.ok((await bad.json()).errors.status);
});

test('PATCH: updates status+notes, partial updates, CSRF, validation, 404', async () => {
  const { cookie } = await login();
  const e = await seed({ name: 'Patch Me' });
  const ok = await patch({ id: e.id, status: 'contacted', notes: 'line1\nline2' }, cookie);
  assert.equal(ok.status, 200);
  const j = await ok.json();
  assert.equal(j.row.status, 'contacted'); assert.equal(j.row.notes, 'line1\nline2');
  assert.ok(!('ip_hash' in j.row));
  const only = await (await patch({ id: e.id, notes: 'new' }, cookie)).json();
  assert.equal(only.row.status, 'contacted'); assert.equal(only.row.notes, 'new');
  const big = await patch({ id: e.id, notes: 'n'.repeat(5000) }, cookie);
  assert.equal(big.status, 200);
  const kept = (await (await patch({ id: e.id, status: 'closed' }, cookie)).json()).row;
  assert.equal(kept.notes.length, 5000);

  assert.equal((await patch({ id: e.id, status: 'closed' }, cookie, {})).status, 403);
  const tooLong = await patch({ id: e.id, notes: 'n'.repeat(5001) }, cookie);
  assert.equal(tooLong.status, 422);
  assert.ok((await tooLong.json()).errors.notes);
  const badStatus = await patch({ id: e.id, status: 'archived' }, cookie);
  assert.equal(badStatus.status, 422);
  assert.ok((await badStatus.json()).errors.status);
  assert.equal((await patch({ id: 'not-a-uuid', status: 'closed' }, cookie)).status, 422);
  const nf = await patch({ id: '00000000-0000-4000-8000-000000000000', status: 'closed' }, cookie);
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).code, 'not_found');
});

test('status flow moves rows between counts', async () => {
  const { cookie } = await login();
  const e = await seed({ name: 'Flow' });
  const c0 = (await (await get('/api/admin/enquiries', cookie)).json()).counts;
  await patch({ id: e.id, status: 'in_progress' }, cookie);
  const c1 = (await (await get('/api/admin/enquiries', cookie)).json()).counts;
  assert.equal(c1.new, c0.new - 1); assert.equal(c1.in_progress, c0.in_progress + 1);
});

test('export: CSV headers, BOM, quoting, injection guard, filters, ip_hash absent', async () => {
  const { cookie } = await login();
  const x = await seed({ name: '=HYPERLINK("http://evil")', company: 'Comma, Inc', msg: 'multi\nline "quoted"', email: 'csv@example.com' });
  await patch({ id: x.id, status: 'closed' }, cookie);
  const r = await get('/api/admin/export?status=closed&q=comma', cookie);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'text/csv; charset=utf-8');
  assert.match(r.headers.get('content-disposition'), /^attachment; filename="vfi-enquiries-\d{4}-\d{2}-\d{2}\.csv"$/);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const buf = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...buf.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const text = buf.toString('utf8').slice(1);
  assert.ok(text.startsWith('ref,created_at,status,type,name,company,email,country,volume,source_page,message,notes,updated_at\r\n'));
  assert.ok(text.includes(`"'=HYPERLINK(""http://evil"")"`), text);
  assert.ok(text.includes('"Comma, Inc"'));
  assert.ok(text.includes('"multi\nline ""quoted"""'));
  assert.ok(!text.includes('ip_hash'));
  assert.equal(text.trim().split('\r\n').length - 1 >= 1, true);
  const empty = await (await get('/api/admin/export?status=closed&q=nomatchatall', cookie)).text();
  assert.equal(empty.trim().split('\r\n').length, 1);
});

test('method checks and unknown action', async () => {
  const { cookie } = await login();
  const m1 = await fetch(srv.base + '/api/admin/export', { method: 'POST', headers: { cookie, ...CSRF } });
  assert.equal(m1.status, 405); assert.equal(m1.headers.get('allow'), 'GET');
  const m2 = await get('/api/admin/login', cookie);
  assert.equal(m2.status, 405); assert.equal(m2.headers.get('allow'), 'POST');
  const m3 = await fetch(srv.base + '/api/admin/enquiries', { method: 'DELETE', headers: { cookie, ...CSRF } });
  assert.equal(m3.status, 405);
  const nf = await get('/api/admin/nope', cookie);
  assert.equal(nf.status, 404);
  assert.equal((await nf.json()).code, 'not_found');
  assert.equal((await get('/api/admin/__proto__', cookie)).status, 404);
  assert.equal((await get('/api/admin/constructor', cookie)).status, 404);
});

test('store forbidden/unavailable is returned as 503 unavailable', async () => {
  const { cookie } = await login();
  const store = getStore();
  const orig = store.listEnquiries;
  const origErr = console.error; console.error = () => {};
  try {
    for (const code of ['forbidden', 'unavailable']) {
      store.listEnquiries = async () => { const e = new Error('x'); e.code = code; throw e; };
      const r = await get('/api/admin/enquiries', cookie);
      assert.equal(r.status, 503);
      assert.equal((await r.json()).code, 'unavailable');
    }
  } finally { store.listEnquiries = orig; console.error = origErr; }
});

test('handler works Vercel-style (req.query.action, req.body object/string)', async () => {
  const res = mockRes();
  await adminHandler(mockReq({ method: 'POST', query: { action: 'login' }, headers: { 'content-type': 'application/json', 'x-requested-with': 'vfi-admin', 'x-forwarded-for': freshIp() }, body: JSON.stringify({ password: PW }) }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(String(res.getHeader('set-cookie')).startsWith('vfi_admin='));
  const res2 = mockRes();
  await adminHandler(mockReq({ method: 'GET', query: { action: 'session' } }), res2);
  assert.deepEqual(res2.json(), { ok: true, authenticated: false });
});
