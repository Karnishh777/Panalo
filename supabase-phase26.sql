-- ============================================================================
-- PANALO — Phase 26: exams, and how deep a focus block went
-- ============================================================================
--
-- Run after phase 25. Safe to re-run.
--
-- PART 1 — An "exam" kind for the calendar, so exams get their own colour
--   and a countdown on Now.
-- PART 2 — focus_sessions.quality: after a block, the Study Room asks how
--   it went -- scattered (1), okay (2) or deep (3). Optional; only you see
--   it; the weekly chronicle counts your deep blocks.
-- ============================================================================

alter table public.student_events drop constraint if exists student_events_kind_check;
alter table public.student_events add constraint student_events_kind_check
  check (kind in ('class', 'study', 'deadline', 'event', 'personal', 'exam'));

alter table public.focus_sessions add column if not exists quality smallint;
alter table public.focus_sessions drop constraint if exists focus_sessions_quality_check;
alter table public.focus_sessions add constraint focus_sessions_quality_check
  check (quality is null or quality between 1 and 3);


-- ############################################################################
-- Verify
-- ############################################################################
select 'exam kind' as check_name,
       case when pg_get_constraintdef((select oid from pg_constraint where conname = 'student_events_kind_check')) like '%exam%' then 'yes' else 'MISSING' end as result
union all
select 'focus quality',
       case when exists (select 1 from information_schema.columns where table_name = 'focus_sessions' and column_name = 'quality') then 'yes' else 'MISSING' end;

-- Done. ✅
