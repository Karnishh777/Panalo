-- ============================================================================
-- PANALO — Phase 8: close the gaps a live audit found.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run,
-- and safe to run whether or not supabase-phase7.sql was ever applied.
--
-- WHY THIS FILE EXISTS
-- An audit compared the deployed database against this repository and found
-- they had drifted: supabase-phase7.sql had never been run in production.
-- Everything phase 7 was meant to fix was therefore still open, while the
-- client code had already moved on to assume it was closed. Part 1 below
-- re-applies the parts of phase 7 production is missing; parts 2-5 fix
-- issues phase 7 never covered.
--
-- Run this even if you believe phase 7 was applied. Every statement checks
-- first, so re-running costs nothing.
-- ============================================================================

-- ############################################################################
-- PART 1 — the phase-7 content production is missing
-- ############################################################################

-- ---- 1a. Username uniqueness ------------------------------------------------
-- Three call sites look a username up case-insensitively and act on the
-- result (start a direct chat, add a group member). Without a uniqueness
-- guarantee, two accounts sharing a username means a chat — or a group
-- invite — can silently reach the wrong person.
--
-- Production ALREADY has this, created by an ad-hoc snippet under the name
-- `profiles_username_lower_key` rather than phase 7's `idx_profiles_username_lower`.
-- `create index if not exists` matches on NAME, not on definition, so naming it
-- differently here would build a second, redundant unique index over the same
-- expression -- extra work on every insert and update, for nothing.
--
-- Check for any unique index on lower(username) and only create one if none
-- exists, whatever it happens to be called.
--
-- If this fails with a duplicate-key error, some accounts already share a
-- username. Find them, have one side rename, then re-run:
--   select lower(username), array_agg(username), array_agg(id)
--   from public.profiles group by lower(username) having count(*) > 1;
do $$
begin
  if not exists (
    select 1
    from pg_index i
    join pg_class c on c.oid = i.indexrelid
    where i.indrelid = 'public.profiles'::regclass
      and i.indisunique
      and pg_get_indexdef(i.indexrelid) ilike '%lower(username%'
  ) then
    create unique index idx_profiles_username_lower
      on public.profiles (lower(username));
  end if;
end $$;

-- ---- 1b. Per-key PBKDF2 iteration count ------------------------------------
-- The client now carries the iteration count inside the stored key blob
-- itself, so recovery no longer depends on this column existing. It is still
-- added here because the client writes it when available and it makes the
-- count queryable for operational checks.
--
-- The absence of this column in production caused real data loss: keys were
-- protected at 600k iterations, the count was silently dropped on write, and
-- recovery then derived at 200k — reporting a CORRECT password as wrong and
-- orphaning that account's encrypted history. See crypto.js.
alter table public.user_keys
  add column if not exists key_iterations integer not null default 200000;

-- ---- 1c. Message idempotency key -------------------------------------------
-- A send whose response is lost to a network error (but that actually
-- committed) looks like a failure to the client, which offers Retry. Without
-- a way to recognise "this exact send already happened", Retry creates a
-- genuine duplicate message.
alter table public.messages add column if not exists client_id uuid;
create unique index if not exists idx_messages_client_id
  on public.messages (client_id) where client_id is not null;

-- ---- 1d. Trusted call invites ----------------------------------------------
-- Call signalling previously rode entirely on a Realtime broadcast channel
-- keyed by the recipient's user id, with the caller's identity taken from a
-- client-supplied payload field. Nothing server-side stopped a malicious
-- client from broadcasting a spoofed offer claiming to be someone else — and
-- any authenticated user can resolve any account's id, because profiles are
-- world-readable by design (username lookup depends on it).
--
-- Until this table exists, calls.js cannot place calls at all: its insert
-- fails and the user sees "Could not start the call."
create table if not exists public.call_invites (
  id          uuid primary key default gen_random_uuid(),
  caller_id   uuid not null references public.profiles (id) on delete cascade,
  callee_id   uuid not null references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('voice', 'video')),
  status      text not null default 'ringing'
                check (status in ('ringing', 'answered', 'declined', 'ended', 'busy', 'missed', 'failed')),
  offer_sdp   text not null,
  answer_sdp  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_call_invites_callee on public.call_invites (callee_id, created_at desc);
create index if not exists idx_call_invites_caller on public.call_invites (caller_id, created_at desc);

-- Force caller_id from the authenticated session, so a client cannot place a
-- call "as" someone else, and reset status/answer so it cannot insert a row
-- that already claims to be answered.
create or replace function public.set_call_invite_caller()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.caller_id  := auth.uid();
  new.status     := 'ringing';
  new.answer_sdp := null;
  new.created_at := now();
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_set_call_invite_caller on public.call_invites;
create trigger trg_set_call_invite_caller
  before insert on public.call_invites
  for each row execute function public.set_call_invite_caller();

