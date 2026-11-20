-- ============================================================================
-- PANALO — Phase 42: ICSE and ISC (CISCE) as a board (v0.3)
-- ============================================================================
--
-- Run after phase 41. Safe to re-run.
--
-- Students can now choose ICSE / ISC: Classes 9 and 10 (ICSE) and 11 and 12
-- (ISC), alongside Cambridge and CBSE (students/js/model/subjects.js). The
-- profile's board and stage checks (phase 29) are widened to allow them;
-- nothing else changes.
-- ============================================================================

alter table public.student_profiles drop constraint if exists student_profiles_board;
alter table public.student_profiles add constraint student_profiles_board
  check (board is null or board in ('cambridge', 'cbse', 'icse', 'other'));

alter table public.student_profiles drop constraint if exists student_profiles_stage;
alter table public.student_profiles add constraint student_profiles_stage
  check (stage is null or stage in ('igcse1', 'igcse2', 'as', 'a2', 'cbse9', 'cbse10', 'cbse11', 'cbse12', 'icse9', 'icse10', 'isc11', 'isc12', 'other'));


-- ############################################################################
-- Verify
-- ############################################################################
select 'ICSE / ISC allowed' as check_name,
       case when pg_get_constraintdef((select oid from pg_constraint where conname = 'student_profiles_stage')) like '%isc12%' then 'yes' else 'MISSING' end as result;

-- Done. ✅
