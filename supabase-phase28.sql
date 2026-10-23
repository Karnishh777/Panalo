-- ============================================================================
-- PANALO — Phase 28: Panalo Students is private
-- ============================================================================
--
-- Run after phase 27. Safe to re-run.
--
-- Panalo Students no longer has chat, rooms, join codes or friends on the
-- globe: nothing anyone does in it is shown to anyone else. (Panalo Chat
-- keeps its conversations and messages; nothing of those is touched here.)
--
-- PART 1 — Friends on the globe (phase 27) is gone, with its data: the
--   cities people chose and who could see them are erased, its tables,
--   functions and hourly purge removed.
-- PART 2 — Room join codes stop working: every code and every waiting
--   request is erased. (The tables stay: phase 16's request_to_join() and
--   the tests that replay it still name them.)
-- ============================================================================


-- ############################################################################
-- PART 1 — friends on the globe, removed
-- ############################################################################

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'panalo-purge-places';
  end if;
end;
$$;

drop table if exists public.student_place_viewers;
drop table if exists public.student_places;

drop function if exists private.purge_expired_places();
drop function if exists private.can_see_place(uuid);
drop function if exists private.shares_direct_chat(uuid, uuid);
drop function if exists private.require_consent_owner();
drop function if exists private.touch_place();


-- ############################################################################
-- PART 2 — no room can be joined with a code
-- ############################################################################

delete from public.room_requests;
delete from public.room_codes;


-- ############################################################################
-- Verify
-- ############################################################################
select 'places removed' as check_name,
       case when to_regclass('public.student_places') is null and to_regclass('public.student_place_viewers') is null
            then 'yes' else 'STILL THERE' end as result
union all
select 'join codes left', (select count(*)::text from public.room_codes)
union all
select 'join requests left', (select count(*)::text from public.room_requests);

-- Done. ✅
