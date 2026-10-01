-- ============================================================================
-- PANALO — Phase 17: Panalo Students, hardened
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Run AFTER phase 16. Covered by tests/migrations.test.mjs.
--
-- Fixes from a review of phase 16. Each part names the hole it closes.
-- supabase-phase16.sql was corrected in the same way, so re-running it can
-- never bring a hole back; the definitions here and there are identical.
-- ============================================================================

create schema if not exists private;
grant usage on schema private to authenticated;


-- ############################################################################
-- PART 1 — archive files: who may read, upload and remove them
-- ############################################################################

-- Was: anyone in a circle could read c/<circle>/... by path alone. A host
-- "removing" a file deleted only its listing, and the file stayed
-- downloadable by every member through the Storage API.
-- Now: a shared file is readable only while it is LISTED (has a resources
-- row). Its uploader can always read their own file -- even after leaving
-- the circle it was shared into, since it still counts against their quota.
create or replace function private.may_read_resource_object(path text, obj_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when obj_owner = auth.uid() then true
    when split_part(path, '/', 1) = 'u'
      then split_part(path, '/', 2) = auth.uid()::text
    when split_part(path, '/', 1) = 'c'
         and split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_conversation_member(split_part(path, '/', 2)::uuid)
           and exists (select 1 from public.resources r where r.object_path = path)
    else false
  end;
$$;

-- Was: uploads were checked only for their path, while the 200 MB quota and
-- the 1000-file cap lived on resources rows -- so uploading without ever
-- creating a row had no limit at all. Now the bucket itself refuses an
-- upload once your stored bytes or file count reach the ceiling.
create or replace function private.storage_quota_ok()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(coalesce((o.metadata ->> 'size')::bigint, 0)), 0) < 200 * 1024 * 1024
     and count(*) < 1000
  from storage.objects o
  where o.bucket_id = 'student-resources' and o.owner = auth.uid();
$$;

-- A host may take a file down from a circle they run, bytes included.
create or replace function private.may_remove_resource_object(path text, obj_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select obj_owner = auth.uid()
      or (split_part(path, '/', 1) = 'c'
          and split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
          and private.my_conversation_role(split_part(path, '/', 2)::uuid) in ('owner', 'admin'));
$$;

revoke execute on function private.may_read_resource_object(text, uuid) from public, anon;
revoke execute on function private.storage_quota_ok() from public, anon;
revoke execute on function private.may_remove_resource_object(text, uuid) from public, anon;
grant execute on function private.may_read_resource_object(text, uuid) to authenticated;
grant execute on function private.storage_quota_ok() to authenticated;
grant execute on function private.may_remove_resource_object(text, uuid) to authenticated;

-- Phase 16's policies, by their old names, go; these replace them.
drop policy if exists "student-resources read" on storage.objects;
drop policy if exists "student-resources upload" on storage.objects;
drop policy if exists "student-resources delete own" on storage.objects;

drop policy if exists "student-resources read listed" on storage.objects;
create policy "student-resources read listed" on storage.objects
  for select to authenticated
  using (bucket_id = 'student-resources' and private.may_read_resource_object(name, owner));

drop policy if exists "student-resources upload within quota" on storage.objects;
create policy "student-resources upload within quota" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'student-resources'
    and private.may_use_resource_path(name)
    and private.storage_quota_ok()
  );

drop policy if exists "student-resources remove" on storage.objects;
create policy "student-resources remove" on storage.objects
  for delete to authenticated
  using (bucket_id = 'student-resources' and private.may_remove_resource_object(name, owner));

-- The row check reads storage.objects to confirm the file exists and is
-- the caller's. With reads now gated on a row existing, it must not depend
-- on the caller's read access: definer, and it still checks the owner.
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

  select coalesce(sum(r.size_bytes), 0) into used from public.resources r where r.owner_id = auth.uid();
  if used + new.size_bytes > 200 * 1024 * 1024 then
    raise exception 'Your archive is full (200 MB). Remove something to make room.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.check_resource_row() from public, anon, authenticated;


-- ############################################################################
-- PART 2 — the waiting room is not broadcast
-- ############################################################################

-- Was: room_requests was in the realtime publication. Realtime does not
-- apply RLS to DELETE events, and a delete carries the primary key -- so
-- every signed-in client could watch who asked to join which room. Hosts
-- now poll their waiting rooms instead (students/js/signals-data.js).
do $$
begin
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'room_requests'
  ) then
    alter publication supabase_realtime drop table public.room_requests;
  end if;