-- Lock identity on update: only status, answer_sdp and a re-offer may change.
create or replace function public.protect_call_invite_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id         := old.id;
  new.caller_id  := old.caller_id;
  new.callee_id  := old.callee_id;
  new.kind       := old.kind;
  new.created_at := old.created_at;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_protect_call_invite_identity on public.call_invites;
create trigger trg_protect_call_invite_identity
  before update on public.call_invites
  for each row execute function public.protect_call_invite_identity();

alter table public.call_invites enable row level security;

drop policy if exists "call_invites read"   on public.call_invites;
drop policy if exists "call_invites insert" on public.call_invites;
drop policy if exists "call_invites update" on public.call_invites;

create policy "call_invites read" on public.call_invites
  for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

create policy "call_invites insert" on public.call_invites
  for insert to authenticated
  with check (callee_id <> auth.uid());

create policy "call_invites update" on public.call_invites
  for update to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid())
  with check (caller_id = auth.uid() or callee_id = auth.uid());

alter table public.call_invites replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'call_invites'
  ) then
    alter publication supabase_realtime add table public.call_invites;
  end if;
end $$;

-- ---- 1e. Storage limits enforced server-side --------------------------------
-- The 50 MB cap and file-type check the client applies are client-side only.
-- Nothing stopped a direct call against the Storage API from uploading
-- arbitrarily large or arbitrarily-typed files — a real cost and abuse
-- vector. Mirrors MAX_FILE_BYTES in src/config.js.
update storage.buckets
set file_size_limit = 52428800, -- 50 MB
    allowed_mime_types = array[
      -- Encrypted attachments upload as opaque bytes: once a file is
      -- ciphertext it has no meaningful media type, and declaring its real
      -- one would leak exactly what the encryption is there to hide.
      -- Without this entry every encrypted upload is rejected outright.
      --
      -- Honest trade-off: this does weaken the whitelist as an abuse control,
      -- since anything can now be labelled octet-stream. It was always weak --
      -- the client picks the value it sends -- and the real limit on abuse is
      -- the 50 MB size cap above, which the server does enforce.
      'application/octet-stream',
      'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml',
      'application/pdf', 'application/zip',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/plain', 'text/csv',
      'video/mp4', 'video/quicktime',
      'audio/mpeg', 'audio/mp4', 'audio/webm'
    ]
where id = 'chat-files';


-- ############################################################################
-- PART 2 — message identity is immutable after insert
-- ############################################################################

-- public.set_message_sender() stamps user_id and username from the
-- authenticated caller, which makes SENDING as someone else impossible. But
-- it is a BEFORE INSERT trigger only, and the "messages update" policy lets
-- an author update their own row with no column restrictions.
--
-- So an author could edit their own message and rewrite `username` to any
-- string they liked. The client renders exactly that column as the message
-- author (renderMessage in src/chat.js), so the message would then display
-- under someone else's name — in the thread, in the sidebar preview, and in
-- search results. That is impersonation, not editing.
--
-- The same gap let an author rewrite created_at to reorder history, or move a
-- message into another conversation they belong to by changing
-- conversation_id.
--
-- Editing is meant to change the text and nothing else. Enforce exactly that:
-- content, iv and edited_at stay writable; every identity and routing column
-- is pinned to its original value.
create or replace function public.protect_message_identity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.id              := old.id;
  new.conversation_id := old.conversation_id;
  new.user_id         := old.user_id;
  new.username        := old.username;
  new.created_at      := old.created_at;
  new.client_id       := old.client_id;
  new.file_url        := old.file_url;
  new.reply_to        := old.reply_to;
  return new;
end;
$$;

drop trigger if exists trg_protect_message_identity on public.messages;
create trigger trg_protect_message_identity
  before update on public.messages
  for each row execute function public.protect_message_identity();

-- Because username is copied onto each message at insert, a renamed account
-- would otherwise keep showing its OLD name on every message it ever sent.
-- Keep the denormalised copy in step with the profile it came from.
create or replace function public.sync_message_usernames()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.username is distinct from old.username then
    update public.messages
    set username = new.username
    where user_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_message_usernames on public.profiles;
create trigger trg_sync_message_usernames
  after update of username on public.profiles
  for each row execute function public.sync_message_usernames();


-- ############################################################################
-- PART 3 — stop the attachment bucket being listable by anyone
-- ############################################################################

