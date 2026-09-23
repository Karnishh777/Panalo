-- ============================================================================
-- PANALO — Phase 12: lock down the trigger functions phases 10 and 11 added.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- ============================================================================

-- WHY THIS EXISTS
--
-- Phase 8 established the rule: a trigger function is invoked by its trigger
-- and never by a client, so it has no business being reachable at
-- /rest/v1/rpc/. Phases 10 and 11 then added six more trigger functions and
-- did not apply that rule to them, so the linter reported every one as
-- callable by anon.
--
-- Calling them directly does little on its own -- a trigger function invoked
-- outside a trigger has no NEW or OLD row to work with and errors -- but
-- leaving privileges granted that nothing needs is how a small oversight
-- becomes a real finding later, and it makes the linter output noisy enough
-- that a genuine problem could hide in it.
--
-- As in phase 8, this must name all three grantees. PostgreSQL grants EXECUTE
-- on new functions to PUBLIC, and Supabase additionally grants it directly to
-- anon and authenticated, so revoking from only one of them silently does
-- nothing.

do $$
declare
  fn text;
begin
  foreach fn in array array[
    -- Phase 10
    'public.rate_limit_messages()',
    'public.rate_limit_conversations()',
    'public.rate_limit_call_invites()',
    -- Phase 11
    'public.stamp_creator_as_owner()',
    'public.guard_role_change()',
    'public.promote_on_owner_leave()'
  ] loop
    -- to_regprocedure() parses a qualified name and returns NULL if there is
    -- no such function. The obvious-looking alternative -- comparing against
    -- p.oid::regprocedure::text -- does NOT work: regprocedure OMITS the
    -- schema when it is on the search_path, so 'public.rate_limit_messages()'
    -- never matches the 'rate_limit_messages()' it renders as, and the guard
    -- silently skips every revoke it was supposed to protect. That is exactly
    -- what happened on the first run of this file: it reported success and
    -- changed nothing.
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from public, anon, authenticated', fn);
    end if;
  end loop;
end $$;

-- ---- What stays callable, and why --------------------------------------
--
-- These remain granted to `authenticated` deliberately. Each is either an
-- action a signed-in person takes, or a helper that RLS policies evaluate as
-- the querying role -- revoking those would break every policy that uses
-- them and take the app down to silence a warning.
--
--   delete_my_account()            a user deleting their own account
--   find_profile_by_username(text) resolving one name to start a chat
--   my_conversation_role(uuid)     used by policies AND the members UI
--   shares_conversation_with(uuid) used by the profiles read policy
--   is_conversation_member(uuid)   used by most policies in the app
--
-- They will keep appearing under "Signed-In Users Can Execute SECURITY
-- DEFINER Function". That is expected and accepted, not an outstanding
-- issue. Each takes either no argument or one the caller already holds, and
-- none reveals anything about another user.

-- ---- Verify -------------------------------------------------------------
-- Expected: no rows. Anything returned is still reachable by a signed-out
-- caller.
select p.proname as still_callable_by_anon
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in (
    'rate_limit_messages', 'rate_limit_conversations', 'rate_limit_call_invites',
    'stamp_creator_as_owner', 'guard_role_change', 'promote_on_owner_leave'
  )
  and has_function_privilege('anon', p.oid, 'EXECUTE');

-- Done. ✅
