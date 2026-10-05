-- ============================================================================
-- PANALO — Phase 24: the day, as a ritual
-- ============================================================================
--
-- Run after phase 23. Safe to re-run.
--
-- One row per person per day (daily_entries), filled in three moments:
--
--   morning   opened_at, set the first time the app is opened that day (the
--             dawn plays once a day, on whichever device comes first, and
--             "since you were last here" counts from the previous one), and
--             an intention: the one thing that would make today count.
--   evening   closing the day: mood and energy (1 to 5), whether the
--             intention happened, one thing learned, one good thing.
--   always    nothing here is shared or shown to anyone else.
--
-- A closed day counts as a day you showed up, like a focus session does.
-- Missing a day costs nothing: there is no streak to break.
-- ============================================================================

create table if not exists public.daily_entries (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  day            date not null check (day between date '2020-01-01' and current_date + 1),
  opened_at      timestamptz,
  intention      text check (intention is null or char_length(intention) <= 140),
  intention_done text check (intention_done is null or intention_done in ('yes', 'partly', 'no')),
  mood           smallint check (mood is null or mood between 1 and 5),
  energy         smallint check (energy is null or energy between 1 and 5),
  learned        text check (learned is null or char_length(learned) <= 280),
  win            text check (win is null or char_length(win) <= 280),
  closed_at      timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, day)
);

alter table public.daily_entries enable row level security;
drop policy if exists "daily_entries own" on public.daily_entries;
create policy "daily_entries own" on public.daily_entries
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.daily_entries from anon;
grant select, insert, update, delete on public.daily_entries to authenticated;

create or replace function private.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.touch_updated_at() from public, anon, authenticated;

drop trigger if exists trg_touch_daily_entries on public.daily_entries;
create trigger trg_touch_daily_entries before update on public.daily_entries
  for each row execute function private.touch_updated_at();

-- Sixteen years of days, per person (phase 16's cap).
drop trigger if exists trg_cap_daily_entries on public.daily_entries;
create trigger trg_cap_daily_entries before insert on public.daily_entries
  for each row execute function private.cap_rows_per_user('6000');

-- Nothing is stored for a student still waiting for a parent (phase 22).
do $$
begin
  if to_regprocedure('private.require_consent()') is not null then
    execute 'drop trigger if exists trg_require_consent on public.daily_entries';
    execute 'create trigger trg_require_consent before insert on public.daily_entries for each row execute function private.require_consent()';
  end if;
end;
$$;


-- ############################################################################
-- Verify
-- ############################################################################
select 'daily entries' as check_name,
       case when to_regclass('public.daily_entries') is not null then 'yes' else 'MISSING' end as result
union all
select 'private to each person',
       case when exists (select 1 from pg_policies where tablename = 'daily_entries' and policyname = 'daily_entries own') then 'yes' else 'MISSING' end;

-- Done. ✅
