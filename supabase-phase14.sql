-- ============================================================================
-- PANALO — Phase 14: repair what phases 11 and 13 broke, and close the gaps
-- a replay of every migration against a real Postgres found.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Every change here is covered by tests/migrations.test.mjs, which replays
-- all the supabase-*.sql files into an in-process Postgres and acts as
-- signed-in users through RLS. None of these bugs needed production to find.
-- ============================================================================


-- ############################################################################
-- PART 1 — nobody could add a second person to a chat
-- ############################################################################

-- Phase 13 moved my_conversation_role() from `public` to `private` and
-- checked that no POLICY needed rewriting -- policies hold the function by
-- OID, so they followed it. But two TRIGGER FUNCTIONS from phase 11 call it
-- by name, and PL/pgSQL resolves names when the function runs, not when it is
-- created. From the moment phase 13 ran, both raised
--   function public.my_conversation_role(uuid) does not exist
-- on every call:
--
--   stamp_creator_as_owner  fires on every participant insert other than the
--                           creator's own -- so no 1:1 chat and no group with
--                           members could be created, and nobody could be
--                           added to an existing group.
--   guard_role_change       fires on every role change -- so "Make admin"
--                           failed too.
--
-- Both are recreated here pointing at private.my_conversation_role. The
-- bodies are kept IDENTICAL to supabase-phase11.sql, which was corrected at
-- the same time, so re-running either file leaves the same functions behind.

create or replace function public.stamp_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  creator uuid;
  caller_role text;
begin
  select created_by into creator from public.conversations where id = new.conversation_id;

  -- The conversation's creator is always an owner, whatever was sent.
  if new.user_id = creator then
    new.role := 'owner';
    return new;
  end if;

  -- Nobody else is created as an owner, and an admin may only be appointed
  -- by an existing owner. Everyone else joins as a member regardless of what
  -- the client asked for.
  caller_role := private.my_conversation_role(new.conversation_id);
  if new.role = 'owner' or (new.role = 'admin' and caller_role is distinct from 'owner') then
    new.role := 'member';
  end if;

  return new;
end;
$$;


-- ############################################################################
-- PART 2 — leaving, deleting a chat you started, and deleting your account
-- ############################################################################

-- When the last owner leaves, promote_on_owner_leave() (phase 11) hands the
-- conversation to someone else with an UPDATE. guard_role_change() then
-- checked the CALLER's role -- but the caller is the person leaving, whose
-- row is already gone, so they had no role and the hand-off was refused.
-- The refusal aborted the leave itself. Three things failed that way:
--
--   * leaving a group you own while anyone else is still in it;
--   * "Delete chat" on any 1:1 chat you started (the creator is stamped as
--     owner there too, and the other person is the heir);
--   * delete_my_account() for anyone who ever started a chat with someone.
--
-- The guard now lets two kinds of caller through: another trigger
-- (pg_trigger_depth() > 1) and a migration or the dashboard (no signed-in
-- user). Neither is reachable by a client -- a PostgREST request always
-- arrives at trigger depth 1, and RLS lets only `authenticated` update this
-- table at all -- so every rule for people still holds.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := private.my_conversation_role(old.conversation_id);
begin
  -- Identity is not editable here; only the role is.
  new.conversation_id := old.conversation_id;
  new.user_id         := old.user_id;

  -- The rules below are for people. Two callers are not people and must
  -- pass: another trigger (promote_on_owner_leave handing ownership over,
  -- which runs after the leaver's row is gone -- so the leaver has no role
  -- and was refused, which made leaving, deleting a chat you started, and
  -- deleting your account all fail), and a migration or the dashboard, which
  -- run with no signed-in user at all. Neither is reachable by a client:
  -- PostgREST requests always arrive at trigger depth 1, and RLS only lets
  -- `authenticated` update this table. Kept identical in phase 14.
  if pg_trigger_depth() > 1 or auth.uid() is null then
    return new;
  end if;

  if new.role is distinct from old.role then
    if caller_role is distinct from 'owner' then
      raise exception 'Only the group owner can change roles.' using errcode = '42501';
    end if;
    -- Handing ownership over is allowed; demoting yourself while you are the
    -- only owner is not, or the group is left unadministered.
    if old.role = 'owner' and new.role <> 'owner'
       and (select count(*) from public.conversation_participants
            where conversation_id = old.conversation_id and role = 'owner') = 1 then
      raise exception 'Promote someone else to owner first.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

