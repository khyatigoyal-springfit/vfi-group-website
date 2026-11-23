'use strict';
// Self-migrating startup: migrations + bootstrap admin + content seed, all inside ONE transaction guarded by
// pg_advisory_xact_lock(727001). Concurrent instances serialise on the lock; the late ones find nothing to do.
// (The transaction-scoped lock also works through Neon's pooled, transaction-mode connection strings.)
const fs = require('fs');
const path = require('path');
const { hashPassword } = require('../auth/password');
const { loadDefaultContent } = require('../content/defaults');

const LOCK_ID = 727001;
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'db', 'migrations');

function listMigrations(dir = MIGRATIONS_DIR) {
  return fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort()
    .map((f) => ({ version: f.replace(/\.sql$/, ''), sql: fs.readFileSync(path.join(dir, f), 'utf8') }));
}

async function applyMigrations(client, dir) {
  await client.query('create table if not exists schema_migrations (version text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await client.query('select version from schema_migrations')).rows.map((r) => r.version));
  const applied = [];
  for (const m of listMigrations(dir)) {
    if (done.has(m.version)) continue;
    await client.query(m.sql);
    await client.query('insert into schema_migrations (version) values ($1)', [m.version]);
    applied.push(m.version);
  }
  return applied;
}

/** Create the first admin when users is empty and both env vars are set. The password is never logged. */
async function bootstrapAdmin(client, env) {
  const email = String(env.BOOTSTRAP_ADMIN_EMAIL || '').trim().toLowerCase();
  const password = env.BOOTSTRAP_ADMIN_PASSWORD || '';
  if (!email || !password) return false;
  const { rows } = await client.query('select 1 from users limit 1');
  if (rows.length) return false;
  const hash = await hashPassword(password);
  await client.query(
    `insert into users (email, name, role, password_hash, must_change_password) values ($1, $2, 'admin', $3, true)`,
    [email, 'Administrator', hash],
  );
  return true;
}

/** Insert the bundled defaults as revision #1 and as the draft, when content_state is empty. */
async function seedContent(client) {
  const { rows } = await client.query('select 1 from content_state where id = 1');
  if (rows.length) return false;
  const json = JSON.stringify(loadDefaultContent());
  const rev = await client.query(
    `insert into content_revisions (data, note, published_by) values ($1::jsonb, 'Initial content', null) returning id`, [json]);
  await client.query(
    `insert into content_state (id, draft, draft_updated_at, draft_updated_by, published_revision)
     values (1, $1::jsonb, date_trunc('milliseconds', clock_timestamp()), null, $2)`, [json, rev.rows[0].id]);
  return true;
}

/** Run everything. Safe to call repeatedly and from several instances at once. */
async function prepareDatabase(pool, env = process.env, opts = {}) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock($1)', [LOCK_ID]);
    const applied = await applyMigrations(client, opts.dir);
    const bootstrapped = await bootstrapAdmin(client, env);
    const seeded = await seedContent(client);
    await client.query('commit');
    return { applied, bootstrapped, seeded };
  } catch (e) {
    try { await client.query('rollback'); } catch (e2) { /* connection already gone */ }
    throw e;
  } finally {
    client.release();
  }
}

module.exports = { prepareDatabase, applyMigrations, bootstrapAdmin, seedContent, listMigrations, LOCK_ID };
