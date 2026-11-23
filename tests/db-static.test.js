'use strict';
// Static checks on the database layer (no database needed).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { wantsSsl, cleanUrl, poolConfig } = require('../lib/db/pool');

const root = path.join(__dirname, '..');

test('no string-concatenated SQL: query text is a literal or a module-level SQL_* constant', () => {
  for (const f of ['lib/db/store.js', 'lib/db/migrate.js']) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    // every query(...) first argument must be a plain string/template literal without ${}, or an identifier
    const calls = src.match(/\.query\(\s*[^,)]+/g) || [];
    assert.ok(calls.length > 5, f);
    for (const c of calls) {
      const arg = c.replace(/^\.query\(\s*/, '');
      assert.ok(!/\+/.test(arg) && !/\$\{/.test(arg), `${f}: ${arg}`);
    }
    for (const m of src.matchAll(/\bq\(\s*([^,)]+)/g)) assert.ok(!/\+/.test(m[1]) && !/\$\{/.test(m[1]), `${f}: ${m[1]}`);
    for (const m of src.matchAll(/const (SQL_\w+) = `([\s\S]*?)`;/g)) {
      // only module-level constants may be interpolated into the SQL_ constants
      for (const x of m[2].matchAll(/\$\{(\w+)\}/g)) assert.ok(/^(ENQ_WHERE|NEXT_DRAFT_TS)$/.test(x[1]), x[1]);
    }
  }
});

test('migration file: idempotent statements only and no secrets', () => {
  const sql = fs.readFileSync(path.join(root, 'db', 'migrations', '001_init.sql'), 'utf8');
  for (const m of sql.matchAll(/create (table|index)[^;]*/gi)) assert.match(m[0], /if not exists/i, m[0].slice(0, 60));
  for (const t of ['users', 'login_attempts', 'enquiries', 'content_state', 'content_revisions', 'media', 'audit_log']) assert.match(sql, new RegExp(`create table if not exists ${t}\\b`));
  assert.ok(!/password\s*=|secret|token/i.test(sql.replace(/--.*$/gm, '').replace(/password_hash/g, '')));
});

test('pool: TLS for Neon and sslmode=require URLs, plain for local; max 3', () => {
  assert.equal(wantsSsl('postgres://u:p@ep-cool-123.us-east-2.aws.neon.tech/db'), true);
  assert.equal(wantsSsl('postgres://u:p@ep-cool-123-pooler.us-east-2.aws.neon.tech/db?sslmode=require'), true);
  assert.equal(wantsSsl('postgres://u:p@db.example.com:5432/db?sslmode=require'), true);
  assert.equal(wantsSsl('postgres://u:p@127.0.0.1:5432/db'), false);
  assert.equal(wantsSsl('postgres://u:p@127.0.0.1:5432/db?sslmode=disable'), false);
  const cfg = poolConfig('postgres://u:p@h.neon.tech/db?sslmode=require');
  assert.deepEqual(cfg.ssl, { rejectUnauthorized: true });
  assert.equal(cfg.max, 3);
  assert.ok(!cleanUrl('postgres://u:p@h.neon.tech/db?sslmode=require&x=1').includes('sslmode'));
  assert.equal(poolConfig('postgres://u:p@127.0.0.1/db').ssl, undefined);
});

test('removed: no Supabase or ADMIN_PASSWORD references remain in code, config or docs', () => {
  const skip = new Set(['node_modules', '.git', 'docs', 'tests', 'package-lock.json']);
  const hits = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (skip.has(e.name)) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|json|md|sql|html|example)$|^\.env/.test(e.name) && /supabase|(?<![A-Z_])ADMIN_PASSWORD/i.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(root, p));
    }
  })(root);
  assert.deepEqual(hits, []);
  assert.ok(!fs.existsSync(path.join(root, 'supabase')));
  assert.ok(!fs.existsSync(path.join(root, 'lib', 'store', 'supabase.js')));
});
