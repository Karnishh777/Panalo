-- ############################################################################
-- PANALO — COMPLETE DATABASE SETUP
--
-- Every migration, in dependency order, in one file. Paste the whole thing
-- into the Supabase SQL Editor and Run.
--
-- Safe to run on a brand-new project OR on an existing one: every statement
-- checks before it acts, so re-running changes nothing that is already
-- correct. This is the same content as the individual supabase-*.sql files,
-- concatenated -- not a rewrite, so there is no chance of a transcription
-- error that the originals do not have.
--
-- TWO THINGS TO KNOW BEFORE YOU RUN IT
--
-- 1. The SQL Editor runs this as ONE transaction. If any statement fails,
--    EVERYTHING rolls back -- including the parts that would have worked. So
--    a failure means nothing was applied, not that it stopped halfway. Fix
--    the failing statement and run the whole file again.
--
-- 2. Each phase ends with its own verification SELECT, but the editor only
--    shows the result of the LAST one. To check a specific phase, run that
--    file on its own.
--
-- Phase 7 is included for completeness even though phase 8 re-applies all of
-- it; running both is harmless.
--
-- AFTER RUNNING, two settings remain dashboard-only:
--   • Authentication → minimum password length 8+ and required characters
--   • Authentication → leaked-password protection (Pro plan only)
-- ############################################################################



-- ############################################################################
-- SOURCE FILE: supabase-setup.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Supabase backend setup
--
-- Run ONCE in a new Supabase project:
--   Dashboard → SQL Editor → New query → paste this whole file → Run.
-- Safe to re-run (idempotent).
--
-- This creates the schema, the security rules (Row-Level Security), realtime,
-- and the image-storage bucket. After running it, your database enforces who
-- can read/write what — which is why the public "anon" key is safe to ship in
-- the frontend.
-- ============================================================================

create extension if not exists pgcrypto;  -- provides gen_random_uuid()

-- ============================================================================
-- Tables
-- ============================================================================

-- Public profile per auth user. Deliberately NO email column: email stays
-- private in auth.users. Usernames are the only public field (needed so people
-- can start chats by username).
create table if not exists public.profiles (
  id         uuid primary key references auth.users (id) on delete cascade,
  username   text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id         uuid primary key default gen_random_uuid(),
  type       text not null check (type in ('direct', 'group')),
  name       text,
  created_by uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.conversation_participants (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  primary key (conversation_id, user_id)
);

create table if not exists public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  username        text,
  content         text,
  file_url        text,
  created_at      timestamptz not null default now()
);

create index if not exists idx_participants_user
  on public.conversation_participants (user_id);
create index if not exists idx_messages_conversation
  on public.messages (conversation_id, created_at);

-- ============================================================================
-- Membership helper.
-- SECURITY DEFINER runs the lookup as the function owner, bypassing RLS on
-- conversation_participants — this avoids infinite recursion when a policy on
-- that table needs to check membership of that same table.
--
-- It lives in `private`, a schema PostgREST does not publish, so it has no
-- /rest/v1/rpc/ endpoint. It was created in `public` originally and moved by
-- phase 13; creating it here directly is what makes re-running this file safe.
-- When it was still `create ... public.is_conversation_member`, a re-run made
-- a SECOND copy in public, every policy below re-bound to that copy, and
-- phase 13 could then no longer drop it -- so supabase-all.sql failed on any
-- database that had ever run phase 13.
-- ============================================================================
create schema if not exists private;
-- Policies are evaluated as the querying role, which therefore has to be able
-- to reach into the schema. Without this every policy fails closed.
grant usage on schema private to authenticated;

create or replace function private.is_conversation_member(conv uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.conversation_participants
    where conversation_id = conv
      and user_id = auth.uid()
  );
$$;

-- ============================================================================
-- Server-side sender stamping.
-- Forces user_id and username from the authenticated caller so a malicious
-- client cannot spoof who sent a message or under what name.
-- ============================================================================
create or replace function public.set_message_sender()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.user_id  := auth.uid();
  new.username := (select username from public.profiles where id = auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_set_message_sender on public.messages;
create trigger trg_set_message_sender
  before insert on public.messages
  for each row execute function public.set_message_sender();

-- ============================================================================
-- Row-Level Security
-- ============================================================================
alter table public.profiles                  enable row level security;
alter table public.conversations             enable row level security;
alter table public.conversation_participants enable row level security;
alter table public.messages                  enable row level security;

-- ---- profiles: usernames are public (no PII); each user writes only their own row
drop policy if exists "profiles read"   on public.profiles;
drop policy if exists "profiles insert" on public.profiles;
drop policy if exists "profiles update" on public.profiles;

create policy "profiles read"   on public.profiles
  for select to authenticated using (true);
create policy "profiles insert" on public.profiles
  for insert to authenticated with check (id = auth.uid());
create policy "profiles update" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- ---- conversations: visible only to the creator + participants
drop policy if exists "conversations read"   on public.conversations;
drop policy if exists "conversations insert" on public.conversations;

create policy "conversations read" on public.conversations
  for select to authenticated
  using (created_by = auth.uid() or private.is_conversation_member(id));
create policy "conversations insert" on public.conversations
  for insert to authenticated
  with check (created_by = auth.uid());

-- ---- conversation_participants: members can see the roster; only the creator
--      may add participants (covers direct + group creation, blocks joining
--      arbitrary rooms). Extend this when group admins can add members later.
drop policy if exists "participants read"   on public.conversation_participants;
drop policy if exists "participants insert" on public.conversation_participants;

create policy "participants read" on public.conversation_participants
  for select to authenticated
  using (private.is_conversation_member(conversation_id));
create policy "participants insert" on public.conversation_participants
  for insert to authenticated
  with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id
      and c.created_by = auth.uid()
  ));

-- ---- messages: members read; members send as themselves; authors delete their own
drop policy if exists "messages read"   on public.messages;
drop policy if exists "messages insert" on public.messages;
drop policy if exists "messages delete" on public.messages;

create policy "messages read" on public.messages
  for select to authenticated
  using (private.is_conversation_member(conversation_id));
create policy "messages insert" on public.messages
  for insert to authenticated
  with check (user_id = auth.uid() and private.is_conversation_member(conversation_id));
create policy "messages delete" on public.messages
  for delete to authenticated
  using (user_id = auth.uid());

-- ============================================================================
-- Realtime — stream message inserts/deletes to subscribed clients.
-- REPLICA IDENTITY FULL makes DELETE/UPDATE events carry the full old row
-- (useful for future edit/reaction features and precise delete filtering).
-- ============================================================================
alter table public.messages replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;

-- ============================================================================
-- Storage — image attachments (public read, authenticated upload)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('chat-files', 'chat-files', true)
on conflict (id) do nothing;

drop policy if exists "chat-files read"   on storage.objects;
drop policy if exists "chat-files upload" on storage.objects;

create policy "chat-files read" on storage.objects
  for select using (bucket_id = 'chat-files');
create policy "chat-files upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'chat-files');

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-keys.sql
-- ############################################################################

-- ============================================================================
-- PANALO — encryption keys add-on
-- Run this AFTER supabase-setup.sql (SQL Editor → paste → Run). Idempotent.
-- Adds the storage needed for "encryption at rest, recoverable":
--   • each user's public key (shared) + encrypted private key (owner-only)
--   • per-conversation keys wrapped to each member's public key
--   • an IV column on messages (content becomes ciphertext going forward)
-- ============================================================================

-- Public key lives on profiles (world-readable — needed to wrap keys to a user).
alter table public.profiles add column if not exists public_key text;

-- Encrypted private-key material — readable/writable ONLY by its owner.
create table if not exists public.user_keys (
  user_id         uuid primary key references public.profiles (id) on delete cascade,
  enc_private_key text not null,
  key_salt        text not null,
  key_iv          text not null,
  updated_at      timestamptz not null default now()
);

alter table public.user_keys enable row level security;
drop policy if exists "user_keys owner" on public.user_keys;
create policy "user_keys owner" on public.user_keys
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Per-conversation AES key, wrapped to each member's public key.
create table if not exists public.conversation_keys (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  wrapped_key     text not null,
  primary key (conversation_id, user_id)
);

alter table public.conversation_keys enable row level security;
drop policy if exists "conv_keys read"   on public.conversation_keys;
drop policy if exists "conv_keys insert" on public.conversation_keys;

-- You may read only your OWN wrapped key.
create policy "conv_keys read" on public.conversation_keys
  for select to authenticated
  using (user_id = auth.uid());

-- The conversation's creator inserts the wrapped keys for all members.
create policy "conv_keys insert" on public.conversation_keys
  for insert to authenticated
  with check (exists (
    select 1 from public.conversations c
    where c.id = conversation_id and c.created_by = auth.uid()
  ));

-- Messages: add an IV; `content` will hold base64 ciphertext going forward.
-- (Messages with a NULL iv are treated as legacy plaintext by the client.)
alter table public.messages add column if not exists iv text;

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase5.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 5 add-on: profiles (bio + photo), group management,
-- message editing, and member add/remove.
-- Run AFTER supabase-setup.sql + supabase-keys.sql (SQL Editor → paste → Run).
-- Idempotent — safe to re-run.
-- ============================================================================

-- ---- Profiles: bio + display picture --------------------------------------
alter table public.profiles add column if not exists bio        text;
alter table public.profiles add column if not exists avatar_url text;

-- ---- Conversations: group bio (+ theme, in case the theme snippet was skipped)
alter table public.conversations add column if not exists bio   text;
alter table public.conversations add column if not exists theme text;

-- Members may rename a group / edit its bio / change its theme.
drop policy if exists "conversations update" on public.conversations;
create policy "conversations update" on public.conversations
  for update to authenticated
  using (private.is_conversation_member(id))
  with check (private.is_conversation_member(id));

-- ---- Messages: editing -----------------------------------------------------
alter table public.messages add column if not exists edited_at timestamptz;

-- Authors may edit their own messages (content/iv/edited_at).
drop policy if exists "messages update" on public.messages;
create policy "messages update" on public.messages
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and private.is_conversation_member(conversation_id));

-- ---- Group membership: add + remove ---------------------------------------
-- Add: the creator (existing rule) OR any member of a GROUP chat may add people.
drop policy if exists "participants insert" on public.conversation_participants;
create policy "participants insert" on public.conversation_participants
  for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
    or (
      private.is_conversation_member(conversation_id)
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.type = 'group'
      )
    )
  );

-- Remove: you may leave any chat yourself; the group's creator may remove anyone.
drop policy if exists "participants delete" on public.conversation_participants;
create policy "participants delete" on public.conversation_participants
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
  );

-- ---- Encryption keys for member changes -----------------------------------
-- Any member may wrap the conversation key for a newly added member
-- (insert-only; the primary key prevents overwriting an existing wrapped key).
drop policy if exists "conv_keys insert" on public.conversation_keys;
create policy "conv_keys insert" on public.conversation_keys
  for insert to authenticated
  with check (
    private.is_conversation_member(conversation_id)
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
  );