-- The Supabase linter flagged this directly:
--   "Public bucket chat-files has 1 broad SELECT policy on storage.objects,
--    allowing clients to list all files. Public buckets don't need this for
--    object URL access."
--
-- The original policy was `using (bucket_id = 'chat-files')` with no role
-- restriction, so even the anon role could enumerate the bucket. Attachments
-- are stored unencrypted under random paths, which makes enumeration the
-- whole attack: list the bucket, then read every photo and document any user
-- has ever sent.
--
-- A first attempt scoped this policy to `authenticated`. That was not enough
-- and the linter rightly kept flagging it: any signed-in user could still
-- list every attachment in the bucket, including from conversations they are
-- not a member of. Narrowing who can enumerate everything is not the same as
-- stopping enumeration.
--
-- The policy is simply not needed. A public bucket serves its objects over
-- /storage/v1/object/public/... without consulting RLS at all, and a grep of
-- the client confirms it only ever calls .upload() and .getPublicUrl() --
-- there is no .list(), no .download(), no createSignedUrl(). So dropping the
-- SELECT policy removes bucket enumeration for everyone while images,
-- avatars and downloads keep working exactly as before.
--
-- NOTE: this ends enumeration, it does not make attachments private. Anyone
-- holding an object URL can still read it, and those URLs sit in plaintext in
-- messages.file_url. Encrypting attachment bytes with the conversation key is
-- the real fix -- see the audit's recommended next steps.
drop policy if exists "chat-files read"   on storage.objects;
drop policy if exists "chat-files upload" on storage.objects;

-- Upload stays: the app writes through the authenticated Storage API.
create policy "chat-files upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat-files');


-- ############################################################################
-- PART 4 — tighten EXECUTE, and inspect the production-only functions
-- ############################################################################

-- The Supabase linter reported three SECURITY DEFINER functions that appear
-- NOWHERE in this repository:
--   public.rls_auto_enable()
--   public.set_conversation_theme(conv uuid, new_theme text)
--   public.username_available(name text)
--
-- All three are executable by the anon role. Two look like leftovers from
-- abandoned attempts: setChatTheme() in src/chat.js now does a plain UPDATE
-- rather than an RPC, and nothing in the client calls username_available.
-- rls_auto_enable() has no counterpart in the codebase at all, and a
-- SECURITY DEFINER function with that name, callable anonymously, is worth
-- understanding before it is trusted.
--
-- This file deliberately does NOT drop them. Read them first:
--
--   select p.proname,
--          pg_get_function_identity_arguments(p.oid) as args,
--          p.prosecdef                                as security_definer,
--          pg_get_functiondef(p.oid)                  as body
--   from pg_proc p
--   join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public'
--     and p.proname in ('rls_auto_enable', 'set_conversation_theme', 'username_available');
--
-- Then, once you have confirmed what each does and that nothing depends on
-- it, drop the orphans:
--
--   drop function if exists public.set_conversation_theme(uuid, text);
--   drop function if exists public.username_available(text);
--   -- only after reading its body and confirming it is not load-bearing:
--   -- drop function if exists public.rls_auto_enable();

-- Revoking EXECUTE takes THREE grantees, not one.
--
-- This took two attempts to get right, so the reasoning is worth recording.
--
--   1. PostgreSQL grants EXECUTE on every new function to PUBLIC by default.
--   2. Supabase additionally runs ALTER DEFAULT PRIVILEGES granting EXECUTE
--      on new functions in `public` directly to anon, authenticated and
--      service_role.
--
-- REVOKE only removes privileges granted to the grantee you name. So
-- `revoke ... from anon` leaves the PUBLIC grant; `revoke ... from public`
-- leaves the explicit anon and authenticated grants. Either one alone
-- succeeds silently and the function stays just as callable -- which is
-- exactly what the linter kept reporting after each attempt.
--
-- Naming all three is what actually closes it.
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.set_message_sender()',
    'public.protect_message_identity()',
    'public.sync_message_usernames()',
    'public.set_call_invite_caller()',
    'public.protect_call_invite_identity()',
    'private.is_conversation_member(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon, authenticated', fn);
  end loop;
end $$;

-- Trigger functions need no grant back: PostgreSQL does not check EXECUTE
-- when firing a trigger, so the five above stay revoked from everyone and
-- become unreachable over /rest/v1/rpc/.

