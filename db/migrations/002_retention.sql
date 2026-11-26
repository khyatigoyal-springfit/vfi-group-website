-- Retention and rate-limit support: indexes so the opportunistic prune and the (email, ip) login counts stay cheap.
-- Applied automatically by lib/db/migrate.js. Contains NO secrets.
create index if not exists login_attempts_at on login_attempts (at);
create index if not exists login_attempts_email_ip_at on login_attempts (email, ip_hash, at desc);
