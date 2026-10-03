-- ============================================================================
-- PANALO — Phase 22: age, a parent's consent, and what the law asks us to keep
-- ============================================================================
--
-- Run after phase 21. Safe to re-run.
--
-- PART 1 — Age. Everyone gives a month and year of birth, once. Under 13:
--   Panalo isn't for you (the app offers to delete the account). 13 to 17: a
--   parent or guardian has to agree first (India's DPDP Act s.9 and DPDP
--   Rules r.10). 18 and over: nothing more. Age is worked out each time, so
--   turning 18 lifts the requirement by itself. The date can be set once by
--   its owner; after that only a moderator can change it, so a 15-year-old
--   can't become 18 by editing a field.
--
-- PART 2 — A parent's consent. The student names a parent's email. The parent
--   signs in to Panalo with a one-time code sent to that address -- which
--   proves they control it, right now -- states their name, relationship and
--   year of birth (they must be 18 or over), and approves or declines. Each
--   decision is kept in private.parental_consents. A parent can withdraw
--   consent later; the student's account is then deleted, as the Act asks.
--   (This is email-based verification. The Rules' strongest form is a
--   DigiLocker age token; see LEGAL.md.)
--
-- PART 3 — Until a parent agrees, nothing is processed. A trigger refuses to
--   store study data, messages, files, rooms or a world for a student who
--   needs consent and doesn't have it. Reports and blocks still work: safety
--   comes first.
--
-- PART 4 — Registration details are kept for 180 days after an account is
--   deleted (IT Rules 2021, r.3(1)(h)): email, username and two dates, in a
--   table nothing in the app can read, erased automatically afterwards.
--   Everything else still goes at once.
-- ============================================================================


-- ############################################################################
-- PART 1 — age
-- ############################################################################

create table if not exists public.account_age (
  user_id      uuid primary key references public.profiles (id) on delete cascade,
  birth_year   integer not null check (birth_year between 1900 and 2100),
  birth_month  integer not null check (birth_month between 1 and 12),
  consent      text not null default 'not_needed'
               check (consent in ('not_needed', 'pending', 'approved', 'declined')),
  parent_email text check (parent_email is null or (char_length(parent_email) <= 254 and parent_email like '%_@_%.__%')),
  requested_at timestamptz,
  set_at       timestamptz not null default now()
);
alter table public.account_age enable row level security;

drop policy if exists "account_age read own" on public.account_age;
create policy "account_age read own" on public.account_age
  for select to authenticated using (user_id = (select auth.uid()));
-- No insert/update/delete policies: only the functions below write here.

-- Whole years, counted conservatively: during the birth month you're still
-- the younger age.
create or replace function private.age_years(p_year integer, p_month integer)
returns integer
language sql
stable
set search_path = ''
as $$
  select (extract(year from now())::int - p_year)
         - case when extract(month from now())::int <= p_month then 1 else 0 end
$$;
revoke execute on function private.age_years(integer, integer) from public, anon, authenticated;

-- May this person's data be processed? Adults, and minors with a parent's
-- approval. Accounts that haven't given a date yet are asked by the app
-- before anything else.
create or replace function private.may_process(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from public.account_age a
    where a.user_id = p_user
      and (private.age_years(a.birth_year, a.birth_month) < 13
           or (private.age_years(a.birth_year, a.birth_month) < 18 and a.consent <> 'approved'))
  )
$$;
revoke execute on function private.may_process(uuid) from public, anon, authenticated;

-- Where the signed-in person stands.
create or replace function public.my_age_status()
returns table (needs_birth boolean, age integer, minor boolean, under13 boolean, consent text, parent_email text)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id is null,
         case when a.user_id is null then null else private.age_years(a.birth_year, a.birth_month) end,
         a.user_id is not null and private.age_years(a.birth_year, a.birth_month) < 18,
         a.user_id is not null and private.age_years(a.birth_year, a.birth_month) < 13,
         coalesce(a.consent, 'not_needed'),
         a.parent_email
  from (select auth.uid() as me) m
  left join public.account_age a on a.user_id = m.me
  where m.me is not null
$$;

-- Give a date of birth. Once.
create or replace function public.set_my_birth(p_year integer, p_month integer)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me  uuid := auth.uid();
  age integer;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if p_year is null or p_month is null or p_month not between 1 and 12
     or p_year < extract(year from now())::int - 120 or p_year > extract(year from now())::int then
    raise exception 'That date doesn''t look right.' using errcode = '22023';
  end if;
  if exists (select 1 from public.account_age where user_id = me) then
    raise exception 'Your date of birth is already set. Ask a moderator if it''s wrong.' using errcode = '42501';
  end if;
  age := private.age_years(p_year, p_month);
  insert into public.account_age (user_id, birth_year, birth_month, consent)
  values (me, p_year, p_month, case when age between 13 and 17 then 'pending' else 'not_needed' end);
  return case when age < 13 then 'under13' when age < 18 then 'needs_consent' else 'adult' end;
