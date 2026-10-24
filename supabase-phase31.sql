-- ============================================================================
-- PANALO — Phase 31: boarders' prep time (v0.2)
-- ============================================================================
--
-- Run after phase 30. Safe to re-run.
--
-- Boarders don't study whenever they like after school: they study in the
-- school's evening prep. The setup now asks when it is, and the planner
-- fits school-day blocks inside it (students/js/model/capacity.js).
-- Private like the rest of the study profile.
-- ============================================================================

alter table public.student_profiles
  add column if not exists prep_start time,
  add column if not exists prep_end   time;

alter table public.student_profiles drop constraint if exists student_profiles_prep;
alter table public.student_profiles add constraint student_profiles_prep
  check ((prep_start is null and prep_end is null) or (prep_start is not null and prep_end is not null and prep_end > prep_start));


-- ############################################################################
-- Verify
-- ############################################################################
select 'prep time columns' as check_name,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'student_profiles'
                     and column_name in ('prep_start', 'prep_end')) = 2
            then 'yes' else 'MISSING' end as result;

-- Done. ✅
