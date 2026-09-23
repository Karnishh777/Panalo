-- ============================================================================
-- PANALO — Phase 10: rate limiting, profile enumeration, account deletion.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
--
-- These three are grouped because they share a theme: each is fine while the
-- app has a handful of friendly users, and each becomes a real problem the
-- moment it does not. All three are far easier to add now than to retrofit
-- once there are people whose expectations the change would break.
-- ============================================================================


-- ############################################################################
-- PART 1 — rate limiting
-- ############################################################################

-- There was none, anywhere. Nothing stopped one authenticated client from
-- inserting messages, conversations or call invites as fast as the network
-- allowed. On a 500 MB database that is a denial-of-wallet vector before it
-- is anything else, and the client-side UI is no defence at all: anyone can
-- call the REST API directly with the publishable key.
--
-- Enforced in triggers rather than in the client for exactly that reason.
-- The limits sit far above human speed -- a fast typist in a heated argument
-- sends a few messages a second, not thirty -- so a real person should never
-- meet them, while a flood stops dead.

-- The count below filters on (user_id, created_at). Without this index it
-- scans the user's whole message history on EVERY insert, which would turn
-- the rate limiter into its own performance problem.
create index if not exists idx_messages_user_created
  on public.messages (user_id, created_at desc);

create or replace function public.rate_limit_messages()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  select count(*) into recent
  from public.messages
  where user_id = auth.uid()
    and created_at > now() - interval '10 seconds';

  if recent >= 30 then
    -- 54000 is program_limit_exceeded. The client matches on this code
    -- rather than on the text, so the wording can change freely.
    raise exception 'Too many messages too quickly. Wait a moment and try again.'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_rate_limit_messages on public.messages;
create trigger trg_rate_limit_messages
  before insert on public.messages
  for each row execute function public.rate_limit_messages();

-- Conversations are far cheaper to create than to clean up: each drags
-- participants and wrapped keys along with it. Twenty new chats in an hour
-- is already well beyond normal use.
create index if not exists idx_conversations_creator_created
  on public.conversations (created_by, created_at desc);

create or replace function public.rate_limit_conversations()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  select count(*) into recent
  from public.conversations
  where created_by = auth.uid()
    and created_at > now() - interval '1 hour';

  if recent >= 20 then
    raise exception 'Too many new chats in a short time. Try again later.'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_rate_limit_conversations on public.conversations;
create trigger trg_rate_limit_conversations
  before insert on public.conversations
  for each row execute function public.rate_limit_conversations();

-- Call invites carry an SDP offer each and ring someone's device. Ten a
-- minute is past any normal use and short of being a nuisance tool.
create or replace function public.rate_limit_call_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recent integer;
begin
  select count(*) into recent
  from public.call_invites
  where caller_id = auth.uid()
    and created_at > now() - interval '1 minute';

  if recent >= 10 then
    raise exception 'Too many call attempts. Wait a minute before trying again.'
      using errcode = '54000';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_rate_limit_call_invites on public.call_invites;
create trigger trg_rate_limit_call_invites
  before insert on public.call_invites
  for each row execute function public.rate_limit_call_invites();


-- ############################################################################
-- PART 2 — profile enumeration
-- ############################################################################

-- The read policy was `using (true)`: any signed-in account could
-- `select * from profiles` and walk away with every username, user id, bio,
-- avatar URL and public key in the system -- a ready-made list of everyone
-- who uses the app, available to anyone who signs up.
--
-- It was not laziness. The app genuinely has to resolve a username typed by
-- someone who shares no chat with that person yet, which is how every chat
-- starts. But resolving ONE name you already know is a very different power
-- from listing everybody.
--
-- So the table is restricted to yourself and people you actually share a
-- conversation with, and the one legitimate stranger-lookup moves behind a
-- function that takes an exact name and returns at most one row.

-- SECURITY DEFINER so it does not recurse through the policy that uses it.
create or replace function public.shares_conversation_with(other uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_participants me
    join public.conversation_participants them
      on them.conversation_id = me.conversation_id
    where me.user_id = auth.uid()
      and them.user_id = other
  );
$$;

drop policy if exists "profiles read" on public.profiles;
create policy "profiles read" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.shares_conversation_with(id)
  );

-- Exact match, case-insensitive, at most one row, no wildcard or pattern
-- input. You can confirm a name you already know; you cannot sweep the
-- table. public_key is returned because adding someone to a group has to
-- wrap the conversation key to them at that moment.
create or replace function public.find_profile_by_username(name text)
returns table (id uuid, username text, public_key text)
language sql
security definer
stable
set search_path = public
as $$
  select p.id, p.username, p.public_key
  from public.profiles p
  where lower(p.username) = lower(trim(name))
  limit 1;
$$;

revoke execute on function public.shares_conversation_with(uuid)  from public, anon, authenticated;
revoke execute on function public.find_profile_by_username(text)  from public, anon, authenticated;
-- Policies evaluate as the querying role, so this one has to be granted back
-- or every profile read fails.
grant execute on function public.shares_conversation_with(uuid) to authenticated;
-- Signed-in only: a signed-out visitor has no business resolving names.
grant execute on function public.find_profile_by_username(text) to authenticated;


-- ############################################################################
-- PART 3 — account deletion
-- ############################################################################

-- There was no way to delete an account. Not a hidden one, not an awkward
-- one -- none at all. Someone who wanted to leave could delete individual
-- chats and nothing more: their profile, messages, keys and uploaded files
-- stayed indefinitely, with no route to remove them and nobody to ask.
--
-- Deleting from auth.users needs privileges the browser client does not have
-- and should never be given, which is why this is a SECURITY DEFINER
-- function that deletes exactly one row: the caller's own. It takes no
-- arguments, so there is no id to tamper with.
--
-- Everything else follows by cascade: profiles references auth.users on
-- delete cascade, and messages, participants, keys, reactions and read
-- markers all reference profiles the same way.
--
-- Storage objects do NOT cascade -- nothing in Postgres knows about them.
-- The client removes its own uploads before calling this, using the
-- owner-scoped delete policy from phase 9. Anything it misses is orphaned,
-- which is why phase 9 matters for more than tidiness.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;


-- ############################################################################
-- PART 4 — verify
-- ############################################################################

select 'rate limit triggers' as check_name, count(*)::text as result
from pg_trigger
where tgname in ('trg_rate_limit_messages', 'trg_rate_limit_conversations', 'trg_rate_limit_call_invites')
union all
select 'profiles read policy', coalesce(
  (select qual::text from pg_policies
   where schemaname = 'public' and tablename = 'profiles' and policyname = 'profiles read'),
  'MISSING')
union all
select 'account deletion fn', coalesce(
  (select 'present' from pg_proc p
   join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'delete_my_account'),
  'MISSING');

-- Expected: 3 triggers; a profiles read policy that is no longer just "true";
-- delete_my_account present.

-- Done. ✅
