-- ============================================================================
-- PANALO — Phase 11: roles and permissions in group chats.
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- ============================================================================

-- WHY THIS EXISTS
--
-- Groups had no notion of who runs them. Any member could add anyone, rename
-- the group, and change its theme and bio; the only person who could remove
-- someone was whoever happened to create the conversation. In a group of
-- twenty, all twenty could invite strangers in and nobody could stop them —
-- fine among friends, untenable anywhere else.
--
-- Three roles, enforced in the database rather than by hiding buttons:
--
--   owner   created the group, or had it handed to them. Can do everything,
--           including promoting and demoting. Cannot be removed by anyone.
--   admin   can add and remove members, and edit the group's name, bio and
--           theme. Cannot touch owners or change roles.
--   member  can read, write and leave. Nothing else.
--
-- Direct chats are unaffected: two people, no hierarchy, and every rule below
-- either ignores them or treats both sides as equals.


-- ---- The column -------------------------------------------------------
alter table public.conversation_participants
  add column if not exists role text not null default 'member';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.conversation_participants'::regclass
      and conname = 'conversation_participants_role_check'
  ) then
    alter table public.conversation_participants
      add constraint conversation_participants_role_check
      check (role in ('owner', 'admin', 'member'));
  end if;
end $$;

-- Existing groups already have an implied owner: whoever created them. Make
-- it explicit, or every group created before this migration is left with
-- nobody able to administer it.
update public.conversation_participants p
set role = 'owner'
from public.conversations c
where c.id = p.conversation_id
  and c.created_by = p.user_id
  and p.role <> 'owner';


-- ---- Reading your own role -------------------------------------------
-- SECURITY DEFINER so the policies below can call it without recursing
-- through the policies on the very table they protect.
create or replace function public.my_conversation_role(conv uuid)
returns text
language sql
security definer
stable
set search_path = public
as $$
  select role
  from public.conversation_participants
  where conversation_id = conv
    and user_id = auth.uid();
$$;

revoke execute on function public.my_conversation_role(uuid) from public, anon;
grant execute on function public.my_conversation_role(uuid) to authenticated;


-- ---- Creating a group makes you its owner -----------------------------
-- Stamped server-side. A client inserting itself as 'member' — or someone
-- else as 'owner' — would otherwise decide the hierarchy for itself.
create or replace function public.stamp_creator_as_owner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  creator uuid;
  caller_role text;
begin
  select created_by into creator from public.conversations where id = new.conversation_id;

  -- The conversation's creator is always an owner, whatever was sent.
  if new.user_id = creator then
    new.role := 'owner';
    return new;
  end if;

  -- Nobody else is created as an owner, and an admin may only be appointed
  -- by an existing owner. Everyone else joins as a member regardless of what
  -- the client asked for.
  caller_role := public.my_conversation_role(new.conversation_id);
  if new.role = 'owner' or (new.role = 'admin' and caller_role is distinct from 'owner') then
    new.role := 'member';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_stamp_creator_as_owner on public.conversation_participants;
create trigger trg_stamp_creator_as_owner
  before insert on public.conversation_participants
  for each row execute function public.stamp_creator_as_owner();


-- ---- Only owners change roles ----------------------------------------
-- There was no UPDATE policy on this table at all, so roles could not be
-- changed by anyone. Adding one needs care: without the guard below a member
-- could update their own row and make themselves owner.
create or replace function public.guard_role_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  caller_role text := public.my_conversation_role(old.conversation_id);
begin
  -- Identity is not editable here; only the role is.
  new.conversation_id := old.conversation_id;
  new.user_id         := old.user_id;

  if new.role is distinct from old.role then
    if caller_role is distinct from 'owner' then
      raise exception 'Only the group owner can change roles.' using errcode = '42501';
    end if;
    -- Handing ownership over is allowed; demoting yourself while you are the
    -- only owner is not, or the group is left unadministered.
    if old.role = 'owner' and new.role <> 'owner'
       and (select count(*) from public.conversation_participants
            where conversation_id = old.conversation_id and role = 'owner') = 1 then
      raise exception 'Promote someone else to owner first.' using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_guard_role_change on public.conversation_participants;
