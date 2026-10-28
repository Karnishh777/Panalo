-- ============================================================================
-- PANALO — Phase 35: other subjects (v0.2)
-- ============================================================================
--
-- Run after phase 34. Safe to re-run.
--
-- A student can add a subject Panalo doesn't list, with its syllabus code
-- ("Further Mathematics 9231"). Pan works out its syllabus (topics, board,
-- level: functions/api/pan-subject.js), the student checks it, and it is
-- kept here, keyed by the subject's id in `subjects`, so the plan can work
-- topic by topic. Private like the rest of the study profile; size-capped.
-- ============================================================================

alter table public.student_profiles
  add column if not exists custom_syllabi jsonb not null default '{}'::jsonb;

alter table public.student_profiles drop constraint if exists student_profiles_custom_syllabi;
alter table public.student_profiles add constraint student_profiles_custom_syllabi
  check (jsonb_typeof(custom_syllabi) = 'object' and pg_column_size(custom_syllabi) <= 24576);


-- ############################################################################
-- Verify
-- ############################################################################
select 'custom_syllabi column' as check_name,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'student_profiles'
                            and column_name = 'custom_syllabi')
            then 'yes' else 'MISSING' end as result;

-- Done. ✅