-- Removing someone also removes their wrapped key (self-leave or by the creator).
drop policy if exists "conv_keys delete" on public.conversation_keys;
create policy "conv_keys delete" on public.conversation_keys
  for delete to authenticated
  using (
    user_id = auth.uid()
    or exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
  );

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase6.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 6: reactions, read receipts, and replies.
-- Run AFTER supabase-setup.sql, supabase-keys.sql and supabase-phase5.sql
-- (SQL Editor → paste → Run). Idempotent — safe to re-run.
-- ============================================================================

-- ---- Reactions -------------------------------------------------------------
-- One row per (message, person, emoji), so the primary key alone prevents
-- double-reacting with the same emoji.
create table if not exists public.message_reactions (
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id, emoji)
);

create index if not exists idx_reactions_message on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

drop policy if exists "reactions read"   on public.message_reactions;
drop policy if exists "reactions insert" on public.message_reactions;
drop policy if exists "reactions delete" on public.message_reactions;

-- Anyone in the conversation can see its reactions.
create policy "reactions read" on public.message_reactions
  for select to authenticated
  using (exists (
    select 1 from public.messages m
    where m.id = message_id and private.is_conversation_member(m.conversation_id)
  ));

-- You may only add reactions as yourself, and only in your own conversations.
create policy "reactions insert" on public.message_reactions
  for insert to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from public.messages m
      where m.id = message_id and private.is_conversation_member(m.conversation_id)
    )
  );

-- You may only remove your own reactions.
create policy "reactions delete" on public.message_reactions
  for delete to authenticated
  using (user_id = auth.uid());

-- ---- Read receipts ---------------------------------------------------------
-- One row per person per conversation ("I've read everything up to here"),
-- rather than a row per message — far lighter, and enough for ✓✓.
create table if not exists public.conversation_reads (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  last_read_at    timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.conversation_reads enable row level security;

drop policy if exists "reads read"   on public.conversation_reads;
drop policy if exists "reads insert" on public.conversation_reads;
drop policy if exists "reads update" on public.conversation_reads;

-- Members see each other's read position (that's what powers the ticks).
create policy "reads read" on public.conversation_reads
  for select to authenticated
  using (private.is_conversation_member(conversation_id));

create policy "reads insert" on public.conversation_reads
  for insert to authenticated
  with check (user_id = auth.uid() and private.is_conversation_member(conversation_id));

create policy "reads update" on public.conversation_reads
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- Replies ---------------------------------------------------------------
-- Deleting the quoted message leaves the reply intact (the quote just fades).
alter table public.messages
  add column if not exists reply_to uuid references public.messages (id) on delete set null;

-- ---- Realtime --------------------------------------------------------------
-- FULL replica identity so DELETE events carry enough of the old row for the
-- client to know which reaction disappeared.
alter table public.message_reactions   replica identity full;
alter table public.conversation_reads  replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'message_reactions'
  ) then
    alter publication supabase_realtime add table public.message_reactions;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversation_reads'
  ) then
    alter publication supabase_realtime add table public.conversation_reads;
  end if;
end $$;

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase7.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 7: username uniqueness, trusted call invites, storage limits.
-- Run AFTER supabase-setup.sql, supabase-keys.sql, supabase-phase5.sql and
-- supabase-phase6.sql (SQL Editor → paste → Run). Idempotent — safe to re-run.
-- ============================================================================

-- ---- Username uniqueness ----------------------------------------------------
-- Username lookups throughout the app (starting a direct chat, adding a group
-- member) use case-insensitive matching and trust the first result. Without a
-- uniqueness guarantee, two accounts sharing a username could cause a chat —
-- or a group invite — to silently go to the wrong person.
--
-- If the next statement fails with a "duplicate key" error, some existing
-- accounts already share a username (case-insensitively). Find them first:
--   select lower(username), array_agg(username), array_agg(id)
--   from public.profiles group by lower(username) having count(*) > 1;
-- Have one of each pair rename themselves (Settings → My profile) before
-- re-running this file.
create unique index if not exists idx_profiles_username_lower
  on public.profiles (lower(username));

-- ---- Trusted call invites ----------------------------------------------------
-- Call signaling previously rode entirely on a Realtime Broadcast channel
-- keyed by the recipient's user id, with the caller's identity taken from a
-- client-supplied payload field ("from"). Nothing server-side stopped a
-- malicious client from broadcasting a spoofed "offer" claiming to be someone
-- else — and since profiles.id is readable by any authenticated user (needed
-- for the username lookups above), any account's id is a few keystrokes away.
--
-- The offer and answer — the two messages that establish WHO is calling whom
-- — now go through this table instead, stamped server-side exactly like
-- message sender identity already is. ICE candidates (frequent, low-stakes
-- once both sides are already identity-verified) still ride Broadcast, but on
-- a channel named after this row's own random id rather than a permanent,
-- guessable-by-username per-user channel.
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

-- Force caller_id from the authenticated session — a client cannot place a
-- call "as" someone else. Also resets status/answer_sdp so a client can't
-- insert a row that's already marked answered.
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

-- Lock identity/content fields on update — only status, answer_sdp (the
-- callee's answer, or a fresh offer_sdp for an ICE restart) and updated_at
-- may ever change after creation.
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

-- Only the two people on the call can see it.
create policy "call_invites read" on public.call_invites
  for select to authenticated
  using (caller_id = auth.uid() or callee_id = auth.uid());

-- Anyone can place a call (caller_id is forced server-side regardless of what
-- the client sends); calling yourself is nonsensical, so it's blocked here.
create policy "call_invites insert" on public.call_invites
  for insert to authenticated
  with check (callee_id <> auth.uid());

-- Either party may update the row (answer / decline / end / ICE-restart
-- re-offer) — the trigger above keeps identity fields immutable, so this
-- can't be used to hijack or impersonate the other side of the call.
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

-- ---- Storage: enforce limits server-side ------------------------------------
-- The 50 MB attachment cap and image-type checks the client applies were
-- client-side only — nothing stopped a call directly against the Storage API
-- from uploading arbitrarily large or arbitrarily-typed files, which is a
-- real storage-cost and abuse vector. This mirrors the client's own limit
-- (see MAX_FILE_BYTES in src/config.js) and allows the file types the app
-- actually sends (images for photos/avatars/stickers, plus common document/
-- media types for the "any file" attachment picker).
update storage.buckets
set file_size_limit = 52428800, -- 50 MB, matches MAX_FILE_BYTES
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

-- ---- Encryption: iteration count travels with each key ----------------------
-- PBKDF2 iterations were a hardcoded constant shared by protect/recover. That
-- makes the count impossible to raise later without breaking every already-
-- stored private key (recovering would derive the wrong wrap key with the new
-- constant). Storing it per-row lets the client raise the constant for new/
-- rewrapped keys while old rows keep recovering correctly at their original
-- count. Existing rows default to 200000 — the value already in use.
alter table public.user_keys add column if not exists key_iterations integer not null default 200000;

-- ---- Messages: idempotency key for retried sends ----------------------------
-- A send whose response is lost to a network error (but that actually
-- committed) looks like a failure to the client, which offers Retry — without
-- a way to recognize "this exact send already happened," Retry can create a
-- genuine duplicate message. client_id is a UUID the client generates once
-- per logical send attempt and reuses across retries of that same attempt;
-- the unique index makes a duplicate insert a no-op error instead of a
-- duplicate row. Nullable + no backfill needed: existing rows simply have no
-- client_id, and legacy clients that don't send one are unaffected.
alter table public.messages add column if not exists client_id uuid;
create unique index if not exists idx_messages_client_id on public.messages (client_id) where client_id is not null;

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase8.sql
-- ############################################################################

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


-- ############################################################################
-- SOURCE FILE: supabase-phase9.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 9: let people actually delete the files they sent.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Independent of phase 8; neither depends on the other.
-- ============================================================================

-- WHY THIS EXISTS
--
-- There has never been a DELETE policy on storage.objects. Uploads were
-- write-only: once a photo or file reached the bucket, nothing in the app
-- could remove it. Deleting a message removed only the row pointing at it,
-- and leaving a chat removed only the membership.
--
-- Three consequences, in rising order of seriousness:
--
--   1. Storage only ever grows. On the free tier that is a 1 GB wall the app
--      walks into and cannot back away from; on a paid plan it is a bill
--      that never goes down.
--   2. Orphans accumulate with nothing referencing them, so there is no way
--      to tell from the database which objects are still needed.
--   3. "Delete" did not delete. Someone removing a photo from a chat had
--      every reason to think it was gone. The bytes were still served to
--      anyone holding the URL. That is a gap between what the product says
--      and what it does -- the same class of problem as the encryption
--      claims, and it deserves the same treatment.
--
-- The policy is scoped to the UPLOADER, not to conversation membership.
-- storage.objects.owner is stamped with auth.uid() by the Storage API on
-- upload, so this lets you delete what you sent and nothing else. Deleting a
-- message you wrote cleans up its attachment; leaving a group never touches
-- files other people put there.
--
-- Note for anyone tidying up by hand: storage.protect_delete() blocks
-- `delete from storage.objects` outright, and that guard is deliberate --
-- do not disable it or edit the storage schema to get around it. Removing
-- objects goes through the Storage API (the client's
-- .storage.from(...).remove([...]), or the dashboard's Storage browser),
-- and this policy is what authorises that call.

drop policy if exists "chat-files delete own" on storage.objects;

create policy "chat-files delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-files'
    and owner = auth.uid()
  );

-- Confirm the bucket's policies are what you expect: an INSERT for uploads
-- and this DELETE, and no broad SELECT -- phase 8 removed that, because a
-- public bucket serves objects without consulting RLS and the policy only
-- enabled anonymous listing of the whole bucket.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'chat-files%'
order by cmd;

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase10.sql
-- ############################################################################

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
create or replace function private.shares_conversation_with(other uuid)
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
    or private.shares_conversation_with(id)
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

revoke execute on function private.shares_conversation_with(uuid)  from public, anon, authenticated;
revoke execute on function public.find_profile_by_username(text)  from public, anon, authenticated;
-- Policies evaluate as the querying role, so this one has to be granted back
-- or every profile read fails.
grant execute on function private.shares_conversation_with(uuid) to authenticated;
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


-- ############################################################################
-- SOURCE FILE: supabase-phase11.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 11: roles and permissions in group chats.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- ============================================================================

-- WHY THIS EXISTS
--
-- Groups had no notion of who runs them. Any member could add anyone, rename
-- the group, and change its theme and bio; the only person who could remove
-- someone was whoever happened to create the conversation. In a group of
-- twenty, all twenty could invite strangers in and nobody could stop them —
-- fine among friends, untenable anywhere else.
--
-- Three roles, enforced in the database rather than by hiding buttons:
--
--   owner   created the group, or had it handed to them. Can do everything,
--           including promoting and demoting. Cannot be removed by anyone.
--   admin   can add and remove members, and edit the group's name, bio and
--           theme. Cannot touch owners or change roles.
--   member  can read, write and leave. Nothing else.
--
-- Direct chats are unaffected: two people, no hierarchy, and every rule below
-- either ignores them or treats both sides as equals.


-- ---- The column -------------------------------------------------------
alter table public.conversation_participants
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversation_participants'::regclass
      and conname = 'conversation_participants_role_check'
  ) then
    alter table public.conversation_participants
      add constraint conversation_participants_role_check
      check (role in ('owner', 'admin', 'member'));
  end if;
