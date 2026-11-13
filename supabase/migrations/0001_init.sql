-- VFI Group website: enquiries schema + RPC functions.
-- Safe to re-run. Contains NO secrets: insert the admin secret hash separately (see README).
-- Access model: tables are locked (RLS on, no policies, no grants). The API only calls the
-- SECURITY DEFINER functions below with the anon key; admin functions also need the admin secret.

create extension if not exists pgcrypto with schema extensions;
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- ---------------------------------------------------------------- tables
create table if not exists public.enquiries (
  id          uuid primary key default gen_random_uuid(),
  ref         text not null unique,
  type        text not null,
  name        text not null,
  company     text not null,
  email       text not null,
  country     text not null default '',
  volume      text not null default '',
  message     text not null,
  source_page text not null default '',
  ip_hash     text not null default '',
  user_agent  text not null default '',
  status      text not null default 'new' check (status in ('new','in_progress','contacted','closed','spam')),
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists enquiries_created_at_idx on public.enquiries (created_at desc);
create index if not exists enquiries_status_created_at_idx on public.enquiries (status, created_at desc);
create index if not exists enquiries_ip_hash_created_at_idx on public.enquiries (ip_hash, created_at desc);
alter table public.enquiries enable row level security;   -- no policies on purpose
revoke all on public.enquiries from public, anon, authenticated;

create table if not exists private.app_secrets (
  name text primary key,
  hash text not null
);
alter table private.app_secrets enable row level security;
revoke all on private.app_secrets from public, anon, authenticated;

-- ---------------------------------------------------------------- helpers (not callable by anon)
create or replace function private.clean_text(p text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p, ''), '[\x01-\x08\x0B\x0C\x0E-\x1F\x7F]', '', 'g'));
$$;

create or replace function private.assert_admin(p_secret text)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_secret is null or p_secret = '' or not exists (
    select 1 from private.app_secrets s
    where s.name = 'admin_api'
      and s.hash = pg_catalog.encode(extensions.digest(p_secret, 'sha256'), 'hex')
  ) then
    raise exception 'forbidden' using errcode = 'P0403';
  end if;
end;
$$;

-- ---------------------------------------------------------------- submit_enquiry
create or replace function public.submit_enquiry(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_type    text;
  v_name    text;
  v_company text;
  v_email   text;
  v_country text;
  v_volume  text;
  v_message text;
  v_page    text;
  v_ip      text;
  v_ua      text;
  v_ref     text;
  v_id      uuid;
  v_tries   int := 0;
begin
  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  v_type    := private.clean_text(p ->> 'type');
  v_name    := private.clean_text(p ->> 'name');
  v_company := private.clean_text(p ->> 'company');
  v_email   := private.clean_text(p ->> 'email');
  v_country := private.clean_text(p ->> 'country');
  v_volume  := private.clean_text(p ->> 'volume');
  v_message := private.clean_text(p ->> 'message');
  v_page    := private.clean_text(p ->> 'source_page');
  v_ip      := pg_catalog.left(private.clean_text(p ->> 'ip_hash'), 128);
  v_ua      := pg_catalog.left(private.clean_text(p ->> 'user_agent'), 300);

  if v_type not in ('Retail partnership','Hospitality','OEM manufacturing','Private label','Foam supply','International','Careers','Other')
     or v_volume not in ('','Exploring options','Under 500 units a month','500 to 2,000 units a month','Over 2,000 units a month')
     or pg_catalog.char_length(v_name) not between 1 and 120
     or pg_catalog.char_length(v_company) not between 1 and 160
     or pg_catalog.char_length(v_email) not between 1 and 200
     or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or pg_catalog.char_length(v_country) > 80
     or pg_catalog.char_length(v_message) not between 1 and 5000
     or pg_catalog.char_length(v_page) > 200
  then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if v_ip <> '' then
    -- serialise concurrent submissions from the same client so the limit cannot be raced
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_ip));
    if (select pg_catalog.count(*) from public.enquiries e
         where e.ip_hash = v_ip and e.created_at > pg_catalog.now() - interval '10 minutes') >= 5 then
      raise exception 'rate_limited' using errcode = 'P0429';
    end if;
  end if;

  loop
    v_ref := 'VFI-' || pg_catalog.to_char(pg_catalog.now() at time zone 'Asia/Kolkata', 'YYMMDD') || '-'
             || pg_catalog.upper(pg_catalog.substr(pg_catalog.encode(extensions.gen_random_bytes(3), 'hex'), 1, 6));
    begin
      insert into public.enquiries (ref, type, name, company, email, country, volume, message, source_page, ip_hash, user_agent)
      values (v_ref, v_type, v_name, v_company, v_email, v_country, v_volume, v_message, v_page, v_ip, v_ua)
      returning id into v_id;
      exit;
    exception when unique_violation then
      v_tries := v_tries + 1;
      if v_tries >= 5 then raise; end if;
    end;
  end loop;

  return pg_catalog.jsonb_build_object('ref', v_ref, 'id', v_id);
end;
$$;

