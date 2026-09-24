-- ============================================================================
-- PANALO — Phase 15: disappearing messages
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Covered by tests/migrations.test.mjs.
--
-- A chat can be set so that new messages disappear 24 hours, 7 days or 90
-- days after they are sent -- the same three choices WhatsApp offers. The
-- timer belongs to the CHAT, not to each message, so everyone in it lives by
-- the same rule and can see what that rule is.
--
-- What this does NOT do, and the app says so where the timer is set:
--   - It cannot stop anyone copying, screenshotting or saving a message
--     before it disappears. Nothing can.
--   - Photos and files: the message pointing at them is deleted, but the
--     encrypted blob stays in Storage under a random name. Storage objects
--     can only be removed through the Storage API, not from SQL, so a
--     database job cannot delete them. The blob is ciphertext and nobody who
--     was not already in the chat has its address.
-- ============================================================================


-- ############################################################################
-- PART 1 — the setting and the stamp
-- ############################################################################

-- NULL means off. Only the three offered values are accepted, so a client
-- cannot set "1 second" and make a chat that deletes messages before the
-- other person's phone has fetched them.
alter table public.conversations add column if not exists disappear_after interval;

alter table public.conversations drop constraint if exists conversations_disappear_after_check;
alter table public.conversations add constraint conversations_disappear_after_check
  check (disappear_after is null
         or disappear_after in (interval '1 day', interval '7 days', interval '90 days'));

alter table public.messages add column if not exists expires_at timestamptz;

create index if not exists idx_messages_expires_at
  on public.messages (expires_at)
  where expires_at is not null;

-- The expiry is stamped by the DATABASE from the chat's setting at the moment
-- the message arrives. Were it sent by the client, a sender could simply
-- leave it out and their message would stay forever in a chat everyone else
-- believes is disappearing -- or set it to a second and delete a message
-- before anyone saw it. The client is not asked.
--
-- On UPDATE it is pinned for the same reason: editing a message must not be
-- a way to take it off the timer. The "messages update" policy lets authors
-- change their own rows with no column list, and phase 8 already had to pin
-- username and created_at against exactly that.
--
-- This is its own trigger rather than a line added to phase 8's
-- protect_message_identity(), so re-running phase 8 cannot quietly undo it.
create or replace function public.stamp_message_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  ttl interval;
begin
  if tg_op = 'UPDATE' then
    new.expires_at := old.expires_at;
    return new;
  end if;

  select c.disappear_after into ttl
  from public.conversations c
  where c.id = new.conversation_id;

  new.expires_at := case when ttl is null then null else now() + ttl end;
  return new;
end;
$$;

drop trigger if exists trg_stamp_message_expiry on public.messages;
create trigger trg_stamp_message_expiry
  before insert or update on public.messages
  for each row execute function public.stamp_message_expiry();

revoke execute on function public.stamp_message_expiry() from public, anon, authenticated;


-- ############################################################################
-- PART 2 — gone means gone, even before the clean-up runs
-- ############################################################################

-- Deleting expired rows is a scheduled job (part 3), so for up to fifteen
-- minutes an expired row still exists. It must not still be READABLE: a
-- client that reloads in that window would otherwise show a message its
-- sender was promised had disappeared. Restrictive, so it narrows "messages
-- read" rather than adding another way in.
drop policy if exists "expired messages are gone" on public.messages;
create policy "expired messages are gone" on public.messages
  as restrictive
  for select to authenticated
  using (expires_at is null or expires_at > now());


-- ############################################################################
-- PART 3 — the clean-up
-- ############################################################################

-- In `private`, which the API does not expose, so nobody can call it over
-- PostgREST. It needs no caller: pg_cron runs it.
create schema if not exists private;

create or replace function private.purge_disappeared_messages()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.messages where expires_at <= now();
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function private.purge_disappeared_messages() from public, anon, authenticated;

-- pg_cron is included on every Supabase plan, free included; it only has to
-- be switched on. If this database cannot have it, say so instead of failing:
-- part 2 still hides expired messages from everyone, they just are not
-- deleted until the job exists.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    -- Scheduling under a name that already exists replaces that job, so a
    -- re-run updates the schedule rather than adding a second copy.
    perform cron.schedule(
      'panalo-purge-disappeared',
      '*/15 * * * *',
      'select private.purge_disappeared_messages()'
    );
  else
    raise notice 'pg_cron is not available: expired messages are hidden but not deleted.';
  end if;
end;
$$;


-- ############################################################################
-- PART 4 — verify
-- ############################################################################

-- EXPECTED OUTPUT, one row per check:
--   timer column                        interval
--   allowed timers                      1 day, 7 days, 90 days
--   expiry stamped by the database      yes
--   expired messages hidden             yes
--   clean-up scheduled                  every 15 minutes
--   callable SECURITY DEFINER functions delete_my_account, find_profile_by_username
select 'timer column' as check_name,
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public' and table_name = 'conversations'
                   and column_name = 'disappear_after'), 'MISSING') as result
union all
select 'allowed timers',
       (select case when pg_get_constraintdef(oid) like '%1 day%7 days%90 days%'
                    then '1 day, 7 days, 90 days' else pg_get_constraintdef(oid) end
        from pg_constraint where conname = 'conversations_disappear_after_check')
union all
select 'expiry stamped by the database',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_trigger
        where tgname = 'trg_stamp_message_expiry')
union all
select 'expired messages hidden',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_policies
        where schemaname = 'public' and tablename = 'messages'
          and policyname = 'expired messages are gone' and permissive = 'RESTRICTIVE')
union all
select 'clean-up scheduled',
       case
         when not exists (select 1 from pg_extension where extname = 'pg_cron')
           then 'NO: pg_cron unavailable, expired messages are hidden only'
         else 'every 15 minutes'
       end
union all
select 'callable SECURITY DEFINER functions',
       (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- Done. ✅