end $$;

-- Existing groups already have an implied owner: whoever created them. Make
-- it explicit, or every group created before this migration is left with
-- nobody able to administer it.
update public.conversation_participants p
set role = 'owner'
from public.conversations c
where c.id = p.conversation_id
  and c.created_by = p.user_id
  and p.role <> 'owner';


-- ---- Reading your own role -------------------------------------------
-- SECURITY DEFINER so the policies below can call it without recursing
-- through the policies on the very table they protect.
create or replace function private.my_conversation_role(conv uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role
  from public.conversation_participants
  where conversation_id = conv
    and user_id = auth.uid();
$$;

revoke execute on function private.my_conversation_role(uuid) from public, anon;
grant execute on function private.my_conversation_role(uuid) to authenticated;


-- ---- Creating a group makes you its owner -----------------------------
-- Stamped server-side. A client inserting itself as 'member' — or someone
-- else as 'owner' — would otherwise decide the hierarchy for itself.
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

drop trigger if exists trg_stamp_creator_as_owner on public.conversation_participants;
create trigger trg_stamp_creator_as_owner
  before insert on public.conversation_participants
  for each row execute function public.stamp_creator_as_owner();


-- ---- Only owners change roles ----------------------------------------
-- There was no UPDATE policy on this table at all, so roles could not be
-- changed by anyone. Adding one needs care: without the guard below a member
-- could update their own row and make themselves owner.
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

drop trigger if exists trg_guard_role_change on public.conversation_participants;
create trigger trg_guard_role_change
  before update on public.conversation_participants
  for each row execute function public.guard_role_change();

drop policy if exists "participants update" on public.conversation_participants;
create policy "participants update" on public.conversation_participants
  for update to authenticated
  using (private.my_conversation_role(conversation_id) = 'owner')
  with check (private.my_conversation_role(conversation_id) = 'owner');


-- ---- Who may add people ----------------------------------------------
-- Was: the creator, OR any member of a group at all. Now owners and admins
-- only. Direct chats keep the creator rule, because that is how the second
-- participant gets added when the chat is first created.
drop policy if exists "participants insert" on public.conversation_participants;
create policy "participants insert" on public.conversation_participants
  for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
    or (
      private.my_conversation_role(conversation_id) in ('owner', 'admin')
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.type = 'group'
      )
    )
  );


-- ---- Who may remove people -------------------------------------------
-- Anyone may leave. Owners and admins may remove others, but never an owner:
-- that is what stops an admin quietly evicting the person who runs the group.
drop policy if exists "participants delete" on public.conversation_participants;
create policy "participants delete" on public.conversation_participants
  for delete to authenticated
  using (
    user_id = auth.uid()
    or (
      private.my_conversation_role(conversation_id) in ('owner', 'admin')
      and role <> 'owner'
    )
  );

-- If the last owner leaves, the group is left with nobody able to administer
-- it — no one could add, remove, rename or promote, permanently. Hand it to
-- the longest-standing admin, or failing that any remaining member, rather
-- than stranding everyone in it.
create or replace function public.promote_on_owner_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  heir uuid;
begin
  if old.role <> 'owner' then
    return old;
  end if;

  if exists (
    select 1 from public.conversation_participants
    where conversation_id = old.conversation_id and role = 'owner'
  ) then
    return old; -- another owner remains
  end if;

  select user_id into heir
  from public.conversation_participants
  where conversation_id = old.conversation_id
  order by (role = 'admin') desc, ctid
  limit 1;

  if heir is not null then
    update public.conversation_participants
    set role = 'owner'
    where conversation_id = old.conversation_id and user_id = heir;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_promote_on_owner_leave on public.conversation_participants;
create trigger trg_promote_on_owner_leave
  after delete on public.conversation_participants
  for each row execute function public.promote_on_owner_leave();


-- ---- Who may rename or re-theme a group -------------------------------
-- Was: any member. A group's name and picture are its identity, and letting
-- everyone rewrite them is how groups get vandalised. Direct chats keep the
-- member rule, since per-chat theme is a two-person decision there.
drop policy if exists "conversations update" on public.conversations;
create policy "conversations update" on public.conversations
  for update to authenticated
  using (
    (type = 'group' and private.my_conversation_role(id) in ('owner', 'admin'))
    or (type <> 'group' and private.is_conversation_member(id))
  )
  with check (
    (type = 'group' and private.my_conversation_role(id) in ('owner', 'admin'))
    or (type <> 'group' and private.is_conversation_member(id))
  );


-- ---- Verify -----------------------------------------------------------
select 'role column' as check_name,
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public'
                   and table_name = 'conversation_participants'
                   and column_name = 'role'), 'MISSING') as result
union all
select 'owners backfilled',
       (select count(*)::text from public.conversation_participants where role = 'owner')
union all
select 'role triggers',
       (select count(*)::text from pg_trigger
        where tgname in ('trg_stamp_creator_as_owner', 'trg_guard_role_change', 'trg_promote_on_owner_leave'));

-- Expected: role column present as text, one owner per existing conversation,
-- and 3 triggers.

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase12.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 12: lock down the trigger functions phases 10 and 11 added.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- ============================================================================

-- WHY THIS EXISTS
--
-- Phase 8 established the rule: a trigger function is invoked by its trigger
-- and never by a client, so it has no business being reachable at
-- /rest/v1/rpc/. Phases 10 and 11 then added six more trigger functions and
-- did not apply that rule to them, so the linter reported every one as
-- callable by anon.
--
-- Calling them directly does little on its own -- a trigger function invoked
-- outside a trigger has no NEW or OLD row to work with and errors -- but
-- leaving privileges granted that nothing needs is how a small oversight
-- becomes a real finding later, and it makes the linter output noisy enough
-- that a genuine problem could hide in it.
--
-- As in phase 8, this must name all three grantees. PostgreSQL grants EXECUTE
-- on new functions to PUBLIC, and Supabase additionally grants it directly to
-- anon and authenticated, so revoking from only one of them silently does
-- nothing.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    -- Phase 10
    'public.rate_limit_messages()',
    'public.rate_limit_conversations()',
    'public.rate_limit_call_invites()',
    -- Phase 11
    'public.stamp_creator_as_owner()',
    'public.guard_role_change()',
    'public.promote_on_owner_leave()'
  ] loop
    -- to_regprocedure() parses a qualified name and returns NULL if there is
    -- no such function. The obvious-looking alternative -- comparing against
    -- p.oid::regprocedure::text -- does NOT work: regprocedure OMITS the
    -- schema when it is on the search_path, so 'public.rate_limit_messages()'
    -- never matches the 'rate_limit_messages()' it renders as, and the guard
    -- silently skips every revoke it was supposed to protect. That is exactly
    -- what happened on the first run of this file: it reported success and
    -- changed nothing.
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

-- ---- What stays callable, and why --------------------------------------
--
-- These remain granted to `authenticated` deliberately. Each is either an
-- action a signed-in person takes, or a helper that RLS policies evaluate as
-- the querying role -- revoking those would break every policy that uses
-- them and take the app down to silence a warning.
--
--   delete_my_account()            a user deleting their own account
--   find_profile_by_username(text) resolving one name to start a chat
--   my_conversation_role(uuid)     used by policies AND the members UI
--   shares_conversation_with(uuid) used by the profiles read policy
--   is_conversation_member(uuid)   used by most policies in the app
--
-- They will keep appearing under "Signed-In Users Can Execute SECURITY
-- DEFINER Function". That is expected and accepted, not an outstanding
-- issue. Each takes either no argument or one the caller already holds, and
-- none reveals anything about another user.

-- ---- Verify -------------------------------------------------------------
-- Expected: no rows. Anything returned is still reachable by a signed-out
-- caller.
select p.proname as still_callable_by_anon
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'rate_limit_messages', 'rate_limit_conversations', 'rate_limit_call_invites',
    'stamp_creator_as_owner', 'guard_role_change', 'promote_on_owner_leave'
  )
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase13.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 13: move the RLS helpers out of the exposed API schema.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- ============================================================================

-- WHY THIS EXISTS
--
-- Three functions exist only to be evaluated inside RLS policies:
--
--   is_conversation_member(uuid)   used by most policies in the app
--   shares_conversation_with(uuid) used by the profiles read policy
--   my_conversation_role(uuid)     used by the participants and group policies
--
-- They have to stay executable by `authenticated`, because a policy is
-- evaluated as the querying role -- revoking them breaks every policy that
-- depends on them. So they kept appearing as "Signed-In Users Can Execute
-- SECURITY DEFINER Function", and the obvious fix would have taken the app
-- down to silence a warning.
--
-- The linter offers a third option besides revoking and switching to
-- SECURITY INVOKER: move the function out of the exposed API schema.
-- PostgREST only publishes `public`, so a function in `private` has no
-- /rest/v1/rpc/ endpoint at all -- there is nothing left to call, by anyone,
-- which is a stronger outcome than a revoke.
--
-- Policies do not need rewriting. A policy stores its expression as a parsed
-- tree referencing the function's OID, and ALTER FUNCTION ... SET SCHEMA
-- keeps that OID -- so every policy keeps resolving to the same function in
-- its new home. That is what makes this safe to do to live policies.
--
-- Verified beforehand that no client code calls these: the only two .rpc()
-- calls in the app are find_profile_by_username and delete_my_account, and
-- both are dealt with at the bottom of this file.

create schema if not exists private;

-- The querying role needs to reach into the schema as well as execute the
-- function. Without this, every policy fails closed and the app goes blank.
grant usage on schema private to authenticated;

do $$
declare
  fn text;
  pub regprocedure;
  priv regprocedure;
  pub_uses int;
  priv_uses int;
