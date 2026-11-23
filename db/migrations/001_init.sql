-- VFI Group website: initial schema (users, login attempts, enquiries, content, media, audit).
-- Applied automatically by lib/db/migrate.js under an advisory lock. Contains NO secrets.
-- gen_random_uuid() is built into Postgres 13+.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  name text not null default '',
  role text not null check (role in ('admin','editor','sales')),
  password_hash text not null,
  must_change_password boolean not null default false,
  active boolean not null default true,
  session_version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table if not exists login_attempts (
  id bigserial primary key,
  ip_hash text not null,
  email text not null default '',
  ok boolean not null,
  at timestamptz not null default now()
);
create index if not exists login_attempts_ip_at on login_attempts (ip_hash, at desc);
create index if not exists login_attempts_email_at on login_attempts (email, at desc);

create table if not exists enquiries (
  id uuid primary key default gen_random_uuid(),
  ref text not null unique,
  type text not null,
  name text not null,
  company text not null,
  email text not null,
  country text not null default '',
  volume text not null default '',
  message text not null,
  source_page text not null default '',
  ip_hash text not null default '',
  user_agent text not null default '',
  status text not null default 'new' check (status in ('new','in_progress','contacted','closed','spam')),
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists enquiries_created_at_idx on enquiries (created_at desc);
create index if not exists enquiries_status_created_at_idx on enquiries (status, created_at desc);
create index if not exists enquiries_ip_hash_created_at_idx on enquiries (ip_hash, created_at desc);

create table if not exists content_revisions (
  id serial primary key,
  data jsonb not null,
  note text not null default '',
  published_by uuid references users(id),
  published_at timestamptz not null default now()
);

create table if not exists content_state (
  id int primary key check (id = 1),
  draft jsonb not null,
  draft_updated_at timestamptz not null default now(),
  draft_updated_by uuid references users(id),
  published_revision int not null references content_revisions(id)
);

create table if not exists media (
  id uuid primary key default gen_random_uuid(),
  url text not null,
  pathname text not null,
  content_type text not null,
  size int not null,
  width int,
  height int,
  alt text not null default '',
  uploaded_by uuid references users(id),
  created_at timestamptz not null default now()
);
create index if not exists media_created_at on media (created_at desc);

create table if not exists audit_log (
  id bigserial primary key,
  user_id uuid references users(id),
  action text not null,
  target text not null default '',
  detail jsonb not null default '{}',
  at timestamptz not null default now()
);
create index if not exists audit_log_at on audit_log (at desc);
