'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setupEnv, boot, client, makeUser, CSRF, PASSWORD, freshIp, mockReq, mockRes } = require('./_helpers');
setupEnv();
const password = require('../lib/auth/password');
const session = require('../lib/auth/session');
const { getStore } = require('../lib/store');
const adminHandler = require('../api/admin/[action]');

let srv; let store;
test.before(async () => { srv = await boot(); store = getStore(); });
test.after(async () => { await srv.close(); });

const withEnv = async (vars, fn) => {
  const saved = {};
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; if (vars[k] === undefined) delete process.env[k]; else process.env[k] = vars[k]; }
  try { return await fn(); } finally { for (const k of Object.keys(vars)) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; } }
};
const quiet = async (fn) => { const o = console.error; console.error = () => {}; try { return await fn(); } finally { console.error = o; } };
let n = 0;
const mk = (role = 'editor', over = {}) => makeUser(store, { email: `auth-${role}-${++n}@example.com`, role, ...over });
async function loggedIn(role = 'editor', over = {}) {
  const u = await mk(role, over);
  const c = client(srv.base);
  const r = await c.login(u.email);
  assert.equal(r.status, 200);
  return { u, c };
}

// ---------------------------------------------------------------- hashing
test('password: scrypt format, salted, verifies, rejects wrong and malformed hashes', async () => {
  const h = await password.hashPassword('a long enough password');
  assert.match(h, /^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
  const parts = h.split('$');
  assert.equal(Buffer.from(parts[4], 'base64').length, 32, '32-byte salt');
  assert.equal(Buffer.from(parts[5], 'base64').length, 64, '64-byte key');
  assert.notEqual(h, await password.hashPassword('a long enough password'), 'random salt');
  assert.equal(await password.verifyPassword('a long enough password', h), true);
  assert.equal(await password.verifyPassword('a long enough passwore', h), false);
  assert.equal(await password.verifyPassword('', h), false);
  for (const bad of ['', 'plain', 'scrypt$1$2$3$4', 'bcrypt$16384$8$1$AAAA$AAAA', 'scrypt$x$8$1$AAAA$AAAA', 'scrypt$16384$8$1$$', null, undefined, 'scrypt$99999999999$8$1$AAAA$AAAA']) {
    assert.equal(await password.verifyPassword('a long enough password', bad), false, String(bad));
  }
});

test('password policy: >= 12 characters, bounded above; temp passwords are random and policy-compliant', () => {
  assert.equal(password.passwordPolicyError('x'.repeat(11)), 'Password must be at least 12 characters');
  assert.equal(password.passwordPolicyError('x'.repeat(12)), null);
  assert.ok(password.passwordPolicyError('x'.repeat(201)));
  assert.ok(password.passwordPolicyError(undefined)); assert.ok(password.passwordPolicyError(123456789012));
  const seen = new Set();
  for (let i = 0; i < 50; i++) {
    const t = password.generateTempPassword();
    assert.match(t, /^[A-Za-z2-9]{4}(-[A-Za-z2-9]{4}){3}$/);
    assert.equal(password.passwordPolicyError(t), null);
    seen.add(t);
  }
  assert.equal(seen.size, 50);
});

// ---------------------------------------------------------------- cookie
test('session cookie: {uid,v,exp} signed; tampered, expired, malformed and wrong-secret values rejected', () => {
  const S = 's'.repeat(40);
  const v = session.sign(S, { uid: 'u1', v: 3 }, 1000, 60);
  assert.deepEqual(session.verify(v, S, 2000), { uid: 'u1', v: 3, exp: 61000 });
  const [p, sig] = v.split('.');
  const forged = Buffer.from(JSON.stringify({ uid: 'admin', v: 3, exp: Date.now() + 1e9 })).toString('base64url');
  assert.equal(session.verify(p + '.' + sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA'), S, 2000), null);
  assert.equal(session.verify(forged + '.' + sig, S, 2000), null);
  assert.equal(session.verify(v, S, 61001), null, 'expired');
  assert.equal(session.verify(v, 'other-secret', 2000), null);
  assert.equal(session.verify(v, '', 2000), null);
  for (const g of ['', 'a', 'a.b', 'a.b.c', '.', '..', 'x'.repeat(600), null, undefined, 5, '{}.{}']) assert.equal(session.verify(g, S, 2000), null, String(g));
  // validly signed but wrong shape
  const sign = (o) => { const pl = Buffer.from(JSON.stringify(o)).toString('base64url'); return pl + '.' + require('crypto').createHmac('sha256', S).update(pl).digest('base64url'); };
  assert.equal(session.verify(sign({ uid: 1, v: 1, exp: 9e12 }), S, 2000), null);
  assert.equal(session.verify(sign({ uid: 'u', v: '1', exp: 9e12 }), S, 2000), null);
  assert.equal(session.verify(sign({ uid: 'u', v: 1 }), S, 2000), null);
});

test('session cookie attributes: HttpOnly, SameSite=Strict, Path=/, 12 h; Secure except non-production localhost', () => {
  const c = session.cookieString('abc', 43200, true);
  for (const part of ['vfi_admin=abc', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=43200', 'Secure']) assert.ok(c.includes(part), part);
  assert.ok(!session.cookieString('abc', 1, false).includes('Secure'));
  assert.equal(session.isSecure({ headers: { host: 'localhost:3000' } }), false);
  assert.equal(session.isSecure({ headers: { host: 'example.com' } }), true);
  withEnv({ NODE_ENV: 'production' }, () => assert.equal(session.isSecure({ headers: { host: 'localhost:3000' } }), true));
  assert.deepEqual(session.parseCookies('a=1; vfi_admin=x.y; b=c=d'), { a: '1', vfi_admin: 'x.y', b: 'c=d' });
});

// ---------------------------------------------------------------- login
test('login: success returns the user (never the hash), sets a correct cookie; session reflects it', async () => {
  const u = await mk('editor', { name: 'Eddie' });
  const c = client(srv.base);
  const r = await c.login(u.email.toUpperCase());
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.deepEqual(Object.keys(j.user).sort(), ['active', 'created_at', 'email', 'id', 'last_login_at', 'must_change_password', 'name', 'role']);
  assert.equal(j.user.role, 'editor'); assert.equal(j.user.name, 'Eddie'); assert.equal(j.user.must_change_password, false);
  assert.ok(!JSON.stringify(j).includes('password_hash') && !JSON.stringify(j).includes('scrypt'));
  const sc = r.headers.get('set-cookie');
  for (const part of ['vfi_admin=', 'HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) assert.ok(sc.includes(part), part);
  assert.ok(!sc.includes('Secure'), 'localhost over http is not Secure');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const claims = JSON.parse(Buffer.from(c.cookie.split('=')[1].split('.')[0], 'base64url').toString());
  assert.deepEqual(Object.keys(claims).sort(), ['exp', 'uid', 'v']);
  assert.equal(claims.uid, u.id); assert.equal(claims.v, 1);
  const s = await (await c.get('/api/admin/session')).json();
  assert.equal(s.authenticated, true); assert.equal(s.user.email, u.email);
  assert.ok((await store.getUserById(u.id)).last_login_at);
  assert.deepEqual(await (await client(srv.base).get('/api/admin/session')).json(), { ok: true, authenticated: false });
});

test('login: cookie is Secure in production', async () => {
  const u = await mk();
  await withEnv({ NODE_ENV: 'production' }, async () => {
    const r = await client(srv.base).login(u.email);
    assert.ok(r.headers.get('set-cookie').includes('Secure'));
  });
});

test('login: unknown email, wrong password, deactivated user, missing and non-string fields all give the same 401', async () => {
  const u = await mk();
  const off = await mk();
  await store.updateUser(off.id, { active: false });
  const cases = [
    { email: 'nobody@example.com', password: PASSWORD }, { email: u.email, password: 'wrong wrong wrong' }, { email: off.email, password: PASSWORD },
    {}, { email: u.email }, { password: PASSWORD }, { email: 123, password: 456 }, { email: u.email, password: '' }, { email: u.email, password: 'x'.repeat(3000) },
  ];
  const seen = new Set();
  for (const b of cases) {
    const r = await client(srv.base).post('/api/admin/login', b);
    assert.equal(r.status, 401, JSON.stringify(b).slice(0, 60));
    assert.equal(r.headers.get('set-cookie'), null);
    seen.add(JSON.stringify(await r.json()));
  }
  assert.equal(seen.size, 1);
  assert.deepEqual(JSON.parse([...seen][0]), { ok: false, error: 'Incorrect email or password.', code: 'bad_credentials' });
});

test('login: one scrypt run whether or not the account exists (timing), and a 400 ms delay on failure', async () => {
  const u = await mk();
  const calls = [];
  const v = password.verifyPassword; const d = password.dummyVerify;
  password.verifyPassword = async (...a) => { calls.push('real'); return v(...a); };
  password.dummyVerify = async (...a) => { calls.push('dummy'); return d(...a); };
  try {
    await client(srv.base).post('/api/admin/login', { email: u.email, password: 'wrong wrong wrong' });
    await client(srv.base).post('/api/admin/login', { email: 'ghost@example.com', password: 'wrong wrong wrong' });
    assert.deepEqual(calls, ['real', 'dummy']);
  } finally { password.verifyPassword = v; password.dummyVerify = d; }
  adminHandler.settings.failDelayMs = 400;
  try {
    const t0 = Date.now();
    await client(srv.base).post('/api/admin/login', { email: 'ghost@example.com', password: 'x' });
    assert.ok(Date.now() - t0 >= 380);
  } finally { adminHandler.settings.failDelayMs = 0; }
});

test('login: requires the CSRF header (403) and a JSON body (415/400)', async () => {
  const u = await mk();
  const c = client(srv.base);
  const noHdr = await c.post('/api/admin/login', { email: u.email, password: PASSWORD }, { csrf: false });
  assert.equal(noHdr.status, 403); assert.equal((await noHdr.json()).code, 'csrf');
  assert.equal((await c.post('/api/admin/login', { email: u.email, password: PASSWORD }, { csrf: false, headers: { 'x-requested-with': 'XMLHttpRequest' } })).status, 403);
  assert.equal((await c.req('POST', '/api/admin/login', { raw: 'x', headers: { 'content-type': 'text/plain' } })).status, 415);
  assert.equal((await c.req('POST', '/api/admin/login', { raw: '{x', headers: { 'content-type': 'application/json' } })).status, 400);
  assert.equal((await c.post('/api/admin/login', { email: u.email, password: 'x'.repeat(5000) })).status, 413);
  assert.equal((await c.req('POST', '/api/admin/login', { raw: '[]', headers: { 'content-type': 'application/json' } })).status, 400);
});

test('login: failed and successful logins are audited without any password or raw IP', async () => {
  const u = await mk();
  await client(srv.base).post('/api/admin/login', { email: u.email, password: 'wrong wrong wrong' });
  await client(srv.base).login(u.email);
  const log = (await store.listAudit({ limit: 200 })).rows.filter((x) => x.target === u.email);
  assert.deepEqual(log.map((x) => x.action), ['login', 'login_failed']);
  assert.equal(log[0].user_id, u.id);
  const dump = JSON.stringify(log);
  assert.ok(!dump.includes('wrong wrong') && !dump.includes(PASSWORD) && !dump.includes('127.0.0.1') && !/10\.0\./.test(dump));
});

// ---------------------------------------------------------------- rate limits
test('rate limit: 11th failed login from one IP is 429 (even with the right password); other IPs and emails unaffected', async () => {
  const ip = '192.0.2.200';
  const u = await mk();
  const attempt = (email, pw, addr = ip) => client(srv.base).post('/api/admin/login', { email, password: pw }, { headers: { 'x-forwarded-for': addr } });
  for (let i = 0; i < 10; i++) assert.equal((await attempt(`nobody${i}@example.com`, 'bad bad bad bad')).status, 401, 'attempt ' + i);
  const locked = await attempt(u.email, PASSWORD);
  assert.equal(locked.status, 429);
  assert.equal((await locked.json()).code, 'rate_limited');
  assert.equal(locked.headers.get('retry-after'), '900');
  assert.equal(locked.headers.get('set-cookie'), null);
  assert.equal((await attempt(u.email, PASSWORD, '192.0.2.201')).status, 200, 'another IP is fine');
});

test('rate limit: 6th failed login for one email (from different IPs) is 429; a success elsewhere does not reset it', async () => {
  const victim = await mk(); const other = await mk();
  const attempt = (email, pw, ip) => client(srv.base).post('/api/admin/login', { email, password: pw }, { headers: { 'x-forwarded-for': ip } });
  for (let i = 0; i < 5; i++) assert.equal((await attempt(victim.email, 'bad bad bad bad', `198.51.100.${10 + i}`)).status, 401);
  assert.equal((await attempt(other.email, PASSWORD, '198.51.100.99')).status, 200, 'a successful login for another account');
  const r = await attempt(victim.email, PASSWORD, '198.51.100.50');
  assert.equal(r.status, 429, 'still limited after the other success');
  assert.equal((await attempt(other.email, PASSWORD, '198.51.100.51')).status, 200, 'other account unaffected');
});

test('rate limit: failures older than 15 minutes stop counting', async () => {
  const { isLimited } = require('../lib/auth/ratelimit');
  assert.equal(await isLimited(store, { ipHash: 'never-seen', email: 'never@example.com' }), false);
  const calls = [];
  const fake = { countFailedAttempts: async (a) => { calls.push(a); return { ip: 10, email: 0 }; } };
  assert.equal(await isLimited(fake, { ipHash: 'h', email: '' }), true);
  assert.equal(calls[0].sinceMs, 15 * 60 * 1000);
  assert.equal(await isLimited({ countFailedAttempts: async () => ({ ip: 9, email: 4 }) }, { ipHash: 'h', email: 'e' }), false);
  assert.equal(await isLimited({ countFailedAttempts: async () => ({ ip: 0, email: 5 }) }, { ipHash: 'h', email: 'e' }), true);
});

// ---------------------------------------------------------------- revocation
test('sessions: tampered, forged, expired and garbage cookies are 401 on every authenticated endpoint', async () => {
  const { u, c } = await loggedIn('admin');
  const v = c.cookie.split('=')[1];
  const [p, sig] = v.split('.');
  const S = process.env.SESSION_SECRET;
  const forged = Buffer.from(JSON.stringify({ uid: u.id, v: 1, exp: Date.now() + 1e9 })).toString('base64url');
  const expired = session.sign(S, { uid: u.id, v: 1 }, Date.now() - 100000, 10);
  const wrongKey = session.sign('another-secret-another-secret-0000', { uid: u.id, v: 1 });
  const unknownUser = session.sign(S, { uid: '00000000-0000-4000-8000-000000000000', v: 1 });
  const notUuid = session.sign(S, { uid: 'admin', v: 1 });
  for (const ck of [`vfi_admin=${p}.${sig.slice(0, -3)}AAA`, `vfi_admin=${forged}.${sig}`, `vfi_admin=${expired}`, `vfi_admin=${wrongKey}`, `vfi_admin=${unknownUser}`, `vfi_admin=${notUuid}`, 'vfi_admin=garbage', 'vfi_admin=', 'other=1']) {
    const r = await fetch(srv.base + '/api/admin/enquiries', { headers: { cookie: ck } });
    assert.equal(r.status, 401, ck);
    const s = await (await fetch(srv.base + '/api/admin/session', { headers: { cookie: ck } })).json();
    assert.equal(s.authenticated, false);
  }
  assert.equal((await c.get('/api/admin/enquiries')).status, 200);
});

test('sessions: deactivating a user revokes their live session on the very next request; reactivating does not revive a bumped one', async () => {
  const { u, c } = await loggedIn('editor');
  assert.equal((await c.get('/api/admin/enquiries')).status, 200);
  await store.updateUser(u.id, { active: false });
  assert.equal((await c.get('/api/admin/enquiries')).status, 401);
  assert.equal((await (await c.get('/api/admin/session')).json()).authenticated, false);
  await store.updateUser(u.id, { active: true, bump_session: true });
  assert.equal((await c.get('/api/admin/enquiries')).status, 401, 'old cookie has the old session_version');
  assert.equal((await client(srv.base).login(u.email)).status, 200, 'fresh login works');
});

test('sessions: bumping session_version (admin reset) logs the user out everywhere', async () => {
  const { u, c } = await loggedIn('editor');
  const c2 = client(srv.base); await c2.login(u.email);
  await store.updateUser(u.id, { bump_session: true });
  for (const x of [c, c2]) assert.equal((await x.get('/api/admin/enquiries')).status, 401);
});

test('sessions: a role change applies immediately (role is read from the database every request)', async () => {
  const { u, c } = await loggedIn('editor');
  assert.equal((await c.get('/api/admin/media')).status, 200);
  await store.updateUser(u.id, { role: 'sales' });
  assert.equal((await c.get('/api/admin/media')).status, 403);
  assert.equal((await c.get('/api/admin/enquiries')).status, 200);
});

test('logout: clears the cookie, needs the CSRF header; works without a session too', async () => {
  const { c } = await loggedIn('sales');
  assert.equal((await c.req('POST', '/api/admin/logout', { csrf: false })).status, 403);
  const r = await c.post('/api/admin/logout', {});
  assert.equal(r.status, 200);
  const sc = r.headers.get('set-cookie');
  assert.ok(sc.startsWith('vfi_admin=;') && sc.includes('Max-Age=0'));
  assert.equal((await client(srv.base).post('/api/admin/logout', {})).status, 200);
});

// ---------------------------------------------------------------- password change & gating
test('password change: policy, wrong current, success re-issues cookie, bumps session_version, old cookie revoked', async () => {
  const { u, c } = await loggedIn('editor');
  const short = await c.post('/api/admin/password', { current: PASSWORD, next: 'short' });
  assert.equal(short.status, 422);
  assert.ok((await short.json()).errors.next);
  const wrong = await c.post('/api/admin/password', { current: 'not my password', next: 'a brand new long password' });
  assert.equal(wrong.status, 422);
  assert.ok((await wrong.json()).errors.current);
  const same = await c.post('/api/admin/password', { current: PASSWORD, next: PASSWORD });
  assert.equal(same.status, 422);
  assert.equal((await c.post('/api/admin/password', { current: PASSWORD })).status, 422);
  const oldCookie = c.cookie;
  const ok = await c.post('/api/admin/password', { current: PASSWORD, next: 'a brand new long password' });
  assert.equal(ok.status, 200);
  assert.ok(ok.headers.get('set-cookie').includes('vfi_admin='));
  assert.notEqual(c.cookie, oldCookie);
  assert.equal((await c.get('/api/admin/enquiries')).status, 200, 'new cookie works');
  assert.equal((await fetch(srv.base + '/api/admin/enquiries', { headers: { cookie: oldCookie } })).status, 401, 'old cookie revoked');
  assert.equal((await client(srv.base).login(u.email, PASSWORD)).status, 401);
  assert.equal((await client(srv.base).login(u.email, 'a brand new long password')).status, 200);
  assert.deepEqual((await store.listAudit({ limit: 200 })).rows.filter((x) => x.target === u.email && x.action.startsWith('password')).map((x) => x.action).sort(), ['password_change', 'password_change_failed']);
});

test('must_change_password: only session, logout and password work until the password is changed', async () => {
  const u = await mk('admin', { must_change_password: true });
  const c = client(srv.base);
  const lr = await c.login(u.email);
  assert.equal(lr.status, 200);
  assert.equal((await lr.json()).user.must_change_password, true);
  assert.equal((await (await c.get('/api/admin/session')).json()).user.must_change_password, true);
  const blocked = [
    ['GET', 'enquiries'], ['GET', 'export'], ['GET', 'content'], ['PUT', 'content'], ['POST', 'publish'], ['GET', 'revisions'], ['GET', 'revision?id=1'], ['POST', 'rollback'],
    ['POST', 'discard'], ['GET', 'media'], ['POST', 'media'], ['DELETE', 'media?id=x'], ['GET', 'users'], ['POST', 'users'], ['PATCH', 'users'], ['GET', 'audit'], ['PATCH', 'account'],
  ];
  for (const [m, a] of blocked) {
    const r = await c.req(m, `/api/admin/${a}`, { body: m === 'GET' || m === 'DELETE' ? undefined : {} });
    assert.equal(r.status, 403, `${m} ${a}`);
    assert.equal((await r.json()).code, 'password_change_required', `${m} ${a}`);
  }
  assert.equal((await (await c.get('/api/content?draft=1')).json()).code, 'password_change_required');
  assert.equal((await c.post('/api/admin/password', { current: PASSWORD, next: 'my own long password' })).status, 200);
  assert.equal((await c.get('/api/admin/enquiries')).status, 200);
  assert.equal((await (await c.get('/api/admin/session')).json()).user.must_change_password, false);
});

test('account: users can change their own name only', async () => {
  const { u, c } = await loggedIn('sales');
  const r = await c.patch('/api/admin/account', { name: '  New Name  ', role: 'admin' });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.user.name, 'New Name'); assert.equal(j.user.role, 'sales');
  assert.equal((await store.getUserById(u.id)).role, 'sales');
  assert.equal((await c.patch('/api/admin/account', { name: 'x'.repeat(121) })).status, 422);
  assert.equal((await c.patch('/api/admin/account', {})).status, 422);
});

// ---------------------------------------------------------------- configuration
test('SESSION_SECRET missing or shorter than 32 characters: login 503 admin_not_configured, no cookie, authenticated endpoints 503', async () => {
  const u = await mk();
  const { c } = await loggedIn('admin');
  await quiet(async () => {
    for (const secret of [undefined, '', 'x'.repeat(31)]) {
      await withEnv({ SESSION_SECRET: secret }, async () => {
        const r = await client(srv.base).login(u.email);
        assert.equal(r.status, 503);
        assert.equal((await r.json()).code, 'admin_not_configured');
        assert.equal(r.headers.get('set-cookie'), null);
        const e = await c.get('/api/admin/enquiries');
        assert.equal(e.status, 503);
        assert.equal((await e.json()).code, 'admin_not_configured');
        assert.equal((await (await c.get('/api/admin/session')).json()).authenticated, false);
      });
    }
    await withEnv({ SESSION_SECRET: 'x'.repeat(32) }, async () => assert.equal((await client(srv.base).login(u.email)).status, 200));
  });
});

test('changing SESSION_SECRET logs everyone out', async () => {
  const { c } = await loggedIn('editor');
  assert.equal((await c.get('/api/admin/enquiries')).status, 200);
  await withEnv({ SESSION_SECRET: 'z'.repeat(40) }, async () => assert.equal((await c.get('/api/admin/enquiries')).status, 401));
  assert.equal((await c.get('/api/admin/enquiries')).status, 200);
});

test('store unavailable: login and authenticated calls answer 503 unavailable with no internals', async () => {
  const { c } = await loggedIn('editor');
  const orig = { g: store.getUserById, e: store.getUserByEmail, c: store.countFailedAttempts };
  const fail = async () => { const e = new Error('connect ECONNREFUSED 10.1.2.3:5432 secrethost'); e.code = 'unavailable'; throw e; };
  store.getUserById = fail; store.getUserByEmail = fail; store.countFailedAttempts = fail;
  try {
    await quiet(async () => {
      const r = await c.get('/api/admin/enquiries');
      assert.equal(r.status, 503);
      const t = await r.text();
      assert.equal(JSON.parse(t).code, 'unavailable');
      assert.ok(!/secrethost|ECONNREFUSED|10\.1\.2\.3/.test(t));
      const l = await client(srv.base).login('someone@example.com');
      assert.equal(l.status, 503);
      assert.equal((await l.json()).code, 'unavailable');
    });
  } finally { store.getUserById = orig.g; store.getUserByEmail = orig.e; store.countFailedAttempts = orig.c; }
});

test('handler works Vercel-style (req.query.action, req.body object/string)', async () => {
  const u = await mk();
  const res = mockRes();
  await adminHandler(mockReq({ method: 'POST', query: { action: 'login' }, headers: { 'content-type': 'application/json', 'x-requested-with': 'vfi-admin', 'x-forwarded-for': freshIp() }, body: JSON.stringify({ email: u.email, password: PASSWORD }) }), res);
  assert.equal(res.statusCode, 200);
  assert.ok(String(res.getHeader('set-cookie')).startsWith('vfi_admin='));
  const res2 = mockRes();
  await adminHandler(mockReq({ method: 'GET', query: { action: 'session' } }), res2);
  assert.deepEqual(res2.json(), { ok: true, authenticated: false });
  const res3 = mockRes();
  await adminHandler(mockReq({ method: 'GET', url: '/api/admin/nope' }), res3);
  assert.equal(res3.statusCode, 404);
});

test('method checks and unknown actions', async () => {
  const { c } = await loggedIn('admin');
  const m1 = await c.post('/api/admin/export', {});
  assert.equal(m1.status, 405); assert.equal(m1.headers.get('allow'), 'GET');
  const m2 = await c.get('/api/admin/login');
  assert.equal(m2.status, 405); assert.equal(m2.headers.get('allow'), 'POST');
  assert.equal((await c.del('/api/admin/enquiries')).status, 405);
  assert.equal((await c.get('/api/admin/nope')).status, 404);
  for (const a of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) assert.equal((await c.get(`/api/admin/${a}`)).status, 404, a);
});
