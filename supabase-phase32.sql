-- ============================================================================
-- PANALO — Phase 32: your own changes to the plan (v0.2)
-- ============================================================================
--
-- Run after phase 31. Safe to re-run.
--
-- The plan is made by the planner, but it's the student's week: they can
-- take a day off, cap a day, start later, ask for more of one subject,
-- skip a block or pull one into today -- by hand, or by telling Pan.
-- Both end up as the same small set of rules (students/js/model/rules.js),
-- kept here. Private like the rest of the study profile; size-capped.
-- ============================================================================

alter table public.student_profiles
  add column if not exists plan_rules jsonb not null default '{}'::jsonb;

alter table public.student_profiles drop constraint if exists student_profiles_plan_rules;
alter table public.student_profiles add constraint student_profiles_plan_rules
  check (jsonb_typeof(plan_rules) = 'object' and pg_column_size(plan_rules) <= 16384);


-- ############################################################################
-- Verify
-- ############################################################################
select 'plan rules column' as check_name,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'student_profiles'
                            and column_name = 'plan_rules')
            then 'yes' else 'MISSING' end as result;

-- Done. ✅
