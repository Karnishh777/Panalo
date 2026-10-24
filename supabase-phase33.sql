-- ============================================================================
-- PANALO — Phase 33: a daily limit on asking Pan (v0.2)
-- ============================================================================
--
-- Run after phase 32. Safe to re-run.
--
-- "Tell Pan" (functions/api/pan.js) calls a paid AI model. Each student
-- may ask Pan 30 times a day; the function takes one ask with pan_take()
-- before it calls the model, and refuses when the day's asks are used up.
-- What's kept is only a count per student per day, for 7 days. Nobody can
-- read or change it directly: only pan_take() touches the table.
-- ============================================================================

create table if not exists public.pan_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  day     date not null,
  asks    integer not null default 0,
  primary key (user_id, day)
);

alter table public.pan_usage enable row level security;
revoke all on table public.pan_usage from public, anon, authenticated;

-- Take one ask for the signed-in student. Returns how many are left today
-- after this one; below zero means the day's asks were already used up.
create or replace function public.pan_take()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  today date := (now() at time zone 'utc')::date;
  n integer;
begin
  if auth.uid() is null then
    return -1;
  end if;
  insert into public.pan_usage (user_id, day, asks)
  values (auth.uid(), today, 1)
  on conflict (user_id, day) do update set asks = public.pan_usage.asks + 1
  returning asks into n;
  delete from public.pan_usage where user_id = auth.uid() and day < today - 7;
  return 30 - n;
end;
$$;

revoke execute on function public.pan_take() from public, anon;
grant execute on function public.pan_take() to authenticated;


-- ############################################################################
-- Verify
-- ############################################################################
select 'pan usage table' as check_name,
       case when to_regclass('public.pan_usage') is not null then 'yes' else 'MISSING' end as result
union all
select 'pan_take function',
       case when exists (select 1 from pg_proc where proname = 'pan_take') then 'yes' else 'MISSING' end;

-- Done. ✅
