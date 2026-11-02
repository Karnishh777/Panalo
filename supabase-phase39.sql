-- ============================================================================
-- PANALO — Phase 39: a more detailed day for the timetable (v0.3)
-- ============================================================================
--
-- Run after phase 38. Safe to re-run.
--
-- The setup asks more, so the plan fits the student's real day
-- (students/js/model/profile.js cleanRoutine, model/capacity.js):
--   - waking and sleeping on days without school, when they differ;
--   - when dinner is and how long it takes (kept free);
--   - the best time of day to study on days without school;
--   - how long they like to focus before a break;
--   - a rough weekly wish for each area of life (time with people, sport,
--     reading, rest, making things, outdoors, helping), kept free in the
--     plan and shown on each day.
-- One small jsonb column, `routine`, holds them; journey_import() restores
-- it with the rest of the profile.
-- ============================================================================

alter table public.student_profiles
  add column if not exists routine jsonb not null default '{}'::jsonb;

alter table public.student_profiles drop constraint if exists student_profiles_routine;
alter table public.student_profiles add constraint student_profiles_routine
  check (jsonb_typeof(routine) = 'object' and pg_column_size(routine) <= 2048);

-- Bringing back a journey also brings back the routine (phase 36's
-- function, with the new column).
create or replace function public.journey_import(journey text, seal text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  me uuid := auth.uid();
  j jsonb;
  prof jsonb;
  counts jsonb;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  if journey is null or seal is null or length(journey) > 20000000 then
    raise exception 'That isn''t a Panalo journey.' using errcode = '22023';
  end if;
  if private.journey_seal(me, journey) <> seal then
    raise exception 'That journey belongs to another account, or it was changed after it was downloaded.' using errcode = '42501';
  end if;
  j := journey::jsonb;
  if (j->>'version')::int is distinct from 1 then
    raise exception 'That journey is from a newer Panalo. Update the app and try again.' using errcode = '22023';
  end if;

  perform private.journey_clear(me);

  prof := coalesce(j->'profile', '{}'::jsonb) - 'user_id';
  if not exists (select 1 from public.student_profiles where user_id = me) then
    insert into public.student_profiles (user_id) values (me);
  end if;
  -- Every column the journey has, over the row as it is (columns added
  -- after the download keep their defaults).
  update public.student_profiles p set
    world_name = r.world_name, interests = r.interests, born_at = r.born_at, board = r.board, stage = r.stage, subjects = r.subjects, aim = r.aim, school_days = r.school_days,
    school_start = r.school_start, school_end = r.school_end, boarding = r.boarding, travel_minutes = r.travel_minutes,
    wake_at = r.wake_at, sleep_at = r.sleep_at, tuition_hours = r.tuition_hours, setup_at = r.setup_at,
    pace = r.pace, prep_start = r.prep_start, prep_end = r.prep_end, plan_rules = r.plan_rules,
    activities = r.activities, custom_syllabi = r.custom_syllabi, prep_slots = r.prep_slots,
    weekend_plan = r.weekend_plan, home_travel_minutes = r.home_travel_minutes,
    routine = r.routine
  from (select * from jsonb_populate_record((select x from public.student_profiles x where x.user_id = me), prof)) r
  where p.user_id = me;

  insert into public.student_tasks select (jsonb_populate_record(null::public.student_tasks, e || jsonb_build_object('user_id', me))).* from jsonb_array_elements(coalesce(j->'tasks', '[]')) e;
  insert into public.focus_sessions select (jsonb_populate_record(null::public.focus_sessions, e || jsonb_build_object('user_id', me))).* from jsonb_array_elements(coalesce(j->'sessions', '[]')) e;
  insert into public.student_events select (jsonb_populate_record(null::public.student_events, e || jsonb_build_object('user_id', me))).* from jsonb_array_elements(coalesce(j->'events', '[]')) e;
  insert into public.activity_log select (jsonb_populate_record(null::public.activity_log, e || jsonb_build_object('user_id', me))).* from jsonb_array_elements(coalesce(j->'activities', '[]')) e;
  insert into public.student_goals select (jsonb_populate_record(null::public.student_goals, e || jsonb_build_object('user_id', me))).* from jsonb_array_elements(coalesce(j->'goals', '[]')) e;
  insert into public.daily_entries select (jsonb_populate_record(null::public.daily_entries, e || jsonb_build_object('user_id', me))).* from jsonb_array_elements(coalesce(j->'journal', '[]')) e;
  insert into public.student_topics select (jsonb_populate_record(null::public.student_topics, e || jsonb_build_object('user_id', me))).* from jsonb_array_elements(coalesce(j->'topics', '[]')) e;
  insert into public.student_results select (jsonb_populate_record(null::public.student_results, e || jsonb_build_object('user_id', me))).* from jsonb_array_elements(coalesce(j->'results', '[]')) e;

  counts := jsonb_build_object(
    'sessions', jsonb_array_length(coalesce(j->'sessions', '[]')),
    'topics', jsonb_array_length(coalesce(j->'topics', '[]')),
    'results', jsonb_array_length(coalesce(j->'results', '[]')),
    'made_at', j->>'made_at'
  );
  return counts;
end;
$$;
revoke execute on function public.journey_import(text, text) from public, anon;
grant execute on function public.journey_import(text, text) to authenticated;


-- ############################################################################
-- Verify
-- ############################################################################
select 'student_profiles.routine' as check_name,
       case when exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'student_profiles' and column_name = 'routine') then 'yes' else 'MISSING' end as result;

-- Done. ✅
