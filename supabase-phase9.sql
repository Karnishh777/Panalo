-- ============================================================================
-- PANALO — Phase 9: let people actually delete the files they sent.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Independent of phase 8; neither depends on the other.
-- ============================================================================

-- WHY THIS EXISTS
--
-- There has never been a DELETE policy on storage.objects. Uploads were
-- write-only: once a photo or file reached the bucket, nothing in the app
-- could remove it. Deleting a message removed only the row pointing at it,
-- and leaving a chat removed only the membership.
--
-- Three consequences, in rising order of seriousness:
--
--   1. Storage only ever grows. On the free tier that is a 1 GB wall the app
--      walks into and cannot back away from; on a paid plan it is a bill
--      that never goes down.
--   2. Orphans accumulate with nothing referencing them, so there is no way
--      to tell from the database which objects are still needed.
--   3. "Delete" did not delete. Someone removing a photo from a chat had
--      every reason to think it was gone. The bytes were still served to
--      anyone holding the URL. That is a gap between what the product says
--      and what it does -- the same class of problem as the encryption
--      claims, and it deserves the same treatment.
--
-- The policy is scoped to the UPLOADER, not to conversation membership.
-- storage.objects.owner is stamped with auth.uid() by the Storage API on
-- upload, so this lets you delete what you sent and nothing else. Deleting a
-- message you wrote cleans up its attachment; leaving a group never touches
-- files other people put there.
--
-- Note for anyone tidying up by hand: storage.protect_delete() blocks
-- `delete from storage.objects` outright, and that guard is deliberate --
-- do not disable it or edit the storage schema to get around it. Removing
-- objects goes through the Storage API (the client's
-- .storage.from(...).remove([...]), or the dashboard's Storage browser),
-- and this policy is what authorises that call.

drop policy if exists "chat-files delete own" on storage.objects;

create policy "chat-files delete own" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'chat-files'
    and owner = auth.uid()
  );

-- Confirm the bucket's policies are what you expect: an INSERT for uploads
-- and this DELETE, and no broad SELECT -- phase 8 removed that, because a
-- public bucket serves objects without consulting RLS and the policy only
-- enabled anonymous listing of the whole bucket.
select policyname, cmd, roles
from pg_policies
where schemaname = 'storage'
  and tablename = 'objects'
  and policyname like 'chat-files%'
order by cmd;

-- Done. ✅
