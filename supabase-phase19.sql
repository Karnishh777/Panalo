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
