-- ============================================================================
-- PANALO — Phase 20: moderation
-- ============================================================================
--
-- Run after phase 19. Safe to re-run.
--
-- Until now reports went nowhere: nobody was told, and the only place to
-- read them was the database. This adds a moderator: one or more accounts
-- that can read every report, act on it, and keep a record of what they did.
--
-- WHO IS A MODERATOR
--   private.moderators holds their ids. Nothing in the API can read or write
--   it directly; the functions below check it.
--
-- GETTING THE ROLE BACK
--   If the moderator's account is ever deleted, its row goes with it. Anyone
--   who knows the moderator passphrase can then claim the role for the
--   account they are signed in with (moderation_claim). The passphrase is
--   stored only as a bcrypt hash, set by a moderator from the moderation
--   page, and guesses are rate-limited (5 an hour per account, 30 a day in
--   total). There is no passphrase until a moderator sets one, so nobody can
--   claim anything before then.
--
-- WHAT A MODERATOR CAN DO (every action is written to private.moderation_log)
--   - list reports, with who filed them, who they are about, and in which
--     conversation;
--   - mark a report open / reviewing / closed, with a note;
--   - remove a reported message;
--   - suspend an account for some days or indefinitely, or lift a suspension.
--     A suspension signs the person out everywhere and stops them signing
--     in again until it ends. A moderator can't suspend themself or another
--     moderator.
--
-- The SQL Editor bootstrap (once, for the first moderator, by email):
--   insert into private.moderators (user_id)
--     select id from auth.users where email = 'you@example.com'
--   on conflict do nothing;
-- ============================================================================


-- ############################################################################
-- Tables
-- ############################################################################

create table if not exists private.moderators (
  user_id  uuid primary key references public.profiles (id) on delete cascade,
  added_at timestamptz not null default now()
);

-- One row: the passphrase that lets a signed-in account claim the role.
create table if not exists private.moderator_passphrase (
  only_one   boolean primary key default true check (only_one),
  hash       text not null,
  updated_at timestamptz not null default now()
);

create table if not exists private.moderator_claims (
  id         bigint generated always as identity primary key,
  user_id    uuid,
  succeeded  boolean not null,
  at         timestamptz not null default now()
);
create index if not exists idx_moderator_claims_at on private.moderator_claims (at);

-- What moderators did, kept even after the accounts involved are deleted.
create table if not exists private.moderation_log (
  id           bigint generated always as identity primary key,
  moderator_id uuid,
  action       text not null,
  report_id    uuid,
  target_user  uuid,
  detail       text,
  at           timestamptz not null default now()
);
create index if not exists idx_moderation_log_at on private.moderation_log (at desc);

alter table public.reports add column if not exists moderator_note text
  check (moderator_note is null or char_length(moderator_note) <= 2000);
alter table public.reports add column if not exists handled_at timestamptz;

revoke all on private.moderators, private.moderator_passphrase, private.moderator_claims, private.moderation_log
  from public, anon, authenticated;
-- Row-level security too, with no policies: even a grant added by mistake
-- later would show nothing. The functions below own these tables, so they
-- are unaffected.
alter table private.moderators enable row level security;
alter table private.moderator_passphrase enable row level security;
alter table private.moderator_claims enable row level security;
alter table private.moderation_log enable row level security;


-- ############################################################################
-- Helpers (not callable from the API)
-- ############################################################################

create or replace function private.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (select 1 from private.moderators m where m.user_id = auth.uid())
$$;
revoke execute on function private.is_moderator() from public, anon, authenticated;

create or replace function private.require_moderator()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_moderator() then
    raise exception 'Only a moderator can do that.' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;
revoke execute on function private.require_moderator() from public, anon, authenticated;


-- ############################################################################
-- The API: everything a moderator (or would-be moderator) can call
-- ############################################################################

