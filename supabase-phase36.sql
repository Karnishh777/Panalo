-- ============================================================================
-- PANALO — Phase 36: boarders' study times and weekends; your journey (v0.2)
-- ============================================================================
--
-- Run after phase 35. Safe to re-run.
--
-- 1. Boarders: every study time the school keeps (evening prep, morning
--    prep, night study, weekend prep), each on its days, used in full by
--    the plan; whether weekends are spent in the hostel, at home, or it
--    changes (asked each week in Plan); and the journey home, each way.
--
-- 2. Your journey: everything you've done in Panalo Students -- the study
--    profile, progress, results, sessions, tasks, calendar, goals, the
--    journal and logged activities (and so your world) -- can be
--    downloaded, started again from nothing, or brought back from a
--    download. A download is sealed to its account: journey_export() signs
--    it with a key only the database holds, and journey_import() takes it
--    back only for the same account, unchanged.
-- ============================================================================

-- ############################################################################
-- PART 1 — boarders
-- ############################################################################

alter table public.student_profiles
  add column if not exists prep_slots jsonb not null default '[]'::jsonb,
  add column if not exists weekend_plan text,
  add column if not exists home_travel_minutes smallint;

alter table public.student_profiles drop constraint if exists student_profiles_prep_slots;
alter table public.student_profiles add constraint student_profiles_prep_slots
  check (jsonb_typeof(prep_slots) = 'array' and jsonb_array_length(prep_slots) <= 6 and pg_column_size(prep_slots) <= 2048);

alter table public.student_profiles drop constraint if exists student_profiles_weekend_plan;
alter table public.student_profiles add constraint student_profiles_weekend_plan
  check (weekend_plan is null or weekend_plan in ('stay', 'home', 'ask'));

alter table public.student_profiles drop constraint if exists student_profiles_home_travel;
alter table public.student_profiles add constraint student_profiles_home_travel
  check (home_travel_minutes is null or home_travel_minutes between 0 and 720);


-- ############################################################################
-- PART 2 — your journey: download, start again, bring back
-- ############################################################################

-- The sealing key. Nobody can read it: only the functions below use it.
create table if not exists private.journey_key (
  id     boolean primary key default true check (id),
  secret bytea not null default gen_random_bytes(32)
);
insert into private.journey_key default values on conflict (id) do nothing;
revoke all on private.journey_key from public, anon, authenticated;

-- The seal: a keyed hash of the account and the journey's exact text.
create or replace function private.journey_seal(uid uuid, body text)
returns text
language sql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
  select encode(hmac(convert_to(uid::text || ':' || body, 'UTF8'), (select secret from private.journey_key), 'sha256'), 'hex');
$$;
revoke execute on function private.journey_seal(uuid, text) from public, anon, authenticated;

-- Your journey as text, with its seal. The text is kept as it is in the
-- download (a string inside the file), so it comes back byte for byte.
create or replace function public.journey_export()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_catalog
as $$
declare
  me uuid := auth.uid();
  body text;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  body := jsonb_build_object(
    'version', 1,
    'made_at', now(),
    'profile', (select to_jsonb(p) - 'user_id' from public.student_profiles p where p.user_id = me),
    'tasks', coalesce((select jsonb_agg(to_jsonb(t) - 'user_id' order by t.created_at) from public.student_tasks t where t.user_id = me), '[]'::jsonb),
    'sessions', coalesce((select jsonb_agg(to_jsonb(s) - 'user_id' order by s.started_at) from public.focus_sessions s where s.user_id = me), '[]'::jsonb),
    'events', coalesce((select jsonb_agg(to_jsonb(e) - 'user_id' order by e.starts_at) from public.student_events e where e.user_id = me), '[]'::jsonb),
    'activities', coalesce((select jsonb_agg(to_jsonb(a) - 'user_id' order by a.occurred_on) from public.activity_log a where a.user_id = me), '[]'::jsonb),
    'goals', coalesce((select jsonb_agg(to_jsonb(g) - 'user_id' order by g.created_at) from public.student_goals g where g.user_id = me), '[]'::jsonb),
    'journal', coalesce((select jsonb_agg(to_jsonb(d) - 'user_id' order by d.day) from public.daily_entries d where d.user_id = me), '[]'::jsonb),
    'topics', coalesce((select jsonb_agg(to_jsonb(x) - 'user_id' order by x.subject, x.topic) from public.student_topics x where x.user_id = me), '[]'::jsonb),
    'results', coalesce((select jsonb_agg(to_jsonb(r) - 'user_id' order by r.taken_on) from public.student_results r where r.user_id = me), '[]'::jsonb)
  )::text;
  return jsonb_build_object('account', me, 'journey', body, 'seal', private.journey_seal(me, body));
end;
$$;
revoke execute on function public.journey_export() from public, anon;
grant execute on function public.journey_export() to authenticated;

-- Everything in the journey, gone; the account stays (and its settings
-- for how Panalo looks). The setup runs again on the next visit.
create or replace function private.journey_clear(me uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  delete from public.focus_sessions where user_id = me;
  delete from public.student_tasks where user_id = me;
  delete from public.student_events where user_id = me;
  delete from public.activity_log where user_id = me;
  delete from public.student_goals where user_id = me;
  delete from public.daily_entries where user_id = me;
  delete from public.student_topics where user_id = me;
  delete from public.student_results where user_id = me;
end;
$$;
revoke execute on function private.journey_clear(uuid) from public, anon, authenticated;

create or replace function public.journey_reset()
returns void
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
declare
  me uuid := auth.uid();
  keep jsonb;
begin
  if me is null then
    raise exception 'Sign in first.' using errcode = '28000';
  end if;
  perform private.journey_clear(me);
  -- A new profile row: a new beginning (born_at), a new setup. Only the
  -- device settings (the look, the timer's sync) are carried over.
  select device_state into keep from public.student_profiles where user_id = me;
  delete from public.student_profiles where user_id = me;
  insert into public.student_profiles (user_id, device_state) values (me, coalesce(keep, '{}'::jsonb));
end;
$$;
revoke execute on function public.journey_reset() from public, anon;
grant execute on function public.journey_reset() to authenticated;

-- Bring a journey back: only one sealed for this account, and unchanged.
-- It replaces the journey there now (download that first, if it matters).
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
    weekend_plan = r.weekend_plan, home_travel_minutes = r.home_travel_minutes
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
select 'prep_slots column' as check_name,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'student_profiles'
                            and column_name = 'prep_slots')
            then 'yes' else 'MISSING' end as result
union all
select 'journey functions',
       case when exists (select 1 from pg_proc where proname = 'journey_import')
             and exists (select 1 from pg_proc where proname = 'journey_reset')
            then 'yes' else 'MISSING' end;

-- Done. ✅
