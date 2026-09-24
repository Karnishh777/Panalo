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
