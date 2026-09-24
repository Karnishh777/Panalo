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