begin
  foreach fn in array array[
    'is_conversation_member(uuid)',
    'shares_conversation_with(uuid)',
    'my_conversation_role(uuid)'
  ] loop
    pub  := to_regprocedure('public.' || fn);
    priv := to_regprocedure('private.' || fn);

    if pub is not null and priv is null then
      -- The original move. ACLs survive it; the schema grant above completes it.
      execute format('alter function %s set schema private', pub);

    elsif pub is not null and priv is not null then
      -- Two copies: one is live, one is a leftover. Which is which depends on
      -- history, and this file has guessed wrong in BOTH directions:
      --
      --   * It first dropped the public copy -- but a re-run of an OLD version
      --     of the earlier phases had re-bound every policy to it, so the
      --     DROP failed and took supabase-all.sql with it.
      --   * A later fix, on another branch, dropped the private copy instead
      --     -- which fails the moment any policy points at `private`, as
      --     phase 14's do.
      --
      -- So stop guessing and ask the catalog. A policy records the function
      -- it calls in pg_depend; the copy nothing depends on is the leftover.
      select count(*) into pub_uses from pg_depend
        where refobjid = pub and classid = 'pg_policy'::regclass;
      select count(*) into priv_uses from pg_depend
        where refobjid = priv and classid = 'pg_policy'::regclass;

      if pub_uses = 0 then
        execute format('drop function %s', pub);
      elsif priv_uses = 0 then
        execute format('drop function %s', priv);
        execute format('alter function %s set schema private', pub);
      else
        -- Both in use. Dropping either breaks policies, and CASCADE would
        -- delete them. Stop with a message that says what to do instead of
        -- a raw dependency error.
        raise exception
          'Both public.% and private.% are used by policies (% and %). Re-run supabase-setup.sql through supabase-phase11.sql from this repository first: they point every policy at private, after which this file can drop the public copy.',
          fn, fn, pub_uses, priv_uses;
      end if;
    end if;
  end loop;
end $$;


-- ---- What cannot be moved, and why -------------------------------------
--
-- Two functions must stay in `public`, because the browser calls them
-- directly and PostgREST only publishes that schema. Moving either one would
-- remove a feature rather than secure it:
--
--   find_profile_by_username(text)
--     How you start a chat with someone you do not share one with yet. It is
--     SECURITY DEFINER precisely so it can see past the profiles read policy
--     -- as SECURITY INVOKER it would be subject to that policy and return
--     nothing for exactly the strangers it exists to find. Its exposure is
--     deliberately minimal: exact match, case-insensitive, at most one row,
--     no wildcards and nothing to iterate over.
--
--   delete_my_account()
--     Deleting a row from auth.users needs privileges the browser must never
--     have, which is the entire reason it is SECURITY DEFINER. It takes no
--     arguments, so there is no id to tamper with -- it can only ever delete
--     the caller's own account.
--
-- Both will keep appearing in the linter. That is an accepted, understood
-- exception rather than an outstanding issue: the alternative in each case
-- is removing the feature.
--
-- Leaked-password protection is the third: it is a Pro-plan feature and
-- cannot be enabled on the free tier at all.


-- ---- Verify -------------------------------------------------------------
-- Expected: three rows, all in `private`. Anything still in `public` did not
-- move, and anything missing means a policy has lost its helper -- check
-- before assuming the app still works.
select n.nspname as schema, p.proname as function
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('is_conversation_member', 'shares_conversation_with', 'my_conversation_role')
order by 2;

-- Sanity check that RLS still works. Run while signed in: it should return
-- your own conversations without error. An error here means the policies
-- cannot reach their helper -- re-run the grant above.
-- select count(*) from public.conversation_participants;

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase14.sql
-- ############################################################################

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


-- ############################################################################
-- SOURCE FILE: supabase-phase15.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 15: disappearing messages
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Covered by tests/migrations.test.mjs.
--
-- A chat can be set so that new messages disappear 24 hours, 7 days or 90
-- days after they are sent -- the same three choices WhatsApp offers. The
-- timer belongs to the CHAT, not to each message, so everyone in it lives by
-- the same rule and can see what that rule is.
--
-- What this does NOT do, and the app says so where the timer is set:
--   - It cannot stop anyone copying, screenshotting or saving a message
--     before it disappears. Nothing can.
--   - Photos and files: the message pointing at them is deleted, but the
--     encrypted blob stays in Storage under a random name. Storage objects
--     can only be removed through the Storage API, not from SQL, so a
--     database job cannot delete them. The blob is ciphertext and nobody who
--     was not already in the chat has its address.
-- ============================================================================


-- ############################################################################
-- PART 1 — the setting and the stamp
-- ############################################################################

-- NULL means off. Only the three offered values are accepted, so a client
-- cannot set "1 second" and make a chat that deletes messages before the
-- other person's phone has fetched them.
alter table public.conversations add column if not exists disappear_after interval;

alter table public.conversations drop constraint if exists conversations_disappear_after_check;
alter table public.conversations add constraint conversations_disappear_after_check
  check (disappear_after is null
         or disappear_after in (interval '1 day', interval '7 days', interval '90 days'));

alter table public.messages add column if not exists expires_at timestamptz;

create index if not exists idx_messages_expires_at
  on public.messages (expires_at)
  where expires_at is not null;

-- The expiry is stamped by the DATABASE from the chat's setting at the moment
-- the message arrives. Were it sent by the client, a sender could simply
-- leave it out and their message would stay forever in a chat everyone else
-- believes is disappearing -- or set it to a second and delete a message
-- before anyone saw it. The client is not asked.
--
-- On UPDATE it is pinned for the same reason: editing a message must not be
-- a way to take it off the timer. The "messages update" policy lets authors
-- change their own rows with no column list, and phase 8 already had to pin
-- username and created_at against exactly that.
--
-- This is its own trigger rather than a line added to phase 8's
-- protect_message_identity(), so re-running phase 8 cannot quietly undo it.
create or replace function public.stamp_message_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ttl interval;
begin
  if tg_op = 'UPDATE' then
    new.expires_at := old.expires_at;
    return new;
  end if;

  select c.disappear_after into ttl
  from public.conversations c
  where c.id = new.conversation_id;

  new.expires_at := case when ttl is null then null else now() + ttl end;
  return new;
end;
$$;

drop trigger if exists trg_stamp_message_expiry on public.messages;
create trigger trg_stamp_message_expiry
  before insert or update on public.messages
  for each row execute function public.stamp_message_expiry();

revoke execute on function public.stamp_message_expiry() from public, anon, authenticated;


-- ############################################################################
-- PART 2 — gone means gone, even before the clean-up runs
-- ############################################################################

-- Deleting expired rows is a scheduled job (part 3), so for up to fifteen
-- minutes an expired row still exists. It must not still be READABLE: a
-- client that reloads in that window would otherwise show a message its
-- sender was promised had disappeared. Restrictive, so it narrows "messages
-- read" rather than adding another way in.
drop policy if exists "expired messages are gone" on public.messages;
create policy "expired messages are gone" on public.messages
  as restrictive
  for select to authenticated
  using (expires_at is null or expires_at > now());


-- ############################################################################
-- PART 3 — the clean-up
-- ############################################################################

-- In `private`, which the API does not expose, so nobody can call it over
-- PostgREST. It needs no caller: pg_cron runs it.
create schema if not exists private;

create or replace function private.purge_disappeared_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.messages where expires_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function private.purge_disappeared_messages() from public, anon, authenticated;

-- pg_cron is included on every Supabase plan, free included; it only has to
-- be switched on. If this database cannot have it, say so instead of failing:
-- part 2 still hides expired messages from everyone, they just are not
-- deleted until the job exists.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Scheduling under a name that already exists replaces that job, so a
    -- re-run updates the schedule rather than adding a second copy.
    perform cron.schedule(
      'panalo-purge-disappeared',
      '*/15 * * * *',
      'select private.purge_disappeared_messages()'
    );
  else
    raise notice 'pg_cron is not available: expired messages are hidden but not deleted.';
  end if;
end;
$$;


-- ############################################################################
-- PART 4 — verify
-- ############################################################################

-- EXPECTED OUTPUT, one row per check:
--   timer column                        interval
--   allowed timers                      1 day, 7 days, 90 days
--   expiry stamped by the database      yes
--   expired messages hidden             yes
--   clean-up scheduled                  every 15 minutes
--   callable SECURITY DEFINER functions delete_my_account, find_profile_by_username
select 'timer column' as check_name,
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public' and table_name = 'conversations'
                   and column_name = 'disappear_after'), 'MISSING') as result
union all
select 'allowed timers',
       (select case when pg_get_constraintdef(oid) like '%1 day%7 days%90 days%'
                    then '1 day, 7 days, 90 days' else pg_get_constraintdef(oid) end
        from pg_constraint where conname = 'conversations_disappear_after_check')
union all
select 'expiry stamped by the database',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_trigger
        where tgname = 'trg_stamp_message_expiry')
union all
select 'expired messages hidden',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_policies
        where schemaname = 'public' and tablename = 'messages'
          and policyname = 'expired messages are gone' and permissive = 'RESTRICTIVE')
union all
select 'clean-up scheduled',
       case
         when not exists (select 1 from pg_extension where extname = 'pg_cron')
           then 'NO: pg_cron unavailable, expired messages are hidden only'
         else 'every 15 minutes'
       end
union all
select 'callable SECURITY DEFINER functions',
       (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase16.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 16: Panalo Students
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Covered by tests/migrations.test.mjs.
--
-- Panalo Students (students/) is a second front end on the SAME project as
-- Panalo Chat: same accounts, same encrypted conversations. Nothing here
-- changes how an existing chat works for someone who never opens Students,
-- with three deliberate exceptions that apply to both apps:
--
--   * Blocking someone hides their messages from you everywhere, and stops
--     them adding you to chats.
--   * A temporary room that has ended disappears for everyone in it.
--   * A room set to "hosts post" only accepts messages from its hosts.
--
-- What is new:
--   PART 1  your study life: profile, tasks, focus sessions, timetable and
--           calendar, activity log, goals. Private to you.
--   PART 2  the archive: files in a PRIVATE bucket, readable only by you or
--           by the circle you shared them with. Not end-to-end encrypted --
--           the server enforces who may read, and the app says so.
--   PART 3  safety: blocking and reporting.
--   PART 4  circles and rooms: what kind of group a chat is, rooms that end,
--           hosts-only posting, join codes with a waiting room.
-- ============================================================================

create schema if not exists private;
grant usage on schema private to authenticated;


-- ############################################################################
-- PART 0 — a cap on rows per person
-- ############################################################################

-- Every table below is written straight from the browser with the public
-- key. Without a ceiling one account could fill the 500 MB database on its
-- own. The caps sit far above what a real student produces in years.
--
-- SECURITY INVOKER on purpose: it counts only rows the caller can see, and
-- every table it guards shows you exactly your own rows.
create or replace function private.cap_rows_per_user()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cap integer := tg_argv[0]::integer;
  col text := coalesce(tg_argv[1], 'user_id');
  n integer;
begin
  execute format('select count(*) from %I.%I where %I = $1', tg_table_schema, tg_table_name, col)
    into n using auth.uid();
  if n >= cap then
    raise exception 'You have reached the limit of % here. Remove something old first.', cap
      using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.cap_rows_per_user() from public, anon, authenticated;


-- ############################################################################
-- PART 1 — your study life (private to you)
-- ############################################################################

-- Created at the end of onboarding. born_at is when "your universe" began:
-- the world's age is measured from it.
create table if not exists public.student_profiles (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  world_name text check (world_name is null or char_length(btrim(world_name)) between 1 and 40),
  interests  text[] not null default '{}' check (cardinality(interests) <= 12),
  born_at    timestamptz not null default now()
);

create table if not exists public.student_tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 1 and 200),
  subject    text check (subject is null or char_length(subject) <= 40),
  due_at     timestamptz,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_student_tasks_user on public.student_tasks (user_id, done_at);