-- Deleting your account must delete YOU -- not every conversation you ever
-- started. conversations.created_by was ON DELETE CASCADE, so once the guard
-- above stopped blocking it, delete_my_account() would have erased every
-- 1:1 chat and group the person had started, taking everybody else's
-- messages in them along with it. "Delete" in this app means "delete for
-- me"; the other people keep their copy.
--
-- The chat outlives its creator with created_by set to NULL. Nothing relies
-- on it being set: every policy compares it to auth.uid(), which a NULL never
-- matches, so the departed creator's special powers simply lapse.
alter table public.conversations alter column created_by drop not null;

do $$
begin
  if exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_created_by_fkey'
      and confdeltype <> 'n'  -- 'n' is SET NULL
  ) then
    alter table public.conversations drop constraint conversations_created_by_fkey;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversations'::regclass
      and conname = 'conversations_created_by_fkey'
  ) then
    alter table public.conversations
      add constraint conversations_created_by_fkey
      foreign key (created_by) references public.profiles (id) on delete set null;
  end if;
end $$;


-- ############################################################################
-- PART 3 — a chat cannot be taken over by the other person in it
-- ############################################################################

-- The phase 11 update policy lets either member of a 1:1 chat update the
-- conversation row -- meant for the shared theme -- with no limit on WHICH
-- columns. created_by is not cosmetic: it lets its holder add participants
-- and delete anyone's wrapped key. So the other person could make themselves
-- creator, delete your copy of the chat key, and leave your device with no
-- key -- at which point sendMessage() falls back to plaintext.
--
-- id, type, created_by and created_at are fixed at creation. The name, bio
-- and theme stay editable exactly as before. The ON DELETE SET NULL above is
-- itself an UPDATE made by a trigger, so trigger-made changes pass.
create or replace function public.protect_conversation_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if pg_trigger_depth() > 1 then
    return new;
  end if;
  new.id         := old.id;
  new.type       := old.type;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  return new;
end;
$$;

drop trigger if exists trg_protect_conversation_identity on public.conversations;
create trigger trg_protect_conversation_identity
  before update on public.conversations
  for each row execute function public.protect_conversation_identity();

-- A read marker is yours to move forward, not to move sideways. "reads
-- update" checked only that the row was yours, so a marker could be moved
-- into someone else's chat, where it would show you as having read it.
-- Restrictive, so re-running phase 6 cannot quietly undo it.
drop policy if exists "reads update stays in your chats" on public.conversation_reads;
create policy "reads update stays in your chats" on public.conversation_reads
  as restrictive
  for update to authenticated
  using (true)
  with check (private.is_conversation_member(conversation_id));


-- ############################################################################
-- PART 4 — no ringing strangers
-- ############################################################################

-- Phase 10 made profiles invisible to people you share no chat with, so a
-- stranger cannot see who you are. They could still RING you: the call
-- insert policy only checked that you were not calling yourself, and any
-- account's id is one find_profile_by_username() away. Calls are 1:1 in the
-- app and only offered inside an existing chat, so requiring one costs no
-- real caller anything. Restrictive, so re-running phase 7 or 8 cannot
-- quietly undo it.
drop policy if exists "call_invites only between people who share a chat" on public.call_invites;
create policy "call_invites only between people who share a chat" on public.call_invites
  as restrictive
  for insert to authenticated
  with check (private.shares_conversation_with(callee_id));


-- ############################################################################
-- PART 5 — no more accounts without a profile
-- ############################################################################

