-- ============================================================================
-- PANALO — Phase 13: move the RLS helpers out of the exposed API schema.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- ============================================================================

-- WHY THIS EXISTS
--
-- Three functions exist only to be evaluated inside RLS policies:
--
--   is_conversation_member(uuid)   used by most policies in the app
--   shares_conversation_with(uuid) used by the profiles read policy
--   my_conversation_role(uuid)     used by the participants and group policies
--
-- They have to stay executable by `authenticated`, because a policy is
-- evaluated as the querying role -- revoking them breaks every policy that
-- depends on them. So they kept appearing as "Signed-In Users Can Execute
-- SECURITY DEFINER Function", and the obvious fix would have taken the app
-- down to silence a warning.
--
-- The linter offers a third option besides revoking and switching to
-- SECURITY INVOKER: move the function out of the exposed API schema.
-- PostgREST only publishes `public`, so a function in `private` has no
-- /rest/v1/rpc/ endpoint at all -- there is nothing left to call, by anyone,
-- which is a stronger outcome than a revoke.
--
-- Policies do not need rewriting. A policy stores its expression as a parsed
-- tree referencing the function's OID, and ALTER FUNCTION ... SET SCHEMA
-- keeps that OID -- so every policy keeps resolving to the same function in
-- its new home. That is what makes this safe to do to live policies.
--
-- Verified beforehand that no client code calls these: the only two .rpc()
-- calls in the app are find_profile_by_username and delete_my_account, and
-- both are dealt with at the bottom of this file.

create schema if not exists private;

-- The querying role needs to reach into the schema as well as execute the
-- function. Without this, every policy fails closed and the app goes blank.
grant usage on schema private to authenticated;

do $$
declare
  fn text;
  pub regprocedure;
  priv regprocedure;
  pub_uses int;
  priv_uses int;
begin
  foreach fn in array array[
    'is_conversation_member(uuid)',
    'shares_conversation_with(uuid)',
    'my_conversation_role(uuid)'
  ] loop
    pub  := to_regprocedure('public.' || fn);
    priv := to_regprocedure('private.' || fn);

    if pub is not null and priv is null then
      -- The original move. ACLs survive it; the schema grant above completes it.
      execute format('alter function %s set schema private', pub);

    elsif pub is not null and priv is not null then
      -- Two copies: one is live, one is a leftover. Which is which depends on
      -- history, and this file has guessed wrong in BOTH directions:
      --
      --   * It first dropped the public copy -- but a re-run of an OLD version
      --     of the earlier phases had re-bound every policy to it, so the
      --     DROP failed and took supabase-all.sql with it.
      --   * A later fix, on another branch, dropped the private copy instead
      --     -- which fails the moment any policy points at `private`, as
      --     phase 14's do.
      --
      -- So stop guessing and ask the catalog. A policy records the function
      -- it calls in pg_depend; the copy nothing depends on is the leftover.
      select count(*) into pub_uses from pg_depend
        where refobjid = pub and classid = 'pg_policy'::regclass;
      select count(*) into priv_uses from pg_depend
        where refobjid = priv and classid = 'pg_policy'::regclass;

      if pub_uses = 0 then
        execute format('drop function %s', pub);
      elsif priv_uses = 0 then
        execute format('drop function %s', priv);
        execute format('alter function %s set schema private', pub);
      else
        -- Both in use. Dropping either breaks policies, and CASCADE would
        -- delete them. Stop with a message that says what to do instead of
        -- a raw dependency error.
        raise exception
          'Both public.% and private.% are used by policies (% and %). Re-run supabase-setup.sql through supabase-phase11.sql from this repository first: they point every policy at private, after which this file can drop the public copy.',
          fn, fn, pub_uses, priv_uses;
      end if;
    end if;
  end loop;
end $$;


-- ---- What cannot be moved, and why -------------------------------------
--
-- Two functions must stay in `public`, because the browser calls them
-- directly and PostgREST only publishes that schema. Moving either one would
-- remove a feature rather than secure it:
--
--   find_profile_by_username(text)
--     How you start a chat with someone you do not share one with yet. It is
--     SECURITY DEFINER precisely so it can see past the profiles read policy
--     -- as SECURITY INVOKER it would be subject to that policy and return
--     nothing for exactly the strangers it exists to find. Its exposure is
--     deliberately minimal: exact match, case-insensitive, at most one row,
--     no wildcards and nothing to iterate over.
--
--   delete_my_account()
--     Deleting a row from auth.users needs privileges the browser must never
--     have, which is the entire reason it is SECURITY DEFINER. It takes no
--     arguments, so there is no id to tamper with -- it can only ever delete
--     the caller's own account.
--
-- Both will keep appearing in the linter. That is an accepted, understood
-- exception rather than an outstanding issue: the alternative in each case
-- is removing the feature.
--
-- Leaked-password protection is the third: it is a Pro-plan feature and
-- cannot be enabled on the free tier at all.


-- ---- Verify -------------------------------------------------------------
-- Expected: three rows, all in `private`. Anything still in `public` did not
-- move, and anything missing means a policy has lost its helper -- check
-- before assuming the app still works.
select n.nspname as schema, p.proname as function
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where p.proname in ('is_conversation_member', 'shares_conversation_with', 'my_conversation_role')
order by 2;

-- Sanity check that RLS still works. Run while signed in: it should return
-- your own conversations without error. An error here means the policies
-- cannot reach their helper -- re-run the grant above.
-- select count(*) from public.conversation_participants;

-- Done. ✅
