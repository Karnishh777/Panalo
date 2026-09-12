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
