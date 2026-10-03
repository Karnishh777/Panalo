-- ============================================================================
-- PANALO — Phase 21: your settings and running timer follow you
-- ============================================================================
--
-- Run after phase 20. Safe to re-run.
--
-- Until now these lived only in the browser they were set in: the Study
-- Room's preset, sound and volume, motion and intro-sound choices, how your
-- world is lit, which Drift items you opened today, and a focus timer that
-- was running. Start a timer on your phone and your laptop knew nothing.
--
-- PART 1 — student_profiles.device_state holds them, one section each:
--   { "prefs": { "v": {...}, "at": <ms> }, "light": ..., "drift": ...,
--     "timer": ... }. merge_device_state() writes one section, and only if
--   it is newer than what is stored, so an old tab can't overwrite a change
--   made since on another device. It runs as the caller (row-level
--   security applies): you can only ever write your own row.
--
-- PART 2 — A focus block is recorded once. With the timer on two devices,
--   both may try to record the same block when it ends. One focus session
--   per start time per person makes the second attempt a harmless duplicate.
-- ============================================================================

alter table public.student_profiles
  add column if not exists device_state jsonb not null default '{}'::jsonb;

alter table public.student_profiles drop constraint if exists student_profiles_device_state_size;
alter table public.student_profiles add constraint student_profiles_device_state_size
  check (pg_column_size(device_state) <= 16384);

create or replace function public.merge_device_state(p_section text, p_value jsonb, p_at bigint)
returns jsonb
language sql
security invoker
set search_path = ''
as $$
  update public.student_profiles
     set device_state = device_state || jsonb_build_object(p_section, jsonb_build_object('v', p_value, 'at', p_at))
   where user_id = auth.uid()
     and p_section in ('prefs', 'light', 'drift', 'timer')
     and coalesce((device_state -> p_section ->> 'at')::bigint, 0) <= p_at
  returning device_state
$$;

revoke execute on function public.merge_device_state(text, jsonb, bigint) from public, anon;
grant execute on function public.merge_device_state(text, jsonb, bigint) to authenticated;

create unique index if not exists uq_focus_sessions_user_start on public.focus_sessions (user_id, started_at);


-- Verify. Expect: the column exists, and one focus session per start time.
select 'device_state column' as check_name,
       case when exists (select 1 from information_schema.columns
                         where table_schema = 'public' and table_name = 'student_profiles' and column_name = 'device_state')
            then 'yes' else 'MISSING' end as result
union all
select 'focus sessions recorded once',
       case when to_regclass('public.uq_focus_sessions_user_start') is not null then 'yes' else 'MISSING' end;

-- Done. ✅
