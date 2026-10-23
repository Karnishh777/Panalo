-- ============================================================================
-- PANALO — Phase 30: progress behind the plan (v0.2)
-- ============================================================================
--
-- Run after phase 29. Safe to re-run.
--
-- The planner (students/js/model/learner.js, plan.js) keeps three things,
-- each private to the student:
--
-- PART 1 — student_topics: per syllabus topic, how well it is known
--   (mastery, an Elo rating with its answer count), how fast it fades
--   (FSRS memory: stability, difficulty, last review), how much of it has
--   been covered and the minutes spent on it. No answers are stored, only
--   the summary the planner needs.
-- PART 2 — student_profiles.pace: per subject, how long this student takes
--   compared with a typical student ({"phy": {"pace": 1.2, "n": 4}}).
-- PART 3 — student_results: test and exam marks the student enters
--   (subject, what it was, score out of a total, which topics it covered).
--   Marks pull mastery towards them.
-- PART 4 — focus_sessions gains the topic a block was on and how much of
--   it was covered (0 to 100%).
-- ============================================================================


-- ############################################################################
-- PART 1 — topics
-- ############################################################################

create table if not exists public.student_topics (
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject     text not null check (subject ~ '^[a-z0-9]{1,12}$'),
  topic       text not null check (topic ~ '^[A-Za-z0-9.*]{1,12}$'),
  theta       real not null default 0 check (theta between -4 and 4),
  n           real not null default 0 check (n between 0 and 100000),
  seen        timestamptz,
  stability   real check (stability is null or stability between 0.001 and 36500),
  difficulty  real check (difficulty is null or difficulty between 1 and 10),
  last_review timestamptz,
  reps        integer not null default 0 check (reps between 0 and 100000),
  lapses      integer not null default 0 check (lapses between 0 and 100000),
  minutes     integer not null default 0 check (minutes between 0 and 100000),
  covered     real not null default 0 check (covered between 0 and 1),
  updated_at  timestamptz not null default now(),
  primary key (user_id, subject, topic)
);

alter table public.student_topics enable row level security;
drop policy if exists "student_topics own" on public.student_topics;
create policy "student_topics own" on public.student_topics
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.student_topics from anon;
grant select, insert, update, delete on public.student_topics to authenticated;

drop trigger if exists trg_touch_student_topics on public.student_topics;
create trigger trg_touch_student_topics before update on public.student_topics
  for each row execute function private.touch_updated_at();

-- Sixteen subjects of about a hundred topics, with room to spare.
drop trigger if exists trg_cap_student_topics on public.student_topics;
create trigger trg_cap_student_topics before insert on public.student_topics
  for each row execute function private.cap_rows_per_user('3000');


-- ############################################################################
-- PART 2 — pace
-- ############################################################################

alter table public.student_profiles
  add column if not exists pace jsonb not null default '{}'::jsonb;

alter table public.student_profiles drop constraint if exists student_profiles_pace;
alter table public.student_profiles add constraint student_profiles_pace
  check (jsonb_typeof(pace) = 'object' and pg_column_size(pace) <= 4096);


-- ############################################################################
-- PART 3 — results
-- ############################################################################

create table if not exists public.student_results (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject    text not null check (subject ~ '^[a-z0-9]{1,12}$'),
  title      text not null check (char_length(btrim(title)) between 1 and 80),
  taken_on   date not null check (taken_on between date '2020-01-01' and current_date + 1),
  score      numeric(6, 2) not null check (score >= 0),
  out_of     numeric(6, 2) not null check (out_of > 0 and out_of <= 1000),
  topics     text[] not null default '{}' check (cardinality(topics) <= 60),
  created_at timestamptz not null default now(),
  constraint student_results_score check (score <= out_of)
);
create index if not exists idx_student_results_user on public.student_results (user_id, taken_on desc);

alter table public.student_results enable row level security;
drop policy if exists "student_results own" on public.student_results;
create policy "student_results own" on public.student_results
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.student_results from anon;
grant select, insert, update, delete on public.student_results to authenticated;

drop trigger if exists trg_cap_student_results on public.student_results;
create trigger trg_cap_student_results before insert on public.student_results
  for each row execute function private.cap_rows_per_user('2000');

-- Nothing is stored for a student still waiting for a parent (phase 22).
do $$
begin
  if to_regprocedure('private.require_consent()') is not null then
    execute 'drop trigger if exists trg_require_consent on public.student_topics';
    execute 'create trigger trg_require_consent before insert on public.student_topics for each row execute function private.require_consent()';
    execute 'drop trigger if exists trg_require_consent on public.student_results';
    execute 'create trigger trg_require_consent before insert on public.student_results for each row execute function private.require_consent()';
  end if;
end;
$$;


-- ############################################################################
-- PART 4 — what a focus block was on
-- ############################################################################

alter table public.focus_sessions
  add column if not exists topic   text,
  add column if not exists covered smallint;

alter table public.focus_sessions drop constraint if exists focus_sessions_topic;
alter table public.focus_sessions add constraint focus_sessions_topic
  check ((topic is null or topic ~ '^[A-Za-z0-9.*]{1,12}$') and (covered is null or covered between 0 and 100));


-- ############################################################################
-- Verify
-- ############################################################################
select 'student topics' as check_name,
       case when to_regclass('public.student_topics') is not null then 'yes' else 'MISSING' end as result
union all
select 'student results',
       case when to_regclass('public.student_results') is not null then 'yes' else 'MISSING' end
union all
select 'pace and block topic',
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public'
                     and ((table_name = 'student_profiles' and column_name = 'pace')
                       or (table_name = 'focus_sessions' and column_name in ('topic', 'covered')))) = 3
            then 'yes' else 'MISSING' end
union all
select 'private to each person',
       case when (select count(*) from pg_policies where policyname in ('student_topics own', 'student_results own')) = 2
            then 'yes' else 'MISSING' end;

-- Done. ✅