end $$;


-- ############################################################################
-- PART 3 — guessing join codes
-- ############################################################################

-- Was: the limit counted only successful requests, so wrong codes -- the
-- whole point of guessing -- were free. Now every attempt counts: 30 an
-- hour per person, whatever the answer. Attempts live in `private`, out of
-- the API's reach, and are forgotten after a day.
create table if not exists private.join_attempts (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists idx_join_attempts_user on private.join_attempts (user_id, at desc);
revoke all on private.join_attempts from public, anon, authenticated;

create or replace function public.request_to_join(code text)
returns table (conversation_id uuid, name text, status text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  wanted text := upper(regexp_replace(coalesce(code, ''), '[^A-Za-z0-9]', '', 'g'));
  room   record;
  who    text;
begin
  if auth.uid() is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;

  delete from private.join_attempts a where a.at < now() - interval '1 day';
  if (select count(*) from private.join_attempts a
      where a.user_id = auth.uid() and a.at > now() - interval '1 hour') >= 30 then
    raise exception 'Too many join attempts. Wait a while and try again.' using errcode = '54000';
  end if;
  insert into private.join_attempts (user_id) values (auth.uid());

  select c.id, c.name, c.created_by into room
  from public.room_codes rc
  join public.conversations c on c.id = rc.conversation_id
  where rc.code = wanted
    and (c.ends_at is null or c.ends_at > now());

  -- Unknown code, ended room, or a host who blocked you: the same answer,
  -- so a code cannot be used to learn which of those it was.
  if not found then
    return query select null::uuid, null::text, 'invalid'::text;
    return;
  end if;
  if exists (select 1 from public.blocks b where b.blocker_id = room.created_by and b.blocked_id = auth.uid()) then
    return query select null::uuid, null::text, 'invalid'::text;
    return;
  end if;

  if exists (select 1 from public.conversation_participants p
             where p.conversation_id = room.id and p.user_id = auth.uid()) then
    return query select room.id, room.name, 'member'::text;
    return;
  end if;

  select p.username into who from public.profiles p where p.id = auth.uid();
  insert into public.room_requests (conversation_id, user_id, username)
  values (room.id, auth.uid(), coalesce(who, 'someone'))
  on conflict on constraint room_requests_pkey do nothing;

  return query select room.id, room.name, 'pending'::text;
end;
$$;

revoke execute on function public.request_to_join(text) from public, anon;
grant execute on function public.request_to_join(text) to authenticated;


-- ############################################################################
-- PART 4 — 1:1 chats stay 1:1
-- ############################################################################

-- Was: `posting` (and `kind`) could be set on a direct chat, and any member
-- of a direct chat may update it -- so one person could make a DM
-- "hosts only" and silence the other. They are group settings.
update public.conversations set posting = 'everyone' where type <> 'group' and posting <> 'everyone';
update public.conversations set kind = null where type <> 'group' and kind is not null;

alter table public.conversations drop constraint if exists conversations_posting_groups_only;
alter table public.conversations add constraint conversations_posting_groups_only
  check (posting = 'everyone' or type = 'group');

alter table public.conversations drop constraint if exists conversations_kind_groups_only;
alter table public.conversations add constraint conversations_kind_groups_only
  check (kind is null or type = 'group');


-- ############################################################################
-- PART 5 — verify
-- ############################################################################

-- EXPECTED OUTPUT, one row per check:
--   archive policies       read listed, remove, upload within quota
--   waiting room broadcast no
--   join attempts counted  yes
--   DM settings locked     yes
select 'archive policies' as check_name,
       (select string_agg(replace(policyname, 'student-resources ', ''), ', ' order by policyname)
        from pg_policies where schemaname = 'storage' and tablename = 'objects'
          and policyname like 'student-resources%') as result
union all
select 'waiting room broadcast',
       case when exists (select 1 from pg_publication_tables
                         where pubname = 'supabase_realtime' and tablename = 'room_requests')
            then 'YES: re-run this file' else 'no' end
union all
select 'join attempts counted',
       case when to_regclass('private.join_attempts') is not null then 'yes' else 'MISSING' end
union all
select 'DM settings locked',
       case when exists (select 1 from pg_constraint where conname = 'conversations_posting_groups_only')
            then 'yes' else 'MISSING' end;

-- Done. ✅
