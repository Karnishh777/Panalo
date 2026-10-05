-- ============================================================================
-- PANALO — Phase 23: security logs kept for 180 days
-- ============================================================================
--
-- Run after phase 22. Safe to re-run.
--
-- CERT-In's Directions (28 April 2022) ask every service provider to keep
-- the logs of its systems for a rolling 180 days. Supabase's free plan keeps
-- them for about a day. So a GitHub Action (.github/workflows/
-- keep-alive-and-backup.yml, job "logs") copies them here every hour, from
-- Supabase's own log API, and a nightly job erases anything older than 180
-- days. Nothing in the app can read this table; only the database owner
-- (you, in the SQL Editor) can.
--
-- Kept: API requests (method, status, IP address, path, browser), sign-ins
-- and other auth events, database errors and file-storage events. Never
-- message content: that is encrypted before it leaves the device.
--
-- About 0.3 MB a day at today's traffic, so roughly 60 MB at the 180-day
-- mark: well inside the free plan's 500 MB.
-- ============================================================================

create table if not exists private.access_logs (
  id        text primary key,           -- Supabase's own log id: re-copying is harmless
  source    text not null,              -- edge_logs, auth_logs, postgres_logs, storage_logs
  at        timestamptz not null,
  message   text not null,
  stored_at timestamptz not null default now()
);
create index if not exists access_logs_at on private.access_logs (at);
revoke all on private.access_logs from public, anon, authenticated;
alter table private.access_logs enable row level security;

-- Store a batch from the log API: [{id, timestamp, source, event_message}, ...].
-- The timestamp arrives as text in UTC ("2026-10-05T10:31:24.940000"), with
-- or without a zone, or as microseconds since 1970. Each row names its own
-- source; p_source is the fallback.
create or replace function private.store_logs(p_rows jsonb, p_source text default null)
returns integer
language sql
security definer
set search_path = ''
as $$
  with incoming as (
    insert into private.access_logs (id, source, at, message)
    select r ->> 'id',
           coalesce(r ->> 'source', p_source, 'unknown'),
           case when jsonb_typeof(r -> 'timestamp') = 'number'
                  then to_timestamp((r ->> 'timestamp')::numeric / 1000000)
                when (r ->> 'timestamp') ~ '(Z|[+-][0-9]{2}(:?[0-9]{2})?)$'
                  then (r ->> 'timestamp')::timestamptz
                else (r ->> 'timestamp')::timestamp at time zone 'UTC' end,
           left(coalesce(r ->> 'event_message', ''), 4000)
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) r
    where r ->> 'id' is not null
    on conflict (id) do nothing
    returning 1
  )
  select count(*)::int from incoming
$$;
revoke execute on function private.store_logs(jsonb, text) from public, anon, authenticated;

create or replace function private.purge_access_logs()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from private.access_logs where at < now() - interval '180 days' returning 1
  )
  select count(*)::int from gone
$$;
revoke execute on function private.purge_access_logs() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('panalo-purge-access-logs', '37 3 * * *', 'select private.purge_access_logs()');
  else
    raise notice 'pg_cron is not enabled: run select private.purge_access_logs() now and then.';
  end if;
end;
$$;


-- ############################################################################
-- Verify
-- ############################################################################
select 'security log table' as check_name,
       case when to_regclass('private.access_logs') is not null then 'yes' else 'MISSING' end as result
union all
select 'erased after 180 days',
       case when to_regprocedure('private.purge_access_logs()') is not null then 'yes' else 'MISSING' end;

-- Done. ✅
