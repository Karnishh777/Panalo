-- ============================================================================
-- PANALO — Phase 40: safety fixes from the review (v0.3)
-- ============================================================================
--
-- Run after phase 39. Safe to re-run.
--
-- 1. The consent gate fails closed: an account with no date of birth on
--    record can't store anything (it was allowed before). The app asks for
--    the date first, so nobody who has one notices.
-- 2. A parent's "no" stands: after a decline, a different parent's email
--    can't be asked instead; the parent who declined can still say yes.
-- 3. Pan checks consent too, and the whole service has a daily cap of AI
--    asks (private.pan_settings.daily_cap, 1500 by default).
-- 4. Erasing an account (deleting it, or a parent withdrawing consent)
--    queues the person's uploaded files; the erase-files function removes
--    them through the Storage API (Storage won't let SQL delete them).
-- ============================================================================

-- ############################################################################
-- PART 1 — the consent gate fails closed
-- ############################################################################

-- May this person store anything? They've given a date of birth, and are an
-- adult or a minor whose parent agreed. (may_process() stays as it was: the
-- parent's own check, whose age is given in the consent form itself.)
create or replace function private.may_store(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.account_age a where a.user_id = p_user)
     and private.may_process(p_user)
$$;
revoke execute on function private.may_store(uuid) from public, anon, authenticated;

create or replace function private.require_consent()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  who uuid;
begin
  -- Separate statements: a field of NEW is only looked up when its branch
  -- runs, and not every table has every column.
  if tg_table_name = 'conversation_participants' then
    who := new.user_id;
  elsif tg_table_name = 'conversations' then
    who := coalesce(new.created_by, auth.uid());
  elsif tg_table_name = 'resources' then
    who := new.owner_id;
  else
    who := coalesce(auth.uid(), new.user_id);
  end if;
  if who is not null and not private.may_store(who) then
    raise exception 'A parent or guardian needs to agree before Panalo can be used.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.require_consent() from public, anon, authenticated;

create or replace function private.require_consent_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.may_store(new.owner_id) then
    raise exception 'A parent or guardian needs to agree before Panalo can be used.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.require_consent_owner() from public, anon, authenticated;


-- ############################################################################
-- PART 2 — a parent's "no" stands
-- ############################################################################

create or replace function public.request_parent_consent(p_parent_email text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me    uuid := auth.uid();
  mail  text := lower(btrim(p_parent_email));
  mine  text;
  row   public.account_age;
begin
  select * into row from public.account_age where user_id = me;
  if row.user_id is null or private.age_years(row.birth_year, row.birth_month) >= 18 then
    raise exception 'You don''t need a parent''s consent.' using errcode = '22023';
  end if;
  if row.consent = 'approved' then
    raise exception 'A parent has already agreed.' using errcode = '22023';
  end if;
  -- A parent's "no" stands: only the parent who said it can change it
  -- (from their own link). Asking someone else instead isn't possible.
  if row.consent = 'declined' and lower(btrim(p_parent_email)) is distinct from row.parent_email then
    raise exception 'Your parent or guardian said no. Only they can change that, from the link in their email.' using errcode = '42501';
  end if;
  if mail is null or mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]{2,}$' then
    raise exception 'Enter your parent''s email address.' using errcode = '22023';
  end if;
  select lower(u.email) into mine from auth.users u where u.id = me;
  if mail = mine then
    raise exception 'That''s your own email. Enter your parent''s.' using errcode = '22023';
  end if;
  if row.requested_at is not null and row.requested_at > now() - interval '2 minutes' and row.parent_email is not distinct from mail then
    raise exception 'Wait a couple of minutes before asking again.' using errcode = '54000';
  end if;
  update public.account_age
     set parent_email = mail, requested_at = now(),
         consent = consent
   where user_id = me;
end;
$$;


-- ############################################################################
-- PART 3 — Pan: consent, and a cap for the whole service
-- ############################################################################

create table if not exists private.pan_settings (
  id        boolean primary key default true check (id),
  daily_cap integer not null default 1500 check (daily_cap >= 0)
);
insert into private.pan_settings default values on conflict (id) do nothing;
revoke all on private.pan_settings from public, anon, authenticated;

create table if not exists private.pan_global (
  day  date primary key,
  asks integer not null default 0
);
revoke all on private.pan_global from public, anon, authenticated;

create or replace function public.pan_take()
returns integer
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  today date := (now() at time zone 'utc')::date;
  n integer;
  total integer;
begin
  if auth.uid() is null or not private.may_store(auth.uid()) then
    return -1;
  end if;
  -- The whole service's day: past the cap, nobody gets more until
  -- tomorrow (UTC), so the AI bill can't run away.
  insert into private.pan_global (day, asks) values (today, 1)
  on conflict (day) do update set asks = private.pan_global.asks + 1
  returning asks into total;
  if total > (select daily_cap from private.pan_settings where id) then
    return -1;
  end if;
  insert into public.pan_usage (user_id, day, asks)
  values (auth.uid(), today, 1)
  on conflict (user_id, day) do update set asks = public.pan_usage.asks + 1
  returning asks into n;
  delete from public.pan_usage where user_id = auth.uid() and day < today - 7;
  return 30 - n;
end;
$$;
revoke execute on function public.pan_take() from public, anon;
grant execute on function public.pan_take() to authenticated;


-- ############################################################################
-- PART 4 — erased accounts' files
-- ############################################################################

create table if not exists private.file_erasure (
  id        bigserial primary key,
  bucket    text not null,
  name      text not null,
  owner     uuid not null,
  queued_at timestamptz not null default now(),
  unique (bucket, name)
);
revoke all on private.file_erasure from public, anon, authenticated;

create or replace function private.erase_account(p_user uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into private.deleted_registrations (user_id, email, username, registered_at)
  select u.id, u.email, p.username, u.created_at
  from auth.users u left join public.profiles p on p.id = u.id
  where u.id = p_user
  on conflict (user_id) do nothing;

  delete from public.conversations c
  where exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id = p_user)
    and not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id <> p_user);

  if to_regclass('auth.audit_log_entries') is not null then
    execute 'delete from auth.audit_log_entries where payload ->> ''actor_id'' = $1' using p_user::text;
  end if;

  -- Their uploaded files: Storage can only delete them through its own API,
  -- so they're queued and the erase-files function removes them (within
  -- minutes; supabase/functions/erase-files).
  insert into private.file_erasure (bucket, name, owner)
  select o.bucket_id, o.name, p_user from storage.objects o where o.owner = p_user
  on conflict do nothing;

  delete from auth.users where id = p_user;
end;
$$;
revoke execute on function private.erase_account(uuid) from public, anon, authenticated;

-- For the erase-files function only (it runs with the service role): the
-- next files to remove, and marking them removed.
create or replace function public.file_erasure_next(p_limit integer default 200)
returns table (id bigint, bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select f.id, f.bucket, f.name from private.file_erasure f order by f.id limit least(greatest(p_limit, 1), 1000)
$$;
create or replace function public.file_erasure_done(p_ids bigint[])
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (delete from private.file_erasure where id = any(p_ids) returning 1)
  select count(*)::int from gone
$$;
revoke execute on function public.file_erasure_next(integer), public.file_erasure_done(bigint[]) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.file_erasure_next(integer), public.file_erasure_done(bigint[]) to service_role;
  end if;
end;
$$;


-- ############################################################################
-- Verify
-- ############################################################################
select 'consent gate fails closed' as check_name,
       case when private.may_store('00000000-0000-0000-0000-000000000000'::uuid) then 'NO' else 'yes' end as result;

-- Done. ✅