-- Is the signed-in account a moderator, and is there a passphrase to claim
-- the role with? (The page uses this to decide what to show.)
create or replace function public.moderation_status()
returns table (is_moderator boolean, passphrase_set boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_moderator(),
         exists (select 1 from private.moderator_passphrase)
$$;

-- Every report, newest first, optionally only those with one status.
create or replace function public.moderation_reports(p_status text default null)
returns table (
  id uuid, created_at timestamptz, status text, reason text, details text, evidence text,
  moderator_note text, handled_at timestamptz,
  reporter_id uuid, reporter_username text,
  reported_user_id uuid, reported_username text, reported_banned_until timestamptz,
  reported_report_count bigint,
  conversation_id uuid, conversation_name text, conversation_type text,
  message_id uuid, message_exists boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  return query
    select r.id, r.created_at, r.status, r.reason, r.details, r.evidence,
           r.moderator_note, r.handled_at,
           r.reporter_id, rp.username,
           r.reported_user_id, tp.username, u.banned_until,
           (select count(*) from public.reports x where x.reported_user_id = r.reported_user_id),
           r.conversation_id, c.name, c.type,
           r.message_id, (r.message_id is not null and exists (select 1 from public.messages m where m.id = r.message_id))
    from public.reports r
    left join public.profiles rp on rp.id = r.reporter_id
    left join public.profiles tp on tp.id = r.reported_user_id
    left join auth.users u on u.id = r.reported_user_id
    left join public.conversations c on c.id = r.conversation_id
    where p_status is null or r.status = p_status
    order by (r.status = 'closed'), r.created_at desc
    limit 500;
end;
$$;

create or replace function public.moderation_set_status(p_report uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_moderator();
begin
  if p_status not in ('open', 'reviewing', 'closed') then
    raise exception 'Unknown status.' using errcode = '22023';
  end if;
  update public.reports
     set status = p_status,
         moderator_note = coalesce(nullif(btrim(p_note), ''), moderator_note),
         handled_at = case when p_status = 'open' then null else now() end
   where id = p_report;
  if not found then
    raise exception 'That report no longer exists.' using errcode = 'P0002';
  end if;
  insert into private.moderation_log (moderator_id, action, report_id, detail)
  values (me, 'status:' || p_status, p_report, nullif(btrim(p_note), ''));
end;
$$;

-- Remove one message (for everyone). Reports keep their evidence text.
create or replace function public.moderation_delete_message(p_message uuid, p_report uuid default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := private.require_moderator();
  author uuid;
begin
  delete from public.messages where id = p_message returning user_id into author;
  if author is null then
    raise exception 'That message is already gone.' using errcode = 'P0002';
  end if;
  insert into private.moderation_log (moderator_id, action, report_id, target_user, detail)
  values (me, 'delete-message', p_report, author, p_message::text);
end;
$$;

-- Suspend for p_days days (null = until lifted; 0 = lift now).
create or replace function public.moderation_suspend(p_user uuid, p_days integer default null, p_report uuid default null, p_note text default null)
returns timestamptz
language plpgsql
security definer
set search_path = ''
as $$
declare
  me    uuid := private.require_moderator();
  until timestamptz;
begin
  if p_user = me then
    raise exception 'You can''t suspend yourself.' using errcode = '42501';
  end if;
  if exists (select 1 from private.moderators m where m.user_id = p_user) then
    raise exception 'Moderators can''t suspend each other.' using errcode = '42501';
  end if;
  if p_days is not null and (p_days < 0 or p_days > 3650) then
    raise exception 'Choose between 0 and 3650 days.' using errcode = '22023';
  end if;

  until := case
    when p_days = 0 then null
    when p_days is null then now() + interval '100 years'
    else now() + make_interval(days => p_days)
  end;

  update auth.users set banned_until = until where id = p_user;
  if not found then
    raise exception 'That account no longer exists.' using errcode = 'P0002';
  end if;

  -- Sign them out everywhere: without a session they can't refresh, so
  -- they're out within the hour their current access token has left.
  if until is not null and to_regclass('auth.sessions') is not null then
    execute 'delete from auth.sessions where user_id = $1' using p_user;
  end if;

  insert into private.moderation_log (moderator_id, action, report_id, target_user, detail)
  values (me, case when until is null then 'unsuspend' else 'suspend' end, p_report, p_user,
          concat_ws(' - ', case when p_days is null then 'indefinitely' when p_days > 0 then p_days || ' days' end, nullif(btrim(p_note), '')));
  return until;
end;
$$;

-- The last 200 things moderators did.
create or replace function public.moderation_history()
returns table (at timestamptz, moderator_username text, action text, report_id uuid, target_username text, detail text)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform private.require_moderator();
  return query
    select l.at, mp.username, l.action, l.report_id, tp.username, l.detail
    from private.moderation_log l
    left join public.profiles mp on mp.id = l.moderator_id
    left join public.profiles tp on tp.id = l.target_user
    order by l.at desc
    limit 200;
end;
$$;

-- Set (or change) the passphrase that can claim the role. Moderators only.
create or replace function public.moderation_set_passphrase(p_passphrase text)
returns void
language plpgsql
security definer
set search_path = extensions, public
as $$
declare
  me uuid := private.require_moderator();
begin
  if p_passphrase is null or char_length(p_passphrase) < 12 then
    raise exception 'Use a passphrase of at least 12 characters.' using errcode = '22023';
  end if;
  insert into private.moderator_passphrase (only_one, hash, updated_at)
  values (true, crypt(p_passphrase, gen_salt('bf', 10)), now())
  on conflict (only_one) do update set hash = excluded.hash, updated_at = now();
  insert into private.moderation_log (moderator_id, action) values (me, 'set-passphrase');
end;
$$;

-- Become a moderator with the passphrase. Rate-limited; every attempt is kept.
create or replace function public.moderation_claim(p_passphrase text)
returns boolean
language plpgsql
security definer
set search_path = extensions, public
as $$
declare
  me     uuid := auth.uid();
  stored text;
  ok     boolean;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if (select count(*) from private.moderator_claims c
       where c.user_id = me and not c.succeeded and c.at > now() - interval '1 hour') >= 5
     or (select count(*) from private.moderator_claims c
       where not c.succeeded and c.at > now() - interval '1 day') >= 30 then
    raise exception 'Too many tries. Wait an hour and try again.' using errcode = '54000';
  end if;

  select p.hash into stored from private.moderator_passphrase p;
  ok := stored is not null and p_passphrase is not null and crypt(p_passphrase, stored) = stored;

  insert into private.moderator_claims (user_id, succeeded) values (me, ok);
  if ok then
    insert into private.moderators (user_id) values (me) on conflict do nothing;
    insert into private.moderation_log (moderator_id, action) values (me, 'claimed-role');
  end if;
  return ok;
end;
$$;

revoke execute on function public.moderation_status(), public.moderation_reports(text),
  public.moderation_set_status(uuid, text, text), public.moderation_delete_message(uuid, uuid),
  public.moderation_suspend(uuid, integer, uuid, text), public.moderation_history(),
  public.moderation_set_passphrase(text), public.moderation_claim(text)
  from public, anon;
grant execute on function public.moderation_status(), public.moderation_reports(text),
  public.moderation_set_status(uuid, text, text), public.moderation_delete_message(uuid, uuid),
  public.moderation_suspend(uuid, integer, uuid, text), public.moderation_history(),
  public.moderation_set_passphrase(text), public.moderation_claim(text)
  to authenticated;


-- ############################################################################
-- Verify. Expect: the tables exist, nothing is readable from the API, and
-- the functions refuse anyone who isn't a moderator.
-- ############################################################################
select 'moderation tables hidden from the API' as check_name,
       case when not has_table_privilege('authenticated', 'private.moderators', 'SELECT')
             and not has_table_privilege('authenticated', 'private.moderator_passphrase', 'SELECT')
            then 'yes' else 'EXPOSED' end as result
union all
select 'moderators', (select count(*)::text from private.moderators)
union all
select 'passphrase set', (select case when exists (select 1 from private.moderator_passphrase) then 'yes' else 'not yet' end);

-- Done. ✅
