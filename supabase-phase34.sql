-- ============================================================================
-- PANALO — Phase 34: the rest of the week (v0.2)
-- ============================================================================
--
-- Run after phase 33. Safe to re-run.
--
-- Students have more than school: sport, art, music, coaching at fixed
-- times. The setup now asks for them, with their days and times, and the
-- planner keeps those times clear (students/js/model/capacity.js,
-- plan.js). Private like the rest of the study profile; size-capped.
-- ============================================================================

alter table public.student_profiles
  add column if not exists activities jsonb not null default '[]'::jsonb;

alter table public.student_profiles drop constraint if exists student_profiles_activities;
alter table public.student_profiles add constraint student_profiles_activities
  check (jsonb_typeof(activities) = 'array' and jsonb_array_length(activities) <= 12 and pg_column_size(activities) <= 8192);


-- ############################################################################
-- Verify
-- ############################################################################
select 'activities column' as check_name,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'student_profiles'
                            and column_name = 'activities')
            then 'yes' else 'MISSING' end as result;

-- Done. ✅
