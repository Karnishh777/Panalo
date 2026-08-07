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