end;
$$;

-- A moderator corrects a date (e.g. a typo, with evidence).
create or replace function public.moderation_set_birth(p_user uuid, p_year integer, p_month integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_moderator();
begin
  update public.account_age set birth_year = p_year, birth_month = p_month,
    consent = case when private.age_years(p_year, p_month) between 13 and 17 and consent = 'not_needed' then 'pending' else consent end
  where user_id = p_user;
  if not found then
    insert into public.account_age (user_id, birth_year, birth_month, consent)
    values (p_user, p_year, p_month, case when private.age_years(p_year, p_month) between 13 and 17 then 'pending' else 'not_needed' end);
  end if;
  insert into private.moderation_log (moderator_id, action, target_user, detail)
  values (me, 'set-birth', p_user, p_year || '-' || lpad(p_month::text, 2, '0'));
end;
$$;


-- ############################################################################
-- PART 2 — a parent's consent
-- ############################################################################

create table if not exists private.parental_consents (
  id                bigint generated always as identity primary key,
  child_id          uuid,
  child_username    text,
  parent_user_id    uuid,
  parent_email      text not null,
  parent_name       text,
  relation          text,
  parent_birth_year integer,
  decision          text not null check (decision in ('approved', 'declined', 'withdrawn')),
  notice_version    text not null,
  decided_at        timestamptz not null default now()
);
revoke all on private.parental_consents from public, anon, authenticated;
alter table private.parental_consents enable row level security;

-- The student names a parent. Can be changed while waiting.
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
         consent = case when consent = 'declined' then 'pending' else consent end
   where user_id = me;
end;
$$;

-- Is the caller signed in with a one-time code sent to their email, within
-- the last hour? That's what proves they control the parent's address.
create or replace function private.signed_in_by_email_code()
returns boolean
language sql
stable
set search_path = ''
as $$
  select exists (
    select 1 from jsonb_array_elements(coalesce(auth.jwt() -> 'amr', '[]'::jsonb)) m
    where m ->> 'method' in ('otp', 'magiclink', 'email/signup')
      and (m ->> 'timestamp')::bigint > extract(epoch from now())::bigint - 3600
  )
$$;
revoke execute on function private.signed_in_by_email_code() from public, anon, authenticated;

-- What the signed-in parent has been asked, and has decided.
create or replace function public.my_children_requests()
returns table (child_id uuid, child_username text, child_age integer, consent text, requested_at timestamptz, verified boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select a.user_id, p.username, private.age_years(a.birth_year, a.birth_month), a.consent, a.requested_at,
         private.signed_in_by_email_code()
  from public.account_age a
  join public.profiles p on p.id = a.user_id
  where a.parent_email = lower(coalesce(auth.jwt() ->> 'email', ''))
    and a.user_id <> auth.uid()
    and private.age_years(a.birth_year, a.birth_month) < 18
  order by a.requested_at desc nulls last
$$;

create or replace function public.decide_parent_consent(
  p_child uuid, p_approve boolean, p_parent_name text, p_relation text, p_parent_birth_year integer, p_notice_version text default 'v1'
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  me    uuid := auth.uid();
  mail  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  child public.account_age;
  uname text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if not private.signed_in_by_email_code() then
    raise exception 'Sign in with the code we email you, then try again.' using errcode = '42501';
  end if;
  select * into child from public.account_age where user_id = p_child;
  if child.user_id is null or child.parent_email is distinct from mail or p_child = me then
    raise exception 'There''s no request for you from that account.' using errcode = '42501';
  end if;
  if not private.may_process(me) then
    raise exception 'A parent or guardian must be an adult.' using errcode = '42501';
  end if;
  if p_approve then
    if p_parent_name is null or char_length(btrim(p_parent_name)) < 2 or char_length(p_parent_name) > 120 then
      raise exception 'Enter your full name.' using errcode = '22023';
    end if;
    if p_relation not in ('parent', 'guardian') then
      raise exception 'Choose parent or legal guardian.' using errcode = '22023';
    end if;
    if p_parent_birth_year is null or p_parent_birth_year > extract(year from now())::int - 18 or p_parent_birth_year < extract(year from now())::int - 120 then
      raise exception 'A parent or guardian must be 18 or over.' using errcode = '22023';
    end if;
  end if;
  select username into uname from public.profiles where id = p_child;
  insert into private.parental_consents (child_id, child_username, parent_user_id, parent_email, parent_name, relation, parent_birth_year, decision, notice_version)
  values (p_child, uname, me, mail, nullif(btrim(p_parent_name), ''), p_relation, p_parent_birth_year,
          case when p_approve then 'approved' else 'declined' end, coalesce(p_notice_version, 'v1'));
  update public.account_age set consent = case when p_approve then 'approved' else 'declined' end where user_id = p_child;
  return case when p_approve then 'approved' else 'declined' end;
end;
$$;


-- ############################################################################
-- PART 4 (before 3, which uses it) — registration details kept 180 days
-- ############################################################################

create table if not exists private.deleted_registrations (
  user_id       uuid primary key,
  email         text,
  username      text,
  registered_at timestamptz,
  deleted_at    timestamptz not null default now()
);
revoke all on private.deleted_registrations from public, anon, authenticated;
alter table private.deleted_registrations enable row level security;

-- Delete an account and everything of it, keeping only the registration
-- details for 180 days. Used by delete_my_account() and by a parent
-- withdrawing consent.
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

  delete from auth.users where id = p_user;
end;
$$;
revoke execute on function private.erase_account(uuid) from public, anon, authenticated;

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;
  perform private.erase_account(me);
end;
$$;

-- A parent withdraws consent: the student's account is deleted.
create or replace function public.withdraw_parent_consent(p_child uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me    uuid := auth.uid();
  mail  text := lower(coalesce(auth.jwt() ->> 'email', ''));
  child public.account_age;
  uname text;
begin
  if not private.signed_in_by_email_code() then
    raise exception 'Sign in with the code we email you, then try again.' using errcode = '42501';
  end if;
  select * into child from public.account_age where user_id = p_child;
  if child.user_id is null or child.parent_email is distinct from mail or p_child = me then
    raise exception 'There''s no request for you from that account.' using errcode = '42501';
  end if;
  select username into uname from public.profiles where id = p_child;
  insert into private.parental_consents (child_id, child_username, parent_user_id, parent_email, decision, notice_version)
  values (p_child, uname, me, mail, 'withdrawn', 'v1');
  perform private.erase_account(p_child);
end;
$$;

-- Erase registration details 180 days after deletion, every night.
create or replace function private.purge_deleted_registrations()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from private.deleted_registrations where deleted_at < now() - interval '180 days' returning 1
  )
  select count(*)::int from gone
$$;
revoke execute on function private.purge_deleted_registrations() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('panalo-purge-registrations', '23 3 * * *', 'select private.purge_deleted_registrations()');
  else
    raise notice 'pg_cron is not enabled: run select private.purge_deleted_registrations() now and then.';
  end if;
end;
$$;


-- ############################################################################
-- PART 3 — nothing processed for a student waiting for consent
-- ############################################################################

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
  if who is not null and not private.may_process(who) then
    raise exception 'A parent or guardian needs to agree before Panalo can be used.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.require_consent() from public, anon, authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['messages', 'conversations', 'conversation_participants', 'student_profiles', 'student_tasks',
                           'focus_sessions', 'student_events', 'activity_log', 'student_goals', 'resources', 'room_requests']
  loop
    if to_regclass('public.' || t) is not null then
      execute format('drop trigger if exists trg_require_consent on public.%I', t);
      execute format('create trigger trg_require_consent before insert on public.%I for each row execute function private.require_consent()', t);
    end if;
  end loop;
end;
$$;


-- ############################################################################
-- Grants
-- ############################################################################

revoke execute on function public.my_age_status(), public.set_my_birth(integer, integer),
  public.moderation_set_birth(uuid, integer, integer), public.request_parent_consent(text),
  public.my_children_requests(), public.decide_parent_consent(uuid, boolean, text, text, integer, text),
  public.withdraw_parent_consent(uuid), public.delete_my_account()
  from public, anon;
grant execute on function public.my_age_status(), public.set_my_birth(integer, integer),
  public.moderation_set_birth(uuid, integer, integer), public.request_parent_consent(text),
  public.my_children_requests(), public.decide_parent_consent(uuid, boolean, text, text, integer, text),
  public.withdraw_parent_consent(uuid), public.delete_my_account()
  to authenticated;


-- ############################################################################
-- Verify
-- ############################################################################
select 'age and consent table' as check_name,
       case when to_regclass('public.account_age') is not null then 'yes' else 'MISSING' end as result
union all
select 'consent enforced on messages',
       case when exists (select 1 from pg_trigger where tgname = 'trg_require_consent' and tgrelid = 'public.messages'::regclass) then 'yes' else 'MISSING' end
union all
select 'registration details kept 180 days',
       case when pg_get_functiondef('public.delete_my_account()'::regprocedure) like '%erase_account%' then 'yes' else 'MISSING' end;

-- Done. ✅
