'use strict';
// Shared pg Pool, one per connection string, kept at module scope so warm serverless instances reuse it.
const { Pool } = require('pg');

const pools = new Map();

/** Neon (and any URL asking for sslmode=require) gets verified TLS; local Postgres stays plain. */
function wantsSsl(url) {
  try {
    const u = new URL(url);
    const mode = (u.searchParams.get('sslmode') || '').toLowerCase();
    if (mode && mode !== 'disable') return true;
    return /\.neon\.tech$/i.test(u.hostname);
  } catch (e) {
    return /sslmode=(require|verify)/i.test(url) || /\.neon\.tech/i.test(url);
  }
}

/** Remove sslmode from the URL so our explicit `ssl` option is the only TLS setting. */
function cleanUrl(url) {
  try {
    const u = new URL(url);
    u.searchParams.delete('sslmode');
    return u.toString();
  } catch (e) { return url; }
}

function poolConfig(url) {
  return {
    connectionString: cleanUrl(url),
    ssl: wantsSsl(url) ? { rejectUnauthorized: true } : undefined,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    statement_timeout: 10000,
    allowExitOnIdle: true,
  };
}

function getPool(url) {
  if (!url) throw new Error('DATABASE_URL is not set');
  let p = pools.get(url);
  if (!p) {
    p = new Pool(poolConfig(url));
    p.on('error', () => { /* idle client errors must not crash the process */ });
    pools.set(url, p);
  }
  return p;
}

async function closePools() {
  const all = [...pools.values()];
  pools.clear();
  await Promise.all(all.map((p) => p.end().catch(() => {})));
}

module.exports = { getPool, closePools, wantsSsl, cleanUrl, poolConfig };
