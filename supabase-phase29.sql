-- ============================================================================
-- PANALO — Phase 29: the study profile behind the plan (v0.2)
-- ============================================================================
--
-- Run after phase 28. Safe to re-run.
--
-- Panalo Students v0.2 asks a student once, in about 90 seconds, what it
-- needs to plan their week, then plans it for them.
--
-- PART 1 — student_profiles gains the answers: board and stage (Cambridge
--   IGCSE, AS or A2; CBSE 9 to 12), subjects with how each is going,
--   their aim, the school day (days, start, end), boarder or day scholar
--   and travel time, wake and sleep times, hours of tuition a week, and
--   when the setup was finished. Only the student can read or write them
--   (the existing "student_profiles own" policy covers new columns).
-- PART 2 — Drift is gone from the app: its saved state is erased from
--   every account, and the device-state function stops accepting it.
-- ============================================================================


-- ############################################################################
-- PART 1 — the study profile
-- ############################################################################

alter table public.student_profiles
  add column if not exists board          text,
  add column if not exists stage          text,
  add column if not exists subjects       jsonb not null default '[]'::jsonb,
  add column if not exists aim            text,
  add column if not exists school_days    smallint[] not null default '{1,2,3,4,5}',
  add column if not exists school_start   time,
  add column if not exists school_end     time,
  add column if not exists boarding       boolean,
  add column if not exists travel_minutes smallint,
  add column if not exists wake_at        time,
  add column if not exists sleep_at       time,
  add column if not exists tuition_hours  smallint,
  add column if not exists setup_at       timestamptz;

alter table public.student_profiles drop constraint if exists student_profiles_board;
alter table public.student_profiles add constraint student_profiles_board
  check (board is null or board in ('cambridge', 'cbse', 'other'));

alter table public.student_profiles drop constraint if exists student_profiles_stage;
alter table public.student_profiles add constraint student_profiles_stage
  check (stage is null or stage in ('igcse1', 'igcse2', 'as', 'a2', 'cbse9', 'cbse10', 'cbse11', 'cbse12', 'other'));

-- Subjects: [{ "id": "phy", "level": 1..4, "grade": "B" }, ...], at most 16.
alter table public.student_profiles drop constraint if exists student_profiles_subjects;
alter table public.student_profiles add constraint student_profiles_subjects
  check (jsonb_typeof(subjects) = 'array' and jsonb_array_length(subjects) <= 16 and pg_column_size(subjects) <= 4096);

alter table public.student_profiles drop constraint if exists student_profiles_aim;
alter table public.student_profiles add constraint student_profiles_aim
  check (aim is null or aim in ('pass', 'good', 'top'));

alter table public.student_profiles drop constraint if exists student_profiles_school_days;
alter table public.student_profiles add constraint student_profiles_school_days
  check (cardinality(school_days) <= 7 and school_days <@ '{0,1,2,3,4,5,6}'::smallint[]);

alter table public.student_profiles drop constraint if exists student_profiles_hours;
alter table public.student_profiles add constraint student_profiles_hours
  check ((travel_minutes is null or travel_minutes between 0 and 240)
     and (tuition_hours is null or tuition_hours between 0 and 40));


-- ############################################################################
-- PART 2 — Drift, removed
-- ############################################################################

update public.student_profiles
   set device_state = device_state - 'drift'
 where device_state ? 'drift';

create or replace function public.merge_device_state(p_section text, p_value jsonb, p_at bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.student_profiles
     set device_state = device_state || jsonb_build_object(p_section, jsonb_build_object('v', p_value, 'at', p_at))
   where user_id = auth.uid()
     and p_section in ('prefs', 'light', 'timer')
     and coalesce((device_state -> p_section ->> 'at')::bigint, 0) <= p_at
  returning device_state
$$;

revoke execute on function public.merge_device_state(text, jsonb, bigint) from public, anon;
grant execute on function public.merge_device_state(text, jsonb, bigint) to authenticated;


-- ############################################################################
-- Verify
-- ############################################################################
select 'study profile columns' as check_name,
       case when (select count(*) from information_schema.columns
                   where table_schema = 'public' and table_name = 'student_profiles'
                     and column_name in ('board', 'stage', 'subjects', 'aim', 'school_days', 'school_start', 'school_end',
                                         'boarding', 'travel_minutes', 'wake_at', 'sleep_at', 'tuition_hours', 'setup_at')) = 13
            then 'yes' else 'MISSING' end as result
union all
select 'drift state left', (select count(*)::text from public.student_profiles where device_state ? 'drift');

-- Done. ✅
