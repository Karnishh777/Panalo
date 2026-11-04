-- ============================================================================
-- PANALO — Phase 41: which questions a topic has asked (v0.3)
-- ============================================================================
--
-- Run after phase 40. Safe to re-run.
--
-- From the review: with a few questions per topic, every check re-asked the
-- same ones, so answers were recognised rather than known and mastery was
-- overrated. Each topic now remembers the questions it asked and when
-- (students/js/model/learner.js cleanAsked): a check asks unseen ones first,
-- and a right answer to one seen lately counts for less.
--   asked  [[question id, day number], ...], newest last, at most 60
-- ============================================================================

alter table public.student_topics
  add column if not exists asked jsonb not null default '[]'::jsonb;

alter table public.student_topics drop constraint if exists student_topics_asked;
alter table public.student_topics add constraint student_topics_asked
  check (jsonb_typeof(asked) = 'array' and jsonb_array_length(asked) <= 60 and pg_column_size(asked) <= 2048);


-- ############################################################################
-- Verify
-- ############################################################################
select 'student_topics.asked' as check_name,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_topics' and column_name = 'asked') then 'yes' else 'MISSING' end as result;

-- Done. ✅
