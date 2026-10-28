-- ============================================================================
-- PANALO — Phase 37: only studying grows the world (v0.2)
-- ============================================================================
--
-- Run after phase 36. Safe to re-run.
--
-- The world now grows from studying alone (students/js/model/world-model.js):
-- focus, finished tasks, chapters covered and known, past papers and the
-- marks earned on exam-style questions. Those questions are answered on
-- paper, away from the timer, so each one marked is kept here as a log of
-- kind 'questions', with the marks earned and the marks it was worth.
-- ============================================================================

alter table public.activity_log
  add column if not exists marks smallint,
  add column if not exists out_of smallint;

alter table public.activity_log drop constraint if exists activity_log_kind_check;
alter table public.activity_log drop constraint if exists activity_log_kind;
alter table public.activity_log add constraint activity_log_kind
  check (kind in ('read', 'create', 'move', 'rest', 'connect', 'questions'));

-- Marks only on questions, and never more than the question was worth.
alter table public.activity_log drop constraint if exists activity_log_marks;
alter table public.activity_log add constraint activity_log_marks
  check (
    (kind = 'questions' and out_of is not null and marks is not null and out_of between 1 and 200 and marks between 0 and out_of)
    or (kind <> 'questions' and marks is null and out_of is null)
  );


-- ############################################################################
-- Verify
-- ############################################################################
select 'activity_log marks' as check_name,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'activity_log'
                            and column_name = 'marks')
            then 'yes' else 'MISSING' end as result;

-- Done. ✅
