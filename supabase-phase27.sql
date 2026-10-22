-- ============================================================================
-- PANALO — Phase 27: friends on the globe
-- ============================================================================
--
-- Run after phase 26. Safe to re-run.
--
-- Someone can put themselves on their friends' globes: a city they pick by
-- hand from a list (never a device location), shown only to the people they
-- choose from their one-to-one chats, for as long as they choose -- until
-- they turn it off, for 7 days, or for 24 hours. Off by default.
--
-- PART 1 — student_places: one row per person, the city they chose. Its
--   coordinates are that city's published centre to two decimals (about a
--   kilometre), not where they are.
-- PART 2 — student_place_viewers: who may see it. Only people you share a
--   one-to-one chat with can be added.
-- PART 3 — Who can read a place: its owner; and a chosen viewer, while it
--   hasn't expired, while they still share a one-to-one chat, and while
--   neither has blocked the other. Checked by one definer function, because
--   the viewer list and the block rows belong to other people.
-- PART 4 — Expired places are erased (hourly, with pg_cron), not just hidden.
-- ============================================================================


-- ############################################################################
-- PART 1 — the place
-- ############################################################################

create table if not exists public.student_places (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  city       text not null check (char_length(btrim(city)) between 1 and 80),
  region     text not null default '' check (char_length(region) <= 80),
  country    text not null default '' check (char_length(country) <= 80),
  lat        numeric(5, 2) not null check (lat between -90 and 90),
  lon        numeric(5, 2) not null check (lon between -180 and 180),
  -- null: until it's turned off. Otherwise at most a week ahead (checked
  -- by the trigger below: a CHECK can't depend on the time).
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.student_places enable row level security;

create or replace function private.touch_place()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expires_at is not null and new.expires_at > now() + interval '7 days 1 hour' then
    raise exception 'A place can be shared for a week at most, or until you turn it off.' using errcode = '22023';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function private.touch_place() from public, anon, authenticated;

drop trigger if exists trg_touch_place on public.student_places;
create trigger trg_touch_place before insert or update on public.student_places
  for each row execute function private.touch_place();


-- ############################################################################
-- PART 2 — who may see it
-- ############################################################################

create table if not exists public.student_place_viewers (
  owner_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  viewer_id  uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (owner_id, viewer_id),
  constraint place_viewer_not_self check (owner_id <> viewer_id)
);

alter table public.student_place_viewers enable row level security;

create index if not exists idx_place_viewers_viewer on public.student_place_viewers (viewer_id);

-- Do these two people share a one-to-one chat? Groups and rooms don't count:
-- a place goes only to people you talk to directly.
create or replace function private.shares_direct_chat(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.conversations c
    join public.conversation_participants pa on pa.conversation_id = c.id and pa.user_id = a
    join public.conversation_participants pb on pb.conversation_id = c.id and pb.user_id = b
    where c.type = 'direct'
  )
$$;
revoke execute on function private.shares_direct_chat(uuid, uuid) from public, anon, authenticated;
grant execute on function private.shares_direct_chat(uuid, uuid) to authenticated;

drop policy if exists "place viewers own" on public.student_place_viewers;
create policy "place viewers own" on public.student_place_viewers
  for select to authenticated using (owner_id = (select auth.uid()));

drop policy if exists "place viewers add" on public.student_place_viewers;
create policy "place viewers add" on public.student_place_viewers
  for insert to authenticated
  with check (owner_id = (select auth.uid()) and private.shares_direct_chat((select auth.uid()), viewer_id));

drop policy if exists "place viewers remove" on public.student_place_viewers;
create policy "place viewers remove" on public.student_place_viewers
  for delete to authenticated using (owner_id = (select auth.uid()));


-- ############################################################################
-- PART 3 — who can read a place
-- ############################################################################

create or replace function private.can_see_place(p_owner uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null
     and exists (
       select 1 from public.student_place_viewers v
       where v.owner_id = p_owner and v.viewer_id = auth.uid()
     )
     and private.shares_direct_chat(p_owner, auth.uid())
     and not exists (
       select 1 from public.blocks b
       where (b.blocker_id = p_owner and b.blocked_id = auth.uid())
          or (b.blocker_id = auth.uid() and b.blocked_id = p_owner)
     )
$$;
revoke execute on function private.can_see_place(uuid) from public, anon, authenticated;
grant execute on function private.can_see_place(uuid) to authenticated;

drop policy if exists "places read" on public.student_places;
create policy "places read" on public.student_places
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or ((expires_at is null or expires_at > now()) and private.can_see_place(user_id))
  );

drop policy if exists "places write" on public.student_places;
create policy "places write" on public.student_places
  for insert to authenticated with check (user_id = (select auth.uid()));

drop policy if exists "places update" on public.student_places;
create policy "places update" on public.student_places
  for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

drop policy if exists "places delete" on public.student_places;
create policy "places delete" on public.student_places
  for delete to authenticated using (user_id = (select auth.uid()));

-- Nothing for a student still waiting for a parent's consent (phase 22).
-- The viewer list has no user_id column, so it gets its own small check.
create or replace function private.require_consent_owner()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if to_regprocedure('private.may_process(uuid)') is not null and not private.may_process(new.owner_id) then
    raise exception 'A parent or guardian needs to agree before Panalo can be used.' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke execute on function private.require_consent_owner() from public, anon, authenticated;

drop trigger if exists trg_require_consent on public.student_place_viewers;
create trigger trg_require_consent before insert on public.student_place_viewers
  for each row execute function private.require_consent_owner();

do $$
begin
  if to_regprocedure('private.require_consent()') is not null then
    drop trigger if exists trg_require_consent on public.student_places;
    create trigger trg_require_consent before insert on public.student_places
      for each row execute function private.require_consent();
  end if;
end;
$$;


-- ############################################################################
-- PART 4 — expired places are erased
-- ############################################################################

create or replace function private.purge_expired_places()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (
    delete from public.student_places where expires_at is not null and expires_at <= now() returning 1
  )
  select count(*)::int from gone
$$;
revoke execute on function private.purge_expired_places() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('panalo-purge-places', '17 * * * *', 'select private.purge_expired_places()');
  else
    raise notice 'pg_cron is not enabled: expired places are hidden, and erased when you run select private.purge_expired_places().';
  end if;
end;
$$;


-- ############################################################################
-- Grants
-- ############################################################################

grant select, insert, update, delete on public.student_places to authenticated;
grant select, insert, delete on public.student_place_viewers to authenticated;
revoke all on public.student_places from anon;
revoke all on public.student_place_viewers from anon;


-- ############################################################################
-- Verify
-- ############################################################################
select 'places tables' as check_name,
       (select count(*) || ' of 2' from information_schema.tables
        where table_schema = 'public' and table_name in ('student_places', 'student_place_viewers')) as result
union all
select 'places protected',
       (select case when bool_and(relrowsecurity) then 'RLS on' else 'RLS OFF' end from pg_class
        where oid in ('public.student_places'::regclass, 'public.student_place_viewers'::regclass))
union all
select 'expiry purge',
       case when exists (select 1 from pg_extension where extname = 'pg_cron') then 'hourly' else 'manual (no pg_cron)' end;

-- Done. ✅