-- One row per focus block that actually happened. focused_minutes is what
-- counts; a session abandoned after 7 minutes records 7.
create table if not exists public.focus_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject         text check (subject is null or char_length(subject) <= 40),
  task_id         uuid references public.student_tasks (id) on delete set null,
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  planned_minutes integer not null check (planned_minutes between 1 and 240),
  focused_minutes integer not null check (focused_minutes between 0 and 240),
  completed       boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint focus_sessions_order check (ended_at >= started_at),
  -- You cannot have focused for longer than the session lasted.
  constraint focus_sessions_plausible
    check (focused_minutes <= ceil(extract(epoch from (ended_at - started_at)) / 60.0) + 1)
);
create index if not exists idx_focus_sessions_user on public.focus_sessions (user_id, started_at desc);

-- Timetable and calendar in one table: a weekly-repeating class is a
-- timetable slot; everything else is a dated entry. Times are instants; the
-- browser renders them in its own time zone.
create table if not exists public.student_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  kind          text not null check (kind in ('class', 'study', 'deadline', 'event', 'personal')),
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  repeat_weekly boolean not null default false,
  location      text check (location is null or char_length(location) <= 80),
  created_at    timestamptz not null default now(),
  constraint student_events_order check (ends_at is null or ends_at >= starts_at)
);
create index if not exists idx_student_events_user on public.student_events (user_id, starts_at);

-- Things you did that are not a focus session: reading, making something,
-- moving, resting, time with people. They shape different parts of the
-- world (see students/js/world-model.js).
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('read', 'create', 'move', 'rest', 'connect')),
  minutes     integer not null check (minutes between 1 and 720),
  note        text check (note is null or char_length(note) <= 140),
  occurred_on date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists idx_activity_log_user on public.activity_log (user_id, occurred_on desc);

-- A goal is either a weekly focus target (weekly_minutes set, optionally for
-- one subject) or a one-off milestone you mark done.
create table if not exists public.student_goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 80),
  weekly_minutes integer check (weekly_minutes is null or weekly_minutes between 15 and 6000),
  subject        text check (subject is null or char_length(subject) <= 40),
  done_at        timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.student_profiles enable row level security;
alter table public.student_tasks    enable row level security;
alter table public.focus_sessions   enable row level security;
alter table public.student_events   enable row level security;
alter table public.activity_log     enable row level security;
alter table public.student_goals    enable row level security;

drop policy if exists "student_profiles own" on public.student_profiles;
create policy "student_profiles own" on public.student_profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "student_tasks own" on public.student_tasks;
create policy "student_tasks own" on public.student_tasks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "student_events own" on public.student_events;
create policy "student_events own" on public.student_events
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "activity_log own" on public.activity_log;
create policy "activity_log own" on public.activity_log
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "student_goals own" on public.student_goals;
create policy "student_goals own" on public.student_goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A session may point at a task, but only one of your own: a foreign key is
-- checked without RLS, so without this you could attach a session to
-- anyone's task id.
drop policy if exists "focus_sessions own" on public.focus_sessions;
create policy "focus_sessions own" on public.focus_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (task_id is null or exists (
      select 1 from public.student_tasks t where t.id = task_id and t.user_id = auth.uid()
    ))
  );

drop trigger if exists trg_cap_student_tasks on public.student_tasks;
create trigger trg_cap_student_tasks before insert on public.student_tasks
  for each row execute function private.cap_rows_per_user('5000');
drop trigger if exists trg_cap_focus_sessions on public.focus_sessions;
create trigger trg_cap_focus_sessions before insert on public.focus_sessions
  for each row execute function private.cap_rows_per_user('20000');
drop trigger if exists trg_cap_student_events on public.student_events;
create trigger trg_cap_student_events before insert on public.student_events
  for each row execute function private.cap_rows_per_user('3000');
drop trigger if exists trg_cap_activity_log on public.activity_log;
create trigger trg_cap_activity_log before insert on public.activity_log
  for each row execute function private.cap_rows_per_user('20000');
drop trigger if exists trg_cap_student_goals on public.student_goals;
create trigger trg_cap_student_goals before insert on public.student_goals
  for each row execute function private.cap_rows_per_user('24');


-- ############################################################################
-- PART 2 — the archive
-- ############################################################################

-- PRIVATE, unlike chat-files: nothing here is served without a signed URL,
-- and a signed URL is only issued to someone the policies below allow.
insert into storage.buckets (id, name, public, file_size_limit)
values ('student-resources', 'student-resources', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Where a file lives says who may read it:
--   u/<your user id>/<random>          only you
--   c/<conversation id>/<random>       everyone in that circle
create table if not exists public.resources (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  shelf           text check (shelf is null or char_length(btrim(shelf)) between 1 and 40),
  title           text not null check (char_length(btrim(title)) between 1 and 120),
  object_path     text not null unique,
  file_name       text not null check (char_length(file_name) between 1 and 200),
  mime_type       text check (mime_type is null or char_length(mime_type) <= 120),
  size_bytes      bigint not null check (size_bytes between 0 and 52428800),
  note            text check (note is null or char_length(note) <= 280),
  created_at      timestamptz not null default now(),
  constraint resources_path_matches_scope check (
    (conversation_id is null and object_path like 'u/' || owner_id::text || '/%')
    or (conversation_id is not null and object_path like 'c/' || conversation_id::text || '/%')
  )
);
create index if not exists idx_resources_owner on public.resources (owner_id, created_at desc);
create index if not exists idx_resources_conversation on public.resources (conversation_id, created_at desc);

alter table public.resources enable row level security;

drop policy if exists "resources read" on public.resources;
create policy "resources read" on public.resources
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (conversation_id is not null and private.is_conversation_member(conversation_id))
  );

drop policy if exists "resources insert" on public.resources;
create policy "resources insert" on public.resources
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (conversation_id is null or private.is_conversation_member(conversation_id))
  );

drop policy if exists "resources update" on public.resources;
create policy "resources update" on public.resources
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- The uploader, or a host of the circle it was shared into (so a host can
-- take down something that should not be there).
drop policy if exists "resources delete" on public.resources;
create policy "resources delete" on public.resources
  for delete to authenticated
  using (
    owner_id = auth.uid()
    or (conversation_id is not null
        and private.my_conversation_role(conversation_id) in ('owner', 'admin'))
  );

-- The row must describe a file that really is in the bucket, uploaded by
-- the same person; its size is taken from Storage, not from the client; and
-- each person's archive is capped. On UPDATE only the label fields move.
-- Definer so it can see the object regardless of the caller's read access
-- (phase 17 gates reads on a row existing); it still checks the owner.
-- Kept IDENTICAL to supabase-phase17.sql.
create or replace function private.check_resource_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj_size  bigint;
  obj_owner uuid;
  used      bigint;
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.owner_id        := old.owner_id;
    new.conversation_id := old.conversation_id;
    new.object_path     := old.object_path;
    new.file_name       := old.file_name;
    new.mime_type       := old.mime_type;
    new.size_bytes      := old.size_bytes;
    new.created_at      := old.created_at;
    return new;
  end if;

  select (o.metadata ->> 'size')::bigint, o.owner into obj_size, obj_owner
  from storage.objects o
  where o.bucket_id = 'student-resources' and o.name = new.object_path;

  if not found then
    raise exception 'Upload the file before adding it to the archive.' using errcode = '23503';
  end if;
  if obj_owner is distinct from auth.uid() then
    raise exception 'That file was uploaded by someone else.' using errcode = '42501';
  end if;
  if obj_size is not null then
    new.size_bytes := obj_size;
  end if;

  select coalesce(sum(r.size_bytes), 0) into used from public.resources r where r.owner_id = auth.uid();
  if used + new.size_bytes > 200 * 1024 * 1024 then
    raise exception 'Your archive is full (200 MB). Remove something to make room.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_resource_row() from public, anon, authenticated;

drop trigger if exists trg_check_resource_row on public.resources;
create trigger trg_check_resource_row
  before insert or update on public.resources
  for each row execute function private.check_resource_row();

drop trigger if exists trg_cap_resources on public.resources;
create trigger trg_cap_resources before insert on public.resources
  for each row execute function private.cap_rows_per_user('1000', 'owner_id');