-- is_conversation_member is the one exception. It is called from inside RLS
-- policies, which are evaluated as the querying role, so authenticated must
-- keep EXECUTE or every policy depending on it starts failing -- that would
-- take the whole app down to silence a linter warning.
--
-- It now lives in `private` (created there by supabase-setup.sql; phase 13
-- moved it for databases that predate that), so the grant no longer exposes
-- an endpoint -- PostgREST does not publish that schema. This file used to
-- name public.is_conversation_member here, which on any database that had
-- run phase 13 either failed outright or, after a setup re-run, re-granted
-- a stray public copy.
grant execute on function private.is_conversation_member(uuid) to authenticated;

-- ---- Drop the two orphans now confirmed dead --------------------------------
-- Both were found in production, both exist nowhere in this repo, and a grep
-- of the entire client confirms it makes no .rpc() calls at all -- so nothing
-- can be calling either one.
--
-- set_conversation_theme: superseded. setChatTheme() in src/chat.js now does
-- a plain UPDATE against the conversations table.
drop function if exists public.set_conversation_theme(uuid, text);

-- username_available: never wired up. It was meant to let the signup form
-- check a name before creating the account, and was deliberately granted to
-- anon for that. Nothing calls it, so all it does today is give anonymous
-- callers a username-enumeration oracle.
drop function if exists public.username_available(text);

-- ---- rls_auto_enable(): identified, and deliberately KEPT ------------------
-- This one was flagged alongside the orphans but is a different animal. Its
-- definition begins:
--
--   CREATE OR REPLACE FUNCTION public.rls_auto_enable()
--    RETURNS event_trigger
--
-- It is an EVENT TRIGGER function. It fires on CREATE TABLE in `public` and
-- runs `alter table ... enable row level security` on the new table, logging
-- success or failure and skipping system schemas.
--
-- That makes the linter finding a false positive. PostgreSQL refuses to
-- invoke an event-trigger function directly -- "event trigger functions can
-- only be called as event triggers" -- so /rest/v1/rpc/rls_auto_enable
-- cannot execute it no matter which role calls it. The linter matched on
-- SECURITY DEFINER plus an EXECUTE grant without accounting for the return
-- type.
--
-- It is also genuinely worth keeping: it means any future table added to
-- `public` gets RLS switched on automatically rather than silently shipping
-- world-readable. That is exactly the class of mistake this audit exists to
-- catch, caught by the database itself.
--
-- So: keep the function, drop the pointless grant. Event triggers do not
-- check EXECUTE when firing, so revoking costs nothing and clears the noise.
do $$
begin
  if exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'rls_auto_enable'
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end $$;

-- Worth confirming the event trigger is actually attached -- the function
-- alone does nothing without one wired to it:
--
--   select e.evtname, e.evtevent, e.evtenabled, p.proname
--   from pg_event_trigger e join pg_proc p on p.oid = e.evtfoid;


-- ############################################################################
-- PART 5 — an index the query pattern actually needs
-- ############################################################################

-- loadReadState() fetches every read marker for a conversation on each chat
-- open. The primary key is (conversation_id, user_id) so that lookup is
-- already covered; loadMyReadMarkers() filters by user_id instead, which is
-- not.
create index if not exists idx_conversation_reads_user
  on public.conversation_reads (user_id);

-- ############################################################################
-- PART 6 — verify, rather than assume
-- ############################################################################

-- Two rounds of revokes failed silently before the grantee list was right, so
-- this file now proves its own result instead of trusting that it worked.
-- This SELECT returns the EXECUTE grants that remain.
--
-- EXPECTED OUTPUT: exactly one row --
--   is_conversation_member | authenticated | EXECUTE
--
-- Anything else means a revoke did not land. In particular, any row naming
-- PUBLIC or anon means the function is still reachable at /rest/v1/rpc/.
-- An empty result means is_conversation_member lost its grant, which will
-- break RLS -- re-run the GRANT in Part 4 if so.
select
  p.proname                                                             as function_name,
  case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end as grantee,
  a.privilege_type
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
left join lateral aclexplode(p.proacl) a on true
where n.nspname in ('public', 'private')
  and p.proname in (
    'set_message_sender', 'protect_message_identity', 'sync_message_usernames',
    'set_call_invite_caller', 'protect_call_invite_identity',
    'is_conversation_member'
  )
  and a.privilege_type = 'EXECUTE'
  and case when a.grantee = 0 then 'PUBLIC' else a.grantee::regrole::text end
      not in ('postgres', 'supabase_admin', 'service_role')
order by 1, 2;

-- Done. ✅
-- After running this, re-run the Supabase linter: the public-bucket-listing
-- finding and the anon SECURITY DEFINER findings for this repo's own
-- functions should be gone. Two settings remain dashboard-only:
--   • Auth → enable leaked-password protection (HaveIBeenPwned)
--   • Auth → raise the minimum password length above 6