-- Signup never checked the username. The account was created, then the app
-- tried to create the profile, the unique index on lower(username) refused a
-- taken name -- and the app reported that as "couldn't set up your
-- encryption keys", logged the rest to the console, and carried on. The
-- result looked like a working account named after someone else, but had no
-- profile at all: nobody could find it, it could not start a chat (every
-- chat needs its creator's profile), and it had no encryption.
--
-- The profile is now created by the database in the SAME transaction as the
-- account. A taken name makes the signup itself fail, so there is nothing
-- half-made left behind. The app shows that as "That username is taken".
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := nullif(btrim(new.raw_user_meta_data ->> 'username'), '');
begin
  insert into public.profiles (id, username)
  values (
    new.id,
    coalesce(wanted, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'user-' || left(new.id::text, 8))
  )
  on conflict (id) do nothing;
  return new;
exception
  when unique_violation then
    raise exception 'That username is taken.' using errcode = '23505';
end;
$$;

drop trigger if exists trg_create_profile_for_new_user on auth.users;
create trigger trg_create_profile_for_new_user
  after insert on auth.users
  for each row execute function public.create_profile_for_new_user();

-- Two unique indexes on lower(username) existed in production -- one from an
-- ad-hoc snippet, one from phase 7 -- so every signup and rename maintained
-- both. Keep the one the repository creates; drop any other.
do $$
declare
  extra record;
begin
  if to_regclass('public.idx_profiles_username_lower') is null then
    return;
  end if;
  for extra in
    select c.relname as index_name, con.conname as constraint_name
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    left join pg_constraint con on con.conindid = i.indexrelid
    where i.indrelid = 'public.profiles'::regclass
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%lower(username%'
      and c.relname <> 'idx_profiles_username_lower'
  loop
    if extra.constraint_name is not null then
      execute format('alter table public.profiles drop constraint %I', extra.constraint_name);
    else
      execute format('drop index public.%I', extra.index_name);
    end if;
  end loop;
end $$;


-- ############################################################################
-- PART 6 — give ownerless groups an owner
-- ############################################################################

-- 15 of 16 groups in production had no owner, so nobody could rename them,
-- add or remove anyone, or promote anyone. Each gets one, preferring its
-- creator if still present, then an admin, then whoever has been talking
-- there longest (the earliest message is the only join-time record there is).
-- guard_role_change lets this through because a migration has no signed-in
-- user.
with ownerless as (
  select c.id, c.created_by
  from public.conversations c
  where c.type = 'group'
    and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id)
    and not exists (select 1 from public.conversation_participants p
                    where p.conversation_id = c.id and p.role = 'owner')
),
heir as (
  select distinct on (o.id) o.id as conversation_id, p.user_id
  from ownerless o
  join public.conversation_participants p on p.conversation_id = o.id
  order by o.id,
           (p.user_id = o.created_by) desc,
           (p.role = 'admin') desc,
           (select min(m.created_at) from public.messages m
            where m.conversation_id = o.id and m.user_id = p.user_id) asc nulls last,
           p.user_id
)
update public.conversation_participants p
set role = 'owner'
from heir
where p.conversation_id = heir.conversation_id
  and p.user_id = heir.user_id;


-- ############################################################################
-- PART 7 — trigger functions stay unreachable
-- ############################################################################

-- Same rule as phases 8 and 12: a trigger function has no business being
-- callable at /rest/v1/rpc/. All three grantees, or the revoke does nothing.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.stamp_creator_as_owner()',
    'public.guard_role_change()',
    'public.protect_conversation_identity()',
    'public.create_profile_for_new_user()'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;


-- ############################################################################
-- PART 8 — verify
-- ############################################################################

-- EXPECTED OUTPUT, one row per check:
--   helpers in private                  3
--   functions calling a moved helper    0
--   created_by on account deletion      set null
--   groups with no owner                0
--   unique username indexes             1
--   signup creates profile              yes
--   callable SECURITY DEFINER functions delete_my_account, find_profile_by_username
--   accounts without a profile          0   (anything else: see note below)
--
-- "accounts without a profile" counts accounts made before this phase whose
-- profile was refused. They cannot use the app; delete them in
-- Authentication -> Users, or they can be given a profile by hand.
select 'helpers in private' as check_name,
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'private'
          and p.proname in ('is_conversation_member', 'my_conversation_role', 'shares_conversation_with')) as result
union all
select 'functions calling a moved helper',
       (select count(*)::text from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and p.prosrc ~ 'public\.(is_conversation_member|my_conversation_role|shares_conversation_with)')
union all
select 'created_by on account deletion',
       (select case confdeltype when 'n' then 'set null' when 'c' then 'CASCADE' else confdeltype::text end
        from pg_constraint where conname = 'conversations_created_by_fkey')
union all
select 'groups with no owner',
       (select count(*)::text from public.conversations c
        where c.type = 'group'
          and exists (select 1 from public.conversation_participants p where p.conversation_id = c.id)
          and not exists (select 1 from public.conversation_participants p
                          where p.conversation_id = c.id and p.role = 'owner'))
union all
select 'unique username indexes',
       (select count(*)::text from pg_index i
        where i.indrelid = 'public.profiles'::regclass and i.indisunique
          and pg_get_indexdef(i.indexrelid) ilike '%lower(username%')
union all
select 'signup creates profile',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_trigger
        where tgname = 'trg_create_profile_for_new_user')
union all
select 'callable SECURITY DEFINER functions',
       (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'))
union all
select 'accounts without a profile',
       (select count(*)::text from auth.users u
        where not exists (select 1 from public.profiles p where p.id = u.id));

-- Done. ✅