create trigger trg_guard_role_change
  before update on public.conversation_participants
  for each row execute function public.guard_role_change();

drop policy if exists "participants update" on public.conversation_participants;
create policy "participants update" on public.conversation_participants
  for update to authenticated
  using (public.my_conversation_role(conversation_id) = 'owner')
  with check (public.my_conversation_role(conversation_id) = 'owner');


-- ---- Who may add people ----------------------------------------------
-- Was: the creator, OR any member of a group at all. Now owners and admins
-- only. Direct chats keep the creator rule, because that is how the second
-- participant gets added when the chat is first created.
drop policy if exists "participants insert" on public.conversation_participants;
create policy "participants insert" on public.conversation_participants
  for insert to authenticated
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_id and c.created_by = auth.uid()
    )
    or (
      public.my_conversation_role(conversation_id) in ('owner', 'admin')
      and exists (
        select 1 from public.conversations c
        where c.id = conversation_id and c.type = 'group'
      )
    )
  );


-- ---- Who may remove people -------------------------------------------
-- Anyone may leave. Owners and admins may remove others, but never an owner:
-- that is what stops an admin quietly evicting the person who runs the group.
drop policy if exists "participants delete" on public.conversation_participants;
create policy "participants delete" on public.conversation_participants
  for delete to authenticated
  using (
    user_id = auth.uid()
    or (
      public.my_conversation_role(conversation_id) in ('owner', 'admin')
      and role <> 'owner'
    )
  );

-- If the last owner leaves, the group is left with nobody able to administer
-- it — no one could add, remove, rename or promote, permanently. Hand it to
-- the longest-standing admin, or failing that any remaining member, rather
-- than stranding everyone in it.
create or replace function public.promote_on_owner_leave()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  heir uuid;
begin
  if old.role <> 'owner' then
    return old;
  end if;

  if exists (
    select 1 from public.conversation_participants
    where conversation_id = old.conversation_id and role = 'owner'
  ) then
    return old; -- another owner remains
  end if;

  select user_id into heir
  from public.conversation_participants
  where conversation_id = old.conversation_id
  order by (role = 'admin') desc, ctid
  limit 1;

  if heir is not null then
    update public.conversation_participants
    set role = 'owner'
    where conversation_id = old.conversation_id and user_id = heir;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_promote_on_owner_leave on public.conversation_participants;
create trigger trg_promote_on_owner_leave
  after delete on public.conversation_participants
  for each row execute function public.promote_on_owner_leave();


-- ---- Who may rename or re-theme a group -------------------------------
-- Was: any member. A group's name and picture are its identity, and letting
-- everyone rewrite them is how groups get vandalised. Direct chats keep the
-- member rule, since per-chat theme is a two-person decision there.
drop policy if exists "conversations update" on public.conversations;
create policy "conversations update" on public.conversations
  for update to authenticated
  using (
    (type = 'group' and public.my_conversation_role(id) in ('owner', 'admin'))
    or (type <> 'group' and public.is_conversation_member(id))
  )
  with check (
    (type = 'group' and public.my_conversation_role(id) in ('owner', 'admin'))
    or (type <> 'group' and public.is_conversation_member(id))
  );


-- ---- Verify -----------------------------------------------------------
select 'role column' as check_name,
       coalesce((select data_type from information_schema.columns
                 where table_schema = 'public'
                   and table_name = 'conversation_participants'
                   and column_name = 'role'), 'MISSING') as result
union all
select 'owners backfilled',
       (select count(*)::text from public.conversation_participants where role = 'owner')
union all
select 'role triggers',
       (select count(*)::text from pg_trigger
        where tgname in ('trg_stamp_creator_as_owner', 'trg_guard_role_change', 'trg_promote_on_owner_leave'));

-- Expected: role column present as text, one owner per existing conversation,
-- and 3 triggers.

-- Done. ✅
