-- VFI Group website: hardening. Apply AFTER 0001_init.sql (0001 is never edited). Safe to re-run. Contains NO secrets.
--  * submit_enquiry now requires the same server-held secret as the admin RPCs (private.assert_admin), so the public
--    anon key alone can no longer insert rows or burn another visitor's rate-limit budget.
--  * ip_hash is mandatory (empty => invalid_input), so the rate limit cannot be bypassed by omitting it.
--  * Text cleaning matches lib/validate.js (strips \r too; single-line fields collapse [\r\n\t]+ to one space).
--  * Email regex rejects consecutive dots, leading/trailing dots in the domain and spaces.
--  * Export is capped at 2000 rows.

-- ---------------------------------------------------------------- helpers
-- Multi-line text: strip control chars (including \r; \n and \t are kept) and trim whitespace.
create or replace function private.clean_text(p text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.regexp_replace(
           pg_catalog.regexp_replace(coalesce(p, ''), '[\x01-\x08\x0B-\x1F\x7F]', '', 'g'),
           '^[[:space:]]+|[[:space:]]+$', '', 'g');
$$;

-- Single-line text: clean_text, then collapse runs of [\r\n\t] to a single space (\r is already stripped).
create or replace function private.clean_line(p text)
returns text
language sql
immutable
security definer
set search_path = ''
as $$
  select pg_catalog.regexp_replace(private.clean_text(p), '[\r\n\t]+', ' ', 'g');
$$;

revoke all on function private.clean_text(text) from public, anon, authenticated;
revoke all on function private.clean_line(text) from public, anon, authenticated;

-- ---------------------------------------------------------------- submit_enquiry (secret-protected)
-- Drop the old one-argument version (callable with the anon key alone) and create the two-argument one.
drop function if exists public.submit_enquiry(jsonb);

create or replace function public.submit_enquiry(p_secret text, p jsonb)
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
  perform private.assert_admin(p_secret);

  if p is null or pg_catalog.jsonb_typeof(p) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  v_type    := private.clean_line(p ->> 'type');
  v_name    := private.clean_line(p ->> 'name');
  v_company := private.clean_line(p ->> 'company');
  v_email   := private.clean_line(p ->> 'email');
  v_country := private.clean_line(p ->> 'country');
  v_volume  := private.clean_line(p ->> 'volume');
  v_message := private.clean_text(p ->> 'message');
  v_page    := private.clean_line(p ->> 'source_page');
  v_ip      := pg_catalog.left(private.clean_line(p ->> 'ip_hash'), 128);
  v_ua      := pg_catalog.left(private.clean_line(p ->> 'user_agent'), 300);

  if v_type not in ('Retail partnership','Hospitality','OEM manufacturing','Private label','Foam supply','International','Careers','Other')
     or v_volume not in ('','Exploring options','Under 500 units a month','500 to 2,000 units a month','Over 2,000 units a month')
     or pg_catalog.char_length(v_name) not between 1 and 120
     or pg_catalog.char_length(v_company) not between 1 and 160
     or pg_catalog.char_length(v_email) not between 1 and 200
     or v_email !~ '^[^\s@]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+$'
     or pg_catalog.strpos(v_email, '..') > 0
     or pg_catalog.char_length(v_country) > 80
     or pg_catalog.char_length(v_message) not between 1 and 5000
     or pg_catalog.char_length(v_page) > 200
  then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  if v_ip = '' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- serialise concurrent submissions from the same client so the limit cannot be raced
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(v_ip));
  if (select pg_catalog.count(*) from public.enquiries e
       where e.ip_hash = v_ip and e.created_at > pg_catalog.now() - interval '10 minutes') >= 5 then
    raise exception 'rate_limited' using errcode = 'P0429';
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
    limit 2000
  ) t;
  return v_rows;
end;
$$;


-- ---------------------------------------------------------------- privileges
revoke all on function public.submit_enquiry(text, jsonb) from public, anon, authenticated;
revoke all on function public.admin_export_enquiries(text, text, text) from public, anon, authenticated;
grant execute on function public.submit_enquiry(text, jsonb) to anon;
grant execute on function public.admin_export_enquiries(text, text, text) to anon;
