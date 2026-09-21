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
-- If this fails with a duplicate-key error, some accounts already share a
-- username. Find them, have one side rename, then re-run:
--   select lower(username), array_agg(username), array_agg(id)
--   from public.profiles group by lower(username) having count(*) > 1;
create unique index if not exists idx_profiles_username_lower
  on public.profiles (lower(username));

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
--    allowing clients to list all files."
--
-- The policy was `using (bucket_id = 'chat-files')` with no role restriction,
-- so the anon role could enumerate the bucket. Attachments are stored
-- unencrypted under random paths, which makes enumeration the whole attack:
-- list the bucket, then read every photo and document any user has ever sent,
-- without holding an account at all.
--
-- A public bucket serves objects over /storage/v1/object/public/... with no
-- policy involved, so images, downloads and avatars keep working. Restricting
-- this policy to authenticated users removes anonymous listing without
-- changing how the app renders anything.
--
-- NOTE: this narrows exposure, it does not make attachments private. Anyone
-- holding an object URL can still read it, and those URLs sit in plaintext in
-- messages.file_url. Encrypting attachment bytes with the conversation key is
-- the real fix — see the audit's recommended next steps.
drop policy if exists "chat-files read"   on storage.objects;
drop policy if exists "chat-files upload" on storage.objects;

create policy "chat-files read" on storage.objects
  for select to authenticated using (bucket_id = 'chat-files');

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

-- For the functions this repo DOES define, anonymous execution is
-- unnecessary: each is either a trigger function or an RLS helper, and no
-- signed-out caller has any reason to reach them over /rest/v1/rpc/.
revoke execute on function public.is_conversation_member(uuid)   from anon;
revoke execute on function public.set_message_sender()           from anon;
revoke execute on function public.protect_message_identity()     from anon;
revoke execute on function public.sync_message_usernames()       from anon;
revoke execute on function public.set_call_invite_caller()       from anon;
revoke execute on function public.protect_call_invite_identity() from anon;

-- Trigger functions are invoked by their trigger, never by a client, so
-- signed-in users have no reason to call them over the REST API either.
revoke execute on function public.set_message_sender()           from authenticated;
revoke execute on function public.protect_message_identity()     from authenticated;
revoke execute on function public.sync_message_usernames()       from authenticated;
revoke execute on function public.set_call_invite_caller()       from authenticated;
revoke execute on function public.protect_call_invite_identity() from authenticated;

-- is_conversation_member stays callable by authenticated users on purpose:
-- RLS policies evaluate it as the calling role, so revoking it would break
-- every policy that depends on it.


-- ############################################################################
-- PART 5 — an index the query pattern actually needs
-- ############################################################################

-- loadReadState() fetches every read marker for a conversation on each chat
-- open. The primary key is (conversation_id, user_id) so that lookup is
-- already covered; loadMyReadMarkers() filters by user_id instead, which is
-- not.
create index if not exists idx_conversation_reads_user
  on public.conversation_reads (user_id);

-- Done. ✅
-- After running this, re-run the Supabase linter: the public-bucket-listing
-- finding and the anon SECURITY DEFINER findings for this repo's own
-- functions should be gone. Two settings remain dashboard-only:
--   • Auth → enable leaked-password protection (HaveIBeenPwned)
--   • Auth → raise the minimum password length above 6