-- Storage. The second path segment is cast to uuid only after it has been
-- shown to look like one: CASE is the one construct whose evaluation order
-- Postgres guarantees, so a malformed name is refused instead of erroring.
create or replace function private.may_use_resource_path(path text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when split_part(path, '/', 1) = 'u'
      then split_part(path, '/', 2) = auth.uid()::text
    when split_part(path, '/', 1) = 'c'
         and split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_conversation_member(split_part(path, '/', 2)::uuid)
    else false
  end;
$$;

revoke execute on function private.may_use_resource_path(text) from public, anon;
grant execute on function private.may_use_resource_path(text) to authenticated;

-- The bucket's read, upload and remove policies are in
-- supabase-phase17.sql. They used to be here, and were too wide: reads
-- checked only the path (a host-removed file stayed downloadable) and
-- uploads had no quota. Until phase 17 runs, the bucket refuses everyone.
drop policy if exists "student-resources read" on storage.objects;
drop policy if exists "student-resources upload" on storage.objects;
drop policy if exists "student-resources delete own" on storage.objects;


-- ############################################################################
-- PART 3 — safety: blocking and reporting
-- ############################################################################

create table if not exists public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

drop policy if exists "blocks own" on public.blocks;
create policy "blocks own" on public.blocks
  for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- You never see messages from someone you blocked, in either app.
-- Restrictive, so it narrows "messages read" rather than adding a way in.
drop policy if exists "blocked senders are hidden" on public.messages;
create policy "blocked senders are hidden" on public.messages
  as restrictive
  for select to authenticated
  using (not exists (
    select 1 from public.blocks b
    where b.blocker_id = auth.uid() and b.blocked_id = messages.user_id
  ));

-- Someone you blocked cannot put you into a chat: not a new 1:1, not a
-- group, not a room. Definer because the block row belongs to the person
-- being added, which the person adding them cannot (and must not) read.
create or replace function private.refuse_blocked_adds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.user_id <> auth.uid() and exists (
    select 1 from public.blocks b
    where b.blocker_id = new.user_id and b.blocked_id = auth.uid()
  ) then
    raise exception 'This person can''t be added.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function private.refuse_blocked_adds() from public, anon, authenticated;

drop trigger if exists trg_refuse_blocked_adds on public.conversation_participants;
create trigger trg_refuse_blocked_adds
  before insert on public.conversation_participants
  for each row execute function private.refuse_blocked_adds();

-- Reports go to whoever operates this deployment (read them in the
-- dashboard). Message text is ciphertext on the server, so the reporter
-- may attach the decrypted text as evidence -- the app asks first.
-- The reporter's id is kept null-able so deleting your account does not
-- delete the reports you filed.
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid default auth.uid() references public.profiles (id) on delete set null,
  reported_user_id uuid references public.profiles (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  message_id       uuid references public.messages (id) on delete set null,
  reason           text not null check (reason in ('harassment', 'spam', 'inappropriate', 'impersonation', 'safety', 'other')),
  details          text check (details is null or char_length(details) <= 1000),
  evidence         text check (evidence is null or char_length(evidence) <= 4000),
  status           text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at       timestamptz not null default now()
);
create index if not exists idx_reports_reporter on public.reports (reporter_id, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "reports insert" on public.reports;
create policy "reports insert" on public.reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and status = 'open'
    and (conversation_id is null or private.is_conversation_member(conversation_id))
  );

drop policy if exists "reports read own" on public.reports;
create policy "reports read own" on public.reports
  for select to authenticated using (reporter_id = auth.uid());

create or replace function private.rate_limit_reports()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.reports r
      where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent a lot of reports today. Try again tomorrow.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.rate_limit_reports() from public, anon, authenticated;

drop trigger if exists trg_rate_limit_reports on public.reports;
create trigger trg_rate_limit_reports before insert on public.reports
  for each row execute function private.rate_limit_reports();


-- ############################################################################
-- PART 4 — circles and rooms
-- ############################################################################

-- What a group is FOR. NULL is an ordinary group made in Panalo Chat.
alter table public.conversations add column if not exists kind text;
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check
  check (kind is null or kind in ('crew', 'study', 'class', 'project', 'event'));

-- A room that ends. After this moment it is hidden from everyone; a day
-- later it is deleted with everything in it.
alter table public.conversations add column if not exists ends_at timestamptz;
alter table public.conversations drop constraint if exists conversations_ends_at_check;
alter table public.conversations add constraint conversations_ends_at_check
  check (ends_at is null or type = 'group');

-- Who may post: everyone, or only owners and admins (announcements).
alter table public.conversations add column if not exists posting text not null default 'everyone';
alter table public.conversations drop constraint if exists conversations_posting_check;
alter table public.conversations add constraint conversations_posting_check
  check (posting in ('everyone', 'hosts'));

-- An end date must be in the future when set, and no more than 60 days out:
-- a "temporary" room that runs for years is just a group.
create or replace function private.check_room_end()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Rules for people; a migration or the dashboard (no signed-in user) may
  -- set anything, e.g. to end a room early by hand.
  if auth.uid() is null then
    return new;
  end if;
  if new.ends_at is not null
     and (tg_op = 'INSERT' or new.ends_at is distinct from old.ends_at) then
    if new.ends_at <= now() then
      raise exception 'A room has to end in the future.' using errcode = '22023';
    end if;
    if new.ends_at > now() + interval '60 days' then
      raise exception 'A temporary room can last at most 60 days.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.check_room_end() from public, anon, authenticated;

drop trigger if exists trg_check_room_end on public.conversations;
create trigger trg_check_room_end
  before insert or update on public.conversations
  for each row execute function private.check_room_end();

-- Helpers for the policies below. Definer, because they read
-- conversations, whose own policies would otherwise hide exactly the rows
-- (ended rooms) they need to see. In `private`: no API endpoint.
create or replace function private.conversation_ended(conv uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((select c.ends_at <= now() from public.conversations c where c.id = conv), false);
$$;

create or replace function private.may_post(conv uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select c.posting = 'everyone'
           or exists (select 1 from public.conversation_participants p
                      where p.conversation_id = conv and p.user_id = auth.uid()
                        and p.role in ('owner', 'admin'))
    from public.conversations c where c.id = conv
  ), false);
$$;

revoke execute on function private.conversation_ended(uuid) from public, anon;
revoke execute on function private.may_post(uuid) from public, anon;
grant execute on function private.conversation_ended(uuid) to authenticated;
grant execute on function private.may_post(uuid) to authenticated;

drop policy if exists "ended rooms are gone" on public.conversations;
create policy "ended rooms are gone" on public.conversations
  as restrictive
  for select to authenticated
  using (ends_at is null or ends_at > now());

drop policy if exists "ended rooms are silent" on public.messages;
create policy "ended rooms are silent" on public.messages
  as restrictive
  for select to authenticated
  using (not private.conversation_ended(conversation_id));

-- Posting rules. A key request (src/keystatus.js) is always allowed: it is
-- how someone who cannot read a room asks to be let back in.
drop policy if exists "rooms decide who posts" on public.messages;
create policy "rooms decide who posts" on public.messages
  as restrictive
  for insert to authenticated
  with check (
    not private.conversation_ended(conversation_id)
    and (private.may_post(conversation_id) or (iv is null and content = '[[keyrequest]]'))
  );

-- ---- Join codes and the waiting room ------------------------------------
-- A host makes a code. Anyone with the code can ASK to join; a host lets
-- them in. Letting someone in is what shares the room's key with them, so
-- it stays a person's decision -- the same trust src/keyshare.js asks for.
create table if not exists public.room_codes (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  code            text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists public.room_requests (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  username        text not null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists idx_room_requests_user on public.room_requests (user_id, created_at desc);

alter table public.room_codes    enable row level security;
alter table public.room_requests enable row level security;

drop policy if exists "room_codes hosts" on public.room_codes;
create policy "room_codes hosts" on public.room_codes
  for all to authenticated
  using (private.my_conversation_role(conversation_id) in ('owner', 'admin'))
  with check (
    private.my_conversation_role(conversation_id) in ('owner', 'admin')
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'group')
  );

-- No insert policy: requests are only made through request_to_join().
drop policy if exists "room_requests read" on public.room_requests;
create policy "room_requests read" on public.room_requests
  for select to authenticated
  using (user_id = auth.uid() or private.my_conversation_role(conversation_id) in ('owner', 'admin'));

drop policy if exists "room_requests delete" on public.room_requests;
create policy "room_requests delete" on public.room_requests
  for delete to authenticated
  using (user_id = auth.uid() or private.my_conversation_role(conversation_id) in ('owner', 'admin'));

-- Ask to join a room by its code.
--
-- SECURITY DEFINER for the same reason as find_profile_by_username: a code
-- has to find a room the caller cannot see yet. It reveals nothing else:
-- one exact code in, at most that room's name out, and only to someone who
-- was given the code. Statuses: 'pending', 'member', 'invalid'.
-- Every attempt counts toward 30 an hour, so codes can't be guessed.
-- Kept IDENTICAL to supabase-phase17.sql.
create table if not exists private.join_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists idx_join_attempts_user on private.join_attempts (user_id, at desc);
revoke all on private.join_attempts from public, anon, authenticated;

create or replace function public.request_to_join(code text)
returns table (conversation_id uuid, name text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  room   record;
  who    text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  delete from private.join_attempts a where a.at < now() - interval '1 day';
  if (select count(*) from private.join_attempts a
      where a.user_id = auth.uid() and a.at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many join attempts. Wait a while and try again.' using errcode = '54000';
  end if;
  insert into private.join_attempts (user_id) values (auth.uid());

  select c.id, c.name, c.created_by into room
  from public.room_codes rc
  join public.conversations c on c.id = rc.conversation_id
  where rc.code = wanted
    and (c.ends_at is null or c.ends_at > now());

  -- Unknown code, ended room, or a host who blocked you: the same answer,
  -- so a code cannot be used to learn which of those it was.
  if not found then
    return query select null::uuid, null::text, 'invalid'::text;
    return;
  end if;
  if exists (select 1 from public.blocks b where b.blocker_id = room.created_by and b.blocked_id = auth.uid()) then
    return query select null::uuid, null::text, 'invalid'::text;
    return;
  end if;

  if exists (select 1 from public.conversation_participants p
             where p.conversation_id = room.id and p.user_id = auth.uid()) then
    return query select room.id, room.name, 'member'::text;
    return;
  end if;

  select p.username into who from public.profiles p where p.id = auth.uid();
  insert into public.room_requests (conversation_id, user_id, username)
  values (room.id, auth.uid(), coalesce(who, 'someone'))
  on conflict on constraint room_requests_pkey do nothing;

  return query select room.id, room.name, 'pending'::text;
end;
$$;

revoke execute on function public.request_to_join(text) from public, anon;
grant execute on function public.request_to_join(text) to authenticated;

-- Once someone is in, their request is done.
create or replace function private.clear_room_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.room_requests r
  where r.conversation_id = new.conversation_id and r.user_id = new.user_id;
  return new;
end;
$$;

revoke execute on function private.clear_room_request() from public, anon, authenticated;

drop trigger if exists trg_clear_room_request on public.conversation_participants;
create trigger trg_clear_room_request
  after insert on public.conversation_participants
  for each row execute function private.clear_room_request();

-- room_requests is deliberately NOT in the realtime publication: Realtime
-- does not apply RLS to DELETE events, so it would broadcast who asked to
-- join which room to everyone. Hosts poll instead. (Phase 17 removes it
-- from databases that ran an earlier version of this file.)

-- Ended rooms are deleted a day after they end (and everything in them, by
-- cascade). Archive FILES shared into them stay in Storage, for the same
-- reason as phase 15: a database job cannot remove Storage objects.
create or replace function private.purge_ended_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.conversations where ends_at <= now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function private.purge_ended_rooms() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('panalo-purge-ended-rooms', '17 * * * *', 'select private.purge_ended_rooms()');
  else
    raise notice 'pg_cron is not available: ended rooms are hidden but not deleted.';
  end if;
end;
$$;


-- ############################################################################
-- PART 5 — verify
-- ############################################################################

-- EXPECTED OUTPUT, one row per check:
--   students tables                     10 of 10
--   archive bucket                      private
--   blocked senders hidden              yes
--   ended rooms hidden                  yes
--   callable SECURITY DEFINER functions delete_my_account, find_profile_by_username, request_to_join
select 'students tables' as check_name,
       (select count(*) || ' of 10' from information_schema.tables
        where table_schema = 'public'
          and table_name in ('student_profiles', 'student_tasks', 'focus_sessions', 'student_events',
                             'activity_log', 'student_goals', 'resources', 'blocks', 'reports',
                             'room_codes')) as result
union all
select 'archive bucket',
       (select case when public then 'PUBLIC: re-run this file' else 'private' end
        from storage.buckets where id = 'student-resources')
union all
select 'blocked senders hidden',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_policies
        where tablename = 'messages' and policyname = 'blocked senders are hidden')
union all
select 'ended rooms hidden',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_policies
        where tablename = 'conversations' and policyname = 'ended rooms are gone')
union all
select 'callable SECURITY DEFINER functions',
       (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase17.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 17: Panalo Students, hardened
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Run AFTER phase 16. Covered by tests/migrations.test.mjs.
--
-- Fixes from a review of phase 16. Each part names the hole it closes.
-- supabase-phase16.sql was corrected in the same way, so re-running it can
-- never bring a hole back; the definitions here and there are identical.
-- ============================================================================

create schema if not exists private;
grant usage on schema private to authenticated;


-- ############################################################################
-- PART 1 — archive files: who may read, upload and remove them
-- ############################################################################

-- Was: anyone in a circle could read c/<circle>/... by path alone. A host
-- "removing" a file deleted only its listing, and the file stayed
-- downloadable by every member through the Storage API.
-- Now: a shared file is readable only while it is LISTED (has a resources
-- row). Its uploader can always read their own file -- even after leaving
-- the circle it was shared into, since it still counts against their quota.
create or replace function private.may_read_resource_object(path text, obj_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when obj_owner = auth.uid() then true
    when split_part(path, '/', 1) = 'u'
      then split_part(path, '/', 2) = auth.uid()::text
    when split_part(path, '/', 1) = 'c'
         and split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_conversation_member(split_part(path, '/', 2)::uuid)
           and exists (select 1 from public.resources r where r.object_path = path)
    else false
  end;
$$;

-- Was: uploads were checked only for their path, while the 200 MB quota and
-- the 1000-file cap lived on resources rows -- so uploading without ever
-- creating a row had no limit at all. Now the bucket itself refuses an
-- upload once your stored bytes or file count reach the ceiling.
create or replace function private.storage_quota_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0) < 200 * 1024 * 1024
     and count(*) < 1000
  from storage.objects o
  where o.bucket_id = 'student-resources' and o.owner = auth.uid();
$$;

-- A host may take a file down from a circle they run, bytes included.
create or replace function private.may_remove_resource_object(path text, obj_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select obj_owner = auth.uid()
      or (split_part(path, '/', 1) = 'c'
          and split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and private.my_conversation_role(split_part(path, '/', 2)::uuid) in ('owner', 'admin'));
$$;

revoke execute on function private.may_read_resource_object(text, uuid) from public, anon;
revoke execute on function private.storage_quota_ok() from public, anon;
revoke execute on function private.may_remove_resource_object(text, uuid) from public, anon;
grant execute on function private.may_read_resource_object(text, uuid) to authenticated;
grant execute on function private.storage_quota_ok() to authenticated;
grant execute on function private.may_remove_resource_object(text, uuid) to authenticated;

-- Phase 16's policies, by their old names, go; these replace them.
drop policy if exists "student-resources read" on storage.objects;
drop policy if exists "student-resources upload" on storage.objects;
drop policy if exists "student-resources delete own" on storage.objects;

drop policy if exists "student-resources read listed" on storage.objects;
create policy "student-resources read listed" on storage.objects
  for select to authenticated
  using (bucket_id = 'student-resources' and private.may_read_resource_object(name, owner));

drop policy if exists "student-resources upload within quota" on storage.objects;
create policy "student-resources upload within quota" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-resources'
    and private.may_use_resource_path(name)
    and private.storage_quota_ok()
  );

drop policy if exists "student-resources remove" on storage.objects;
create policy "student-resources remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-resources' and private.may_remove_resource_object(name, owner));

-- The row check reads storage.objects to confirm the file exists and is
-- the caller's. With reads now gated on a row existing, it must not depend
-- on the caller's read access: definer, and it still checks the owner.
create or replace function private.check_resource_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj_size  bigint;
  obj_owner uuid;
  used      bigint;
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.owner_id        := old.owner_id;
    new.conversation_id := old.conversation_id;
    new.object_path     := old.object_path;
    new.file_name       := old.file_name;
    new.mime_type       := old.mime_type;
    new.size_bytes      := old.size_bytes;
    new.created_at      := old.created_at;
    return new;
  end if;

  select (o.metadata ->> 'size')::bigint, o.owner into obj_size, obj_owner
  from storage.objects o
  where o.bucket_id = 'student-resources' and o.name = new.object_path;

  if not found then
    raise exception 'Upload the file before adding it to the archive.' using errcode = '23503';
  end if;
  if obj_owner is distinct from auth.uid() then
    raise exception 'That file was uploaded by someone else.' using errcode = '42501';
  end if;
  if obj_size is not null then
    new.size_bytes := obj_size;
  end if;

  select coalesce(sum(r.size_bytes), 0) into used from public.resources r where r.owner_id = auth.uid();
  if used + new.size_bytes > 200 * 1024 * 1024 then
    raise exception 'Your archive is full (200 MB). Remove something to make room.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_resource_row() from public, anon, authenticated;


-- ############################################################################
-- PART 2 — the waiting room is not broadcast
-- ############################################################################

-- Was: room_requests was in the realtime publication. Realtime does not
-- apply RLS to DELETE events, and a delete carries the primary key -- so
-- every signed-in client could watch who asked to join which room. Hosts
-- now poll their waiting rooms instead (students/js/signals-data.js).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_requests'
  ) then
    alter publication supabase_realtime drop table public.room_requests;
  end if;
end $$;


-- ############################################################################
-- PART 3 — guessing join codes
-- ############################################################################

-- Was: the limit counted only successful requests, so wrong codes -- the
-- whole point of guessing -- were free. Now every attempt counts: 30 an
-- hour per person, whatever the answer. Attempts live in `private`, out of
-- the API's reach, and are forgotten after a day.
create table if not exists private.join_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists idx_join_attempts_user on private.join_attempts (user_id, at desc);
revoke all on private.join_attempts from public, anon, authenticated;

create or replace function public.request_to_join(code text)
returns table (conversation_id uuid, name text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  room   record;
  who    text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  delete from private.join_attempts a where a.at < now() - interval '1 day';
  if (select count(*) from private.join_attempts a
      where a.user_id = auth.uid() and a.at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many join attempts. Wait a while and try again.' using errcode = '54000';
  end if;
  insert into private.join_attempts (user_id) values (auth.uid());

  select c.id, c.name, c.created_by into room
  from public.room_codes rc
  join public.conversations c on c.id = rc.conversation_id
  where rc.code = wanted
    and (c.ends_at is null or c.ends_at > now());

  -- Unknown code, ended room, or a host who blocked you: the same answer,
  -- so a code cannot be used to learn which of those it was.
  if not found then
    return query select null::uuid, null::text, 'invalid'::text;
    return;
  end if;
  if exists (select 1 from public.blocks b where b.blocker_id = room.created_by and b.blocked_id = auth.uid()) then
    return query select null::uuid, null::text, 'invalid'::text;
    return;
  end if;

  if exists (select 1 from public.conversation_participants p
             where p.conversation_id = room.id and p.user_id = auth.uid()) then
    return query select room.id, room.name, 'member'::text;
    return;
  end if;

  select p.username into who from public.profiles p where p.id = auth.uid();
  insert into public.room_requests (conversation_id, user_id, username)
  values (room.id, auth.uid(), coalesce(who, 'someone'))
  on conflict on constraint room_requests_pkey do nothing;

  return query select room.id, room.name, 'pending'::text;
end;
$$;

revoke execute on function public.request_to_join(text) from public, anon;
grant execute on function public.request_to_join(text) to authenticated;


-- ############################################################################
-- PART 4 — 1:1 chats stay 1:1
-- ############################################################################

-- Was: `posting` (and `kind`) could be set on a direct chat, and any member
-- of a direct chat may update it -- so one person could make a DM
-- "hosts only" and silence the other. They are group settings.
update public.conversations set posting = 'everyone' where type <> 'group' and posting <> 'everyone';
update public.conversations set kind = null where type <> 'group' and kind is not null;

alter table public.conversations drop constraint if exists conversations_posting_groups_only;
alter table public.conversations add constraint conversations_posting_groups_only
  check (posting = 'everyone' or type = 'group');

alter table public.conversations drop constraint if exists conversations_kind_groups_only;
alter table public.conversations add constraint conversations_kind_groups_only
  check (kind is null or type = 'group');


-- ############################################################################
-- PART 5 — verify
-- ############################################################################

-- EXPECTED OUTPUT, one row per check:
--   archive policies       read listed, remove, upload within quota
--   waiting room broadcast no
--   join attempts counted  yes
--   DM settings locked     yes
select 'archive policies' as check_name,
       (select string_agg(replace(policyname, 'student-resources ', ''), ', ' order by policyname)
        from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname like 'student-resources%') as result
union all
select 'waiting room broadcast',
       case when exists (select 1 from pg_publication_tables
                         where pubname = 'supabase_realtime' and tablename = 'room_requests')
            then 'YES: re-run this file' else 'no' end
union all
select 'join attempts counted',
       case when to_regclass('private.join_attempts') is not null then 'yes' else 'MISSING' end
union all
select 'DM settings locked',
       case when exists (select 1 from pg_constraint where conname = 'conversations_posting_groups_only')
            then 'yes' else 'MISSING' end;

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase18.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 18: deleting an account deletes everything; files can live
-- on Cloudflare R2
-- ============================================================================
--
-- Run after phase 17. Safe to re-run.
--
-- PART 1 — Deleting an account leaves nothing of the person behind.
--   Was: delete_my_account() deleted the auth user, and the cascades took
--   the profile, keys, messages, reactions, study data and memberships. Left
--   behind: conversations where they were the only member (now empty, with
--   nobody able to see or remove them) and auth audit entries carrying
--   their email and IP. Files in Storage were left too, because SQL may not
--   delete Storage objects -- so the apps now ask my_storage_objects() for
--   every file the person uploaded and remove them through the Storage API
--   (and R2) before calling delete_my_account().
--   Reports someone filed or received are kept for moderation, with the
--   person's id already set to null by the existing foreign keys.
--
-- PART 2 — Archive files may live on Cloudflare R2.
--   functions/api/files (a Cloudflare Pages Function) stores files in an R2
--   bucket: 10 GB free, against Supabase's 1 GB. Its keys start with the
--   uploader: o/<owner>/u/<uuid> (private) or o/<owner>/c/<conversation>/<uuid>
--   (shared). A row may point at an R2 key only if the key starts with the
--   caller's own id. The database can't see into R2, so the row keeps the
--   size the app reports (still capped at 50 MB a file and 200 MB a person
--   here); the Function enforces the real quota from R2 itself.
--
-- PART 3 — A one-off clean-up of conversations already left empty.
-- ============================================================================


-- ############################################################################
-- PART 1 — deleting an account
-- ############################################################################

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

  -- Conversations only this person was in would be left empty and
  -- unreachable: delete them (messages, keys and files' rows go with them).
  delete from public.conversations c
  where exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id = me)
    and not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id <> me);

  -- Auth's own record of their sign-ins.
  if to_regclass('auth.audit_log_entries') is not null then
    execute 'delete from auth.audit_log_entries where payload ->> ''actor_id'' = $1' using me::text;
  end if;

  -- The account itself; everything else of theirs goes with it.
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Every file this person uploaded to Supabase Storage, so the app can remove
-- them through the Storage API before the account goes. Only their own.
create or replace function public.my_storage_objects()
returns table (bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id::text, o.name::text
  from storage.objects o
  where auth.uid() is not null and o.owner = auth.uid()
  order by o.bucket_id, o.name
$$;

revoke execute on function public.my_storage_objects() from public, anon;
grant execute on function public.my_storage_objects() to authenticated;


-- ############################################################################
-- PART 2 — archive rows may point at R2
-- ############################################################################

alter table public.resources drop constraint if exists resources_path_matches_scope;
alter table public.resources add constraint resources_path_matches_scope check (
  (conversation_id is null and (
    object_path like 'u/' || owner_id::text || '/%'
    or object_path like 'o/' || owner_id::text || '/u/%'))
  or
  (conversation_id is not null and (
    object_path like 'c/' || conversation_id::text || '/%'
    or object_path like 'o/' || owner_id::text || '/c/' || conversation_id::text || '/%'))
);

create or replace function private.check_resource_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj_size  bigint;
  obj_owner uuid;
  used      bigint;
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.owner_id        := old.owner_id;
    new.conversation_id := old.conversation_id;
    new.object_path     := old.object_path;
    new.file_name       := old.file_name;
    new.mime_type       := old.mime_type;
    new.size_bytes      := old.size_bytes;
    new.created_at      := old.created_at;
    return new;
  end if;

  if new.object_path like 'o/%' then
    -- On R2: the key must be the caller's own (o/<their id>/...); the size
    -- is what the app reports, within the column's 50 MB cap.
    if new.object_path not like 'o/' || auth.uid()::text || '/%' then
      raise exception 'That file was uploaded by someone else.' using errcode = '42501';
    end if;
  else
    select (o.metadata ->> 'size')::bigint, o.owner into obj_size, obj_owner
    from storage.objects o
    where o.bucket_id = 'student-resources' and o.name = new.object_path;

    if not found then
      raise exception 'Upload the file before adding it to the archive.' using errcode = '23503';
    end if;
    if obj_owner is distinct from auth.uid() then
      raise exception 'That file was uploaded by someone else.' using errcode = '42501';
    end if;
    if obj_size is not null then
      new.size_bytes := obj_size;
    end if;
  end if;

  select coalesce(sum(r.size_bytes), 0) into used from public.resources r where r.owner_id = auth.uid();
  if used + new.size_bytes > 200 * 1024 * 1024 then
    raise exception 'Your archive is full (200 MB). Remove something to make room.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_resource_row() from public, anon, authenticated;


-- ############################################################################
-- PART 3 — conversations already left empty
-- ############################################################################

delete from public.conversations c
where not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id);


-- ############################################################################
-- Verify. Expect: deletion function updated, my_storage_objects present,
-- R2 paths allowed, no empty conversations.
-- ############################################################################
select 'delete_my_account removes solo conversations' as check_name,
       (select case when pg_get_functiondef('public.delete_my_account()'::regprocedure) like '%conversation_participants%' then 'yes' else 'MISSING' end) as result
union all
select 'my_storage_objects callable by signed-in users',
       (select case when has_function_privilege('authenticated', 'public.my_storage_objects()', 'EXECUTE')
                     and not has_function_privilege('anon', 'public.my_storage_objects()', 'EXECUTE') then 'yes' else 'WRONG' end)
union all
select 'archive rows may point at R2',
       (select case when pg_get_constraintdef(oid) like '%o/%' then 'yes' else 'MISSING' end
        from pg_constraint where conname = 'resources_path_matches_scope')
union all
select 'empty conversations',
       (select count(*)::text from public.conversations c
        where not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id));

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase19.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 19: launch tuning
-- ============================================================================
--
-- Run after phase 18. Safe to re-run. Changes no behaviour: every policy
-- allows and refuses exactly what it did before.
--
-- PART 1 — Row-level security asks "who is this?" once per query, not once
--   per row. Policies written as `user_id = auth.uid()` call auth.uid() for
--   every row they look at; written as `user_id = (select auth.uid())`,
--   Postgres works it out once and reuses it. Supabase's performance advisor
--   flags every policy written the first way. This rewrites each of them in
--   place, in the public schema, keeping the rest of the expression intact.
--
-- PART 2 — Indexes for foreign keys that had none. Without them, deleting a
--   message (or an account, which deletes all of someone's messages) scans
--   every message to clear replies to it, and the same for blocks, keys,
--   reactions, reports, goals, room codes and focus sessions.
-- ============================================================================


-- ############################################################################
-- PART 1 — auth.uid() once per query
-- ############################################################################

do $$
declare
  p        record;
  new_qual text;
  new_chk  text;
  stmt     text;
begin
  -- The policies' text names tables without a schema (e.g. `conversations c`).
  perform set_config('search_path', 'public', true);

  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') ~ 'auth\.uid\(\)' or coalesce(with_check, '') ~ 'auth\.uid\(\)')
  loop
    -- Already-wrapped calls deparse as "( SELECT auth.uid() AS uid)". Skip a
    -- policy with none left unwrapped; otherwise set the wrapped ones aside,
    -- wrap the rest, and put them back, so nothing is wrapped twice.
    if replace(coalesce(p.qual, '') || ' ' || coalesce(p.with_check, ''), '( SELECT auth.uid() AS uid)', '') !~ 'auth\.uid\(\)' then
      continue;
    end if;
    new_qual := replace(replace(replace(p.qual, '( SELECT auth.uid() AS uid)', '@@uid@@'),
                                'auth.uid()', '(select auth.uid())'),
                        '@@uid@@', '(select auth.uid())');
    new_chk  := replace(replace(replace(p.with_check, '( SELECT auth.uid() AS uid)', '@@uid@@'),
                                'auth.uid()', '(select auth.uid())'),
                        '@@uid@@', '(select auth.uid())');

    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if new_qual is not null then
      stmt := stmt || format(' using (%s)', new_qual);
    end if;
    if new_chk is not null then
      stmt := stmt || format(' with check (%s)', new_chk);
    end if;
    execute stmt;
  end loop;
end;
$$;


-- ############################################################################
-- PART 2 — indexes for foreign keys
-- ############################################################################

create index if not exists idx_blocks_blocked            on public.blocks (blocked_id);
create index if not exists idx_conversation_keys_user    on public.conversation_keys (user_id);
create index if not exists idx_focus_sessions_task       on public.focus_sessions (task_id);
create index if not exists idx_message_reactions_user    on public.message_reactions (user_id);
create index if not exists idx_messages_reply_to         on public.messages (reply_to);
create index if not exists idx_reports_conversation      on public.reports (conversation_id);
create index if not exists idx_reports_message           on public.reports (message_id);
create index if not exists idx_reports_reported_user     on public.reports (reported_user_id);
create index if not exists idx_room_codes_created_by     on public.room_codes (created_by);
create index if not exists idx_student_goals_user        on public.student_goals (user_id);


-- ############################################################################
-- Verify. Expect 0 policies left calling auth.uid() per row, and 0 foreign
-- keys in public without an index.
-- ############################################################################
select 'policies calling auth.uid() per row' as check_name,
       (select count(*)::text from pg_policies
        where schemaname = 'public'
          and (replace(coalesce(qual, '') || coalesce(with_check, ''), '( SELECT auth.uid() AS uid)', '') ~ 'auth\.uid\(\)')) as result
union all
select 'foreign keys without an index',
       (select count(*)::text
        from pg_constraint c
        where c.contype = 'f'
          and c.connamespace = 'public'::regnamespace
          and not exists (
            select 1 from pg_index i
            where i.indrelid = c.conrelid
              and (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] = c.conkey));

-- Done. ✅


-- ############################################################################
-- SOURCE FILE: supabase-phase20.sql
-- ############################################################################

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


-- ############################################################################
-- SOURCE FILE: supabase-phase21.sql
-- ############################################################################

-- ============================================================================
-- PANALO — Phase 21: your settings and running timer follow you
-- ============================================================================
--
-- Run after phase 20. Safe to re-run.
--
-- Until now these lived only in the browser they were set in: the Study
-- Room's preset, sound and volume, motion and intro-sound choices, how your
-- world is lit, which Drift items you opened today, and a focus timer that
-- was running. Start a timer on your phone and your laptop knew nothing.
--
-- PART 1 — student_profiles.device_state holds them, one section each:
--   { "prefs": { "v": {...}, "at": <ms> }, "light": ..., "drift": ...,
--     "timer": ... }. merge_device_state() writes one section, and only if
--   it is newer than what is stored, so an old tab can't overwrite a change
--   made since on another device. It runs as the caller (row-level
--   security applies): you can only ever write your own row.
--
-- PART 2 — A focus block is recorded once. With the timer on two devices,
--   both may try to record the same block when it ends. One focus session
--   per start time per person makes the second attempt a harmless duplicate.
-- ============================================================================

alter table public.student_profiles
  add column if not exists device_state jsonb not null default '{}'::jsonb;

alter table public.student_profiles drop constraint if exists student_profiles_device_state_size;
alter table public.student_profiles add constraint student_profiles_device_state_size
  check (pg_column_size(device_state) <= 16384);

create or replace function public.merge_device_state(p_section text, p_value jsonb, p_at bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.student_profiles
     set device_state = device_state || jsonb_build_object(p_section, jsonb_build_object('v', p_value, 'at', p_at))
   where user_id = auth.uid()
     and p_section in ('prefs', 'light', 'drift', 'timer')
     and coalesce((device_state -> p_section ->> 'at')::bigint, 0) <= p_at
  returning device_state
$$;

revoke execute on function public.merge_device_state(text, jsonb, bigint) from public, anon;
grant execute on function public.merge_device_state(text, jsonb, bigint) to authenticated;

create unique index if not exists uq_focus_sessions_user_start on public.focus_sessions (user_id, started_at);


-- Verify. Expect: the column exists, and one focus session per start time.
select 'device_state column' as check_name,
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'student_profiles' and column_name = 'device_state')
            then 'yes' else 'MISSING' end as result
union all
select 'focus sessions recorded once',
       case when to_regclass('public.uq_focus_sessions_user_start') is not null then 'yes' else 'MISSING' end;

-- Done. ✅
