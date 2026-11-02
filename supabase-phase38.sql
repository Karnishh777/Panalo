-- ============================================================================
-- PANALO — Phase 38: all of life grows the world (v0.3)
-- ============================================================================
--
-- Run after phase 37. Safe to re-run.
--
-- The world grows from every area of a student's life again, not only
-- study (students/js/model/world-model.js): time with people lights the
-- cities, sport greens the valleys, reading brightens the stars, rest lays
-- moonlight, making things colours the air. Two new areas join the ones
-- the log already keeps: time outdoors ('outdoors') and helping, at home or
-- as a volunteer ('help').
-- ============================================================================

alter table public.activity_log drop constraint if exists activity_log_kind;
alter table public.activity_log add constraint activity_log_kind
  check (kind in ('read', 'create', 'move', 'rest', 'connect', 'outdoors', 'help', 'questions'));


-- ############################################################################
-- Verify
-- ############################################################################
select 'activity_log kinds' as check_name,
       case when pg_get_constraintdef(c.oid) like '%outdoors%' then 'yes' else 'MISSING' end as result
  from pg_constraint c
 where c.conname = 'activity_log_kind';

-- Done. ✅