-- ---------------------------------------------------------------- admin_list_enquiries
create or replace function public.admin_list_enquiries(
  p_secret text, p_status text, p_q text, p_limit int, p_offset int
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := coalesce(nullif(p_status, ''), 'active');
  v_like   text;
  v_limit  int  := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  v_rows   jsonb;
  v_total  bigint;
  v_counts jsonb;
begin
  perform private.assert_admin(p_secret);
  if v_status not in ('active','all','new','in_progress','contacted','closed','spam') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_like := case when pg_catalog.btrim(coalesce(p_q, '')) = '' then null
    else '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  select pg_catalog.count(*) into v_total
  from public.enquiries e
  where (v_status = 'all' or (v_status = 'active' and e.status <> 'spam') or e.status = v_status)
    and (v_like is null or e.ref ilike v_like escape '\' or e.name ilike v_like escape '\' or e.company ilike v_like escape '\'
         or e.email ilike v_like escape '\' or e.country ilike v_like escape '\' or e.message ilike v_like escape '\');

  select coalesce(pg_catalog.jsonb_agg((pg_catalog.to_jsonb(t) - 'ip_hash') order by t.created_at desc, t.id), '[]'::jsonb) into v_rows
  from (
    select e.* from public.enquiries e
    where (v_status = 'all' or (v_status = 'active' and e.status <> 'spam') or e.status = v_status)
      and (v_like is null or e.ref ilike v_like escape '\' or e.name ilike v_like escape '\' or e.company ilike v_like escape '\'
           or e.email ilike v_like escape '\' or e.country ilike v_like escape '\' or e.message ilike v_like escape '\')
    order by e.created_at desc, e.id
    limit v_limit offset v_offset
  ) t;

  -- tab counts honour the search text but not the status filter
  select pg_catalog.jsonb_build_object(
    'new',         pg_catalog.count(*) filter (where e.status = 'new'),
    'in_progress', pg_catalog.count(*) filter (where e.status = 'in_progress'),
    'contacted',   pg_catalog.count(*) filter (where e.status = 'contacted'),
    'closed',      pg_catalog.count(*) filter (where e.status = 'closed'),
    'spam',        pg_catalog.count(*) filter (where e.status = 'spam'))
  into v_counts
  from public.enquiries e
  where v_like is null or e.ref ilike v_like escape '\' or e.name ilike v_like escape '\' or e.company ilike v_like escape '\'
        or e.email ilike v_like escape '\' or e.country ilike v_like escape '\' or e.message ilike v_like escape '\';

  return pg_catalog.jsonb_build_object('rows', v_rows, 'total', v_total, 'counts', v_counts);
end;
$$;

-- ---------------------------------------------------------------- admin_update_enquiry
create or replace function public.admin_update_enquiry(
  p_secret text, p_id uuid, p_status text, p_notes text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.enquiries;
begin
  perform private.assert_admin(p_secret);
  if p_status is not null and p_status not in ('new','in_progress','contacted','closed','spam') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_notes is not null and pg_catalog.char_length(p_notes) > 5000 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  update public.enquiries e
     set status = coalesce(p_status, e.status),
         notes = coalesce(p_notes, e.notes),
         updated_at = pg_catalog.now()
   where e.id = p_id
  returning e.* into v_row;

  if not found then
    raise exception 'not_found' using errcode = 'P0404';
  end if;
  return pg_catalog.to_jsonb(v_row) - 'ip_hash';
end;
$$;

-- ---------------------------------------------------------------- admin_export_enquiries
create or replace function public.admin_export_enquiries(
  p_secret text, p_status text, p_q text
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status text := coalesce(nullif(p_status, ''), 'active');
  v_like   text;
  v_rows   jsonb;
begin
  perform private.assert_admin(p_secret);
  if v_status not in ('active','all','new','in_progress','contacted','closed','spam') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  v_like := case when pg_catalog.btrim(coalesce(p_q, '')) = '' then null
    else '%' || pg_catalog.replace(pg_catalog.replace(pg_catalog.replace(pg_catalog.btrim(p_q), '\', '\\'), '%', '\%'), '_', '\_') || '%' end;

  select coalesce(pg_catalog.jsonb_agg((pg_catalog.to_jsonb(t) - 'ip_hash') order by t.created_at desc, t.id), '[]'::jsonb) into v_rows
  from (
    select e.* from public.enquiries e
    where (v_status = 'all' or (v_status = 'active' and e.status <> 'spam') or e.status = v_status)
      and (v_like is null or e.ref ilike v_like escape '\' or e.name ilike v_like escape '\' or e.company ilike v_like escape '\'
           or e.email ilike v_like escape '\' or e.country ilike v_like escape '\' or e.message ilike v_like escape '\')
    order by e.created_at desc, e.id
    limit 5000
  ) t;
  return v_rows;
end;
$$;

-- ---------------------------------------------------------------- privileges
-- Supabase grants EXECUTE on new public functions to anon/authenticated by default; reset, then allow anon only.
revoke all on function private.clean_text(text) from public, anon, authenticated;
revoke all on function private.assert_admin(text) from public, anon, authenticated;
revoke all on function public.submit_enquiry(jsonb) from public, anon, authenticated;
revoke all on function public.admin_list_enquiries(text, text, text, int, int) from public, anon, authenticated;
revoke all on function public.admin_update_enquiry(text, uuid, text, text) from public, anon, authenticated;
revoke all on function public.admin_export_enquiries(text, text, text) from public, anon, authenticated;

grant execute on function public.submit_enquiry(jsonb) to anon;
grant execute on function public.admin_list_enquiries(text, text, text, int, int) to anon;
grant execute on function public.admin_update_enquiry(text, uuid, text, text) to anon;
grant execute on function public.admin_export_enquiries(text, text, text) to anon;
