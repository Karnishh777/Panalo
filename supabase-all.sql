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
  sig text;
begin
  foreach fn in array array[
    'is_conversation_member(uuid)',
    'shares_conversation_with(uuid)',
    'my_conversation_role(uuid)'
  ] loop
    sig := 'public.' || fn;

    -- A public copy next to a private one is left over from re-running an
    -- OLD version of the earlier phases, which said `create or replace
    -- function public.x()` and so made a new function once the original had
    -- moved. They now create the helpers in `private` directly and point
    -- every policy there, so a copy found here is unreferenced and safe to
    -- drop. (Before that change this DROP failed -- the re-run had re-bound
    -- the policies to the public copy -- and took supabase-all.sql with it.)
    if to_regprocedure(sig) is not null and to_regprocedure('private.' || fn) is not null then
      execute format('drop function %s', sig);

    elsif to_regprocedure(sig) is not null then
      execute format('alter function %s set schema private', sig);
      -- ACLs survive the move; the schema grant above is what completes it.
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
