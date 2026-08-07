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
-- ============================================================================
create or replace function public.is_conversation_member(conv uuid)
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
  using (created_by = auth.uid() or public.is_conversation_member(id));
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
  using (public.is_conversation_member(conversation_id));
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
  using (public.is_conversation_member(conversation_id));
create policy "messages insert" on public.messages
  for insert to authenticated
  with check (user_id = auth.uid() and public.is_conversation_member(conversation_id));
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
