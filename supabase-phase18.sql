-- ============================================================================
-- PANALO — Phase 18: deleting an account deletes everything; files can live
-- on Cloudflare R2
-- ============================================================================
--
-- Run after phase 17. Safe to re-run.
--
-- PART 1 — Deleting an account leaves nothing of the person behind.
--   Was: delete_my_account() deleted the auth user, and the cascades took
--   the profile, keys, messages, reactions, study data and memberships. Left
--   behind: conversations where they were the only member (now empty, with
--   nobody able to see or remove them) and auth audit entries carrying
--   their email and IP. Files in Storage were left too, because SQL may not
--   delete Storage objects -- so the apps now ask my_storage_objects() for
--   every file the person uploaded and remove them through the Storage API
--   (and R2) before calling delete_my_account().
--   Reports someone filed or received are kept for moderation, with the
--   person's id already set to null by the existing foreign keys.
--
-- PART 2 — Archive files may live on Cloudflare R2.
--   functions/api/files (a Cloudflare Pages Function) stores files in an R2
--   bucket: 10 GB free, against Supabase's 1 GB. Its keys start with the
--   uploader: o/<owner>/u/<uuid> (private) or o/<owner>/c/<conversation>/<uuid>
--   (shared). A row may point at an R2 key only if the key starts with the
--   caller's own id. The database can't see into R2, so the row keeps the
--   size the app reports (still capped at 50 MB a file and 200 MB a person
--   here); the Function enforces the real quota from R2 itself.
--
-- PART 3 — A one-off clean-up of conversations already left empty.
-- ============================================================================


-- ############################################################################
-- PART 1 — deleting an account
-- ############################################################################

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then
    raise exception 'Not signed in.' using errcode = '28000';
  end if;

  -- Conversations only this person was in would be left empty and
  -- unreachable: delete them (messages, keys and files' rows go with them).
  delete from public.conversations c
  where exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id = me)
    and not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id and p.user_id <> me);

  -- Auth's own record of their sign-ins.
  if to_regclass('auth.audit_log_entries') is not null then
    execute 'delete from auth.audit_log_entries where payload ->> ''actor_id'' = $1' using me::text;
  end if;

  -- The account itself; everything else of theirs goes with it.
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- Every file this person uploaded to Supabase Storage, so the app can remove
-- them through the Storage API before the account goes. Only their own.
create or replace function public.my_storage_objects()
returns table (bucket text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select o.bucket_id::text, o.name::text
  from storage.objects o
  where auth.uid() is not null and o.owner = auth.uid()
  order by o.bucket_id, o.name
$$;

revoke execute on function public.my_storage_objects() from public, anon;
grant execute on function public.my_storage_objects() to authenticated;


-- ############################################################################
-- PART 2 — archive rows may point at R2
-- ############################################################################

alter table public.resources drop constraint if exists resources_path_matches_scope;
alter table public.resources add constraint resources_path_matches_scope check (
  (conversation_id is null and (
    object_path like 'u/' || owner_id::text || '/%'
    or object_path like 'o/' || owner_id::text || '/u/%'))
  or
  (conversation_id is not null and (
    object_path like 'c/' || conversation_id::text || '/%'
    or object_path like 'o/' || owner_id::text || '/c/' || conversation_id::text || '/%'))
);

create or replace function private.check_resource_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  obj_size  bigint;
  obj_owner uuid;
  used      bigint;
begin
  if tg_op = 'UPDATE' then
    new.id              := old.id;
    new.owner_id        := old.owner_id;
    new.conversation_id := old.conversation_id;
    new.object_path     := old.object_path;
    new.file_name       := old.file_name;
    new.mime_type       := old.mime_type;
    new.size_bytes      := old.size_bytes;
    new.created_at      := old.created_at;
    return new;
  end if;

  if new.object_path like 'o/%' then
    -- On R2: the key must be the caller's own (o/<their id>/...); the size
    -- is what the app reports, within the column's 50 MB cap.
    if new.object_path not like 'o/' || auth.uid()::text || '/%' then
      raise exception 'That file was uploaded by someone else.' using errcode = '42501';
    end if;
  else
    select (o.metadata ->> 'size')::bigint, o.owner into obj_size, obj_owner
    from storage.objects o
    where o.bucket_id = 'student-resources' and o.name = new.object_path;

    if not found then
      raise exception 'Upload the file before adding it to the archive.' using errcode = '23503';
    end if;
    if obj_owner is distinct from auth.uid() then
      raise exception 'That file was uploaded by someone else.' using errcode = '42501';
    end if;
    if obj_size is not null then
      new.size_bytes := obj_size;
    end if;
  end if;

  select coalesce(sum(r.size_bytes), 0) into used from public.resources r where r.owner_id = auth.uid();
  if used + new.size_bytes > 200 * 1024 * 1024 then
    raise exception 'Your archive is full (200 MB). Remove something to make room.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_resource_row() from public, anon, authenticated;


-- ############################################################################
-- PART 3 — conversations already left empty
-- ############################################################################

delete from public.conversations c
where not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id);


-- ############################################################################
-- Verify. Expect: deletion function updated, my_storage_objects present,
-- R2 paths allowed, no empty conversations.
-- ############################################################################
select 'delete_my_account removes solo conversations' as check_name,
       (select case when pg_get_functiondef('public.delete_my_account()'::regprocedure) like '%conversation_participants%' then 'yes' else 'MISSING' end) as result
union all
select 'my_storage_objects callable by signed-in users',
       (select case when has_function_privilege('authenticated', 'public.my_storage_objects()', 'EXECUTE')
                     and not has_function_privilege('anon', 'public.my_storage_objects()', 'EXECUTE') then 'yes' else 'WRONG' end)
union all
select 'archive rows may point at R2',
       (select case when pg_get_constraintdef(oid) like '%o/%' then 'yes' else 'MISSING' end
        from pg_constraint where conname = 'resources_path_matches_scope')
union all
select 'empty conversations',
       (select count(*)::text from public.conversations c
        where not exists (select 1 from public.conversation_participants p where p.conversation_id = c.id));

-- Done. ✅
