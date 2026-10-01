-- ============================================================================
-- PANALO — Phase 16: Panalo Students
--
-- Run in the Supabase SQL Editor (paste → Run). Idempotent — safe to re-run.
-- Covered by tests/migrations.test.mjs.
--
-- Panalo Students (students/) is a second front end on the SAME project as
-- Panalo Chat: same accounts, same encrypted conversations. Nothing here
-- changes how an existing chat works for someone who never opens Students,
-- with three deliberate exceptions that apply to both apps:
--
--   * Blocking someone hides their messages from you everywhere, and stops
--     them adding you to chats.
--   * A temporary room that has ended disappears for everyone in it.
--   * A room set to "hosts post" only accepts messages from its hosts.
--
-- What is new:
--   PART 1  your study life: profile, tasks, focus sessions, timetable and
--           calendar, activity log, goals. Private to you.
--   PART 2  the archive: files in a PRIVATE bucket, readable only by you or
--           by the circle you shared them with. Not end-to-end encrypted --
--           the server enforces who may read, and the app says so.
--   PART 3  safety: blocking and reporting.
--   PART 4  circles and rooms: what kind of group a chat is, rooms that end,
--           hosts-only posting, join codes with a waiting room.
-- ============================================================================

create schema if not exists private;
grant usage on schema private to authenticated;


-- ############################################################################
-- PART 0 — a cap on rows per person
-- ############################################################################

-- Every table below is written straight from the browser with the public
-- key. Without a ceiling one account could fill the 500 MB database on its
-- own. The caps sit far above what a real student produces in years.
--
-- SECURITY INVOKER on purpose: it counts only rows the caller can see, and
-- every table it guards shows you exactly your own rows.
create or replace function private.cap_rows_per_user()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  cap integer := tg_argv[0]::integer;
  col text := coalesce(tg_argv[1], 'user_id');
  n integer;
begin
  execute format('select count(*) from %I.%I where %I = $1', tg_table_schema, tg_table_name, col)
    into n using auth.uid();
  if n >= cap then
    raise exception 'You have reached the limit of % here. Remove something old first.', cap
      using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.cap_rows_per_user() from public, anon, authenticated;


-- ############################################################################
-- PART 1 — your study life (private to you)
-- ############################################################################

-- Created at the end of onboarding. born_at is when "your universe" began:
-- the world's age is measured from it.
create table if not exists public.student_profiles (
  user_id    uuid primary key default auth.uid() references public.profiles (id) on delete cascade,
  world_name text check (world_name is null or char_length(btrim(world_name)) between 1 and 40),
  interests  text[] not null default '{}' check (cardinality(interests) <= 12),
  born_at    timestamptz not null default now()
);

create table if not exists public.student_tasks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title      text not null check (char_length(btrim(title)) between 1 and 200),
  subject    text check (subject is null or char_length(subject) <= 40),
  due_at     timestamptz,
  done_at    timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_student_tasks_user on public.student_tasks (user_id, done_at);

-- One row per focus block that actually happened. focused_minutes is what
-- counts; a session abandoned after 7 minutes records 7.
create table if not exists public.focus_sessions (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  subject         text check (subject is null or char_length(subject) <= 40),
  task_id         uuid references public.student_tasks (id) on delete set null,
  started_at      timestamptz not null,
  ended_at        timestamptz not null,
  planned_minutes integer not null check (planned_minutes between 1 and 240),
  focused_minutes integer not null check (focused_minutes between 0 and 240),
  completed       boolean not null default false,
  created_at      timestamptz not null default now(),
  constraint focus_sessions_order check (ended_at >= started_at),
  -- You cannot have focused for longer than the session lasted.
  constraint focus_sessions_plausible
    check (focused_minutes <= ceil(extract(epoch from (ended_at - started_at)) / 60.0) + 1)
);
create index if not exists idx_focus_sessions_user on public.focus_sessions (user_id, started_at desc);

-- Timetable and calendar in one table: a weekly-repeating class is a
-- timetable slot; everything else is a dated entry. Times are instants; the
-- browser renders them in its own time zone.
create table if not exists public.student_events (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title         text not null check (char_length(btrim(title)) between 1 and 120),
  kind          text not null check (kind in ('class', 'study', 'deadline', 'event', 'personal')),
  starts_at     timestamptz not null,
  ends_at       timestamptz,
  repeat_weekly boolean not null default false,
  location      text check (location is null or char_length(location) <= 80),
  created_at    timestamptz not null default now(),
  constraint student_events_order check (ends_at is null or ends_at >= starts_at)
);
create index if not exists idx_student_events_user on public.student_events (user_id, starts_at);

-- Things you did that are not a focus session: reading, making something,
-- moving, resting, time with people. They shape different parts of the
-- world (see students/js/world-model.js).
create table if not exists public.activity_log (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  kind        text not null check (kind in ('read', 'create', 'move', 'rest', 'connect')),
  minutes     integer not null check (minutes between 1 and 720),
  note        text check (note is null or char_length(note) <= 140),
  occurred_on date not null default current_date,
  created_at  timestamptz not null default now()
);
create index if not exists idx_activity_log_user on public.activity_log (user_id, occurred_on desc);

-- A goal is either a weekly focus target (weekly_minutes set, optionally for
-- one subject) or a one-off milestone you mark done.
create table if not exists public.student_goals (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title          text not null check (char_length(btrim(title)) between 1 and 80),
  weekly_minutes integer check (weekly_minutes is null or weekly_minutes between 15 and 6000),
  subject        text check (subject is null or char_length(subject) <= 40),
  done_at        timestamptz,
  created_at     timestamptz not null default now()
);

alter table public.student_profiles enable row level security;
alter table public.student_tasks    enable row level security;
alter table public.focus_sessions   enable row level security;
alter table public.student_events   enable row level security;
alter table public.activity_log     enable row level security;
alter table public.student_goals    enable row level security;

drop policy if exists "student_profiles own" on public.student_profiles;
create policy "student_profiles own" on public.student_profiles
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "student_tasks own" on public.student_tasks;
create policy "student_tasks own" on public.student_tasks
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "student_events own" on public.student_events;
create policy "student_events own" on public.student_events
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "activity_log own" on public.activity_log;
create policy "activity_log own" on public.activity_log
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "student_goals own" on public.student_goals;
create policy "student_goals own" on public.student_goals
  for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A session may point at a task, but only one of your own: a foreign key is
-- checked without RLS, so without this you could attach a session to
-- anyone's task id.
drop policy if exists "focus_sessions own" on public.focus_sessions;
create policy "focus_sessions own" on public.focus_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (task_id is null or exists (
      select 1 from public.student_tasks t where t.id = task_id and t.user_id = auth.uid()
    ))
  );

drop trigger if exists trg_cap_student_tasks on public.student_tasks;
create trigger trg_cap_student_tasks before insert on public.student_tasks
  for each row execute function private.cap_rows_per_user('5000');
drop trigger if exists trg_cap_focus_sessions on public.focus_sessions;
create trigger trg_cap_focus_sessions before insert on public.focus_sessions
  for each row execute function private.cap_rows_per_user('20000');
drop trigger if exists trg_cap_student_events on public.student_events;
create trigger trg_cap_student_events before insert on public.student_events
  for each row execute function private.cap_rows_per_user('3000');
drop trigger if exists trg_cap_activity_log on public.activity_log;
create trigger trg_cap_activity_log before insert on public.activity_log
  for each row execute function private.cap_rows_per_user('20000');
drop trigger if exists trg_cap_student_goals on public.student_goals;
create trigger trg_cap_student_goals before insert on public.student_goals
  for each row execute function private.cap_rows_per_user('24');


-- ############################################################################
-- PART 2 — the archive
-- ############################################################################

-- PRIVATE, unlike chat-files: nothing here is served without a signed URL,
-- and a signed URL is only issued to someone the policies below allow.
insert into storage.buckets (id, name, public, file_size_limit)
values ('student-resources', 'student-resources', false, 52428800)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit;

-- Where a file lives says who may read it:
--   u/<your user id>/<random>          only you
--   c/<conversation id>/<random>       everyone in that circle
create table if not exists public.resources (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  conversation_id uuid references public.conversations (id) on delete cascade,
  shelf           text check (shelf is null or char_length(btrim(shelf)) between 1 and 40),
  title           text not null check (char_length(btrim(title)) between 1 and 120),
  object_path     text not null unique,
  file_name       text not null check (char_length(file_name) between 1 and 200),
  mime_type       text check (mime_type is null or char_length(mime_type) <= 120),
  size_bytes      bigint not null check (size_bytes between 0 and 52428800),
  note            text check (note is null or char_length(note) <= 280),
  created_at      timestamptz not null default now(),
  constraint resources_path_matches_scope check (
    (conversation_id is null and object_path like 'u/' || owner_id::text || '/%')
    or (conversation_id is not null and object_path like 'c/' || conversation_id::text || '/%')
  )
);
create index if not exists idx_resources_owner on public.resources (owner_id, created_at desc);
create index if not exists idx_resources_conversation on public.resources (conversation_id, created_at desc);

alter table public.resources enable row level security;

drop policy if exists "resources read" on public.resources;
create policy "resources read" on public.resources
  for select to authenticated
  using (
    owner_id = auth.uid()
    or (conversation_id is not null and private.is_conversation_member(conversation_id))
  );

drop policy if exists "resources insert" on public.resources;
create policy "resources insert" on public.resources
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (conversation_id is null or private.is_conversation_member(conversation_id))
  );

drop policy if exists "resources update" on public.resources;
create policy "resources update" on public.resources
  for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- The uploader, or a host of the circle it was shared into (so a host can
-- take down something that should not be there).
drop policy if exists "resources delete" on public.resources;
create policy "resources delete" on public.resources
  for delete to authenticated
  using (
    owner_id = auth.uid()
    or (conversation_id is not null
        and private.my_conversation_role(conversation_id) in ('owner', 'admin'))
  );

-- The row must describe a file that really is in the bucket, uploaded by
-- the same person; its size is taken from Storage, not from the client; and
-- each person's archive is capped. On UPDATE only the label fields move.
-- Definer so it can see the object regardless of the caller's read access
-- (phase 17 gates reads on a row existing); it still checks the owner.
-- Kept IDENTICAL to supabase-phase17.sql.
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

drop trigger if exists trg_check_resource_row on public.resources;
create trigger trg_check_resource_row
  before insert or update on public.resources
  for each row execute function private.check_resource_row();

drop trigger if exists trg_cap_resources on public.resources;
create trigger trg_cap_resources before insert on public.resources
  for each row execute function private.cap_rows_per_user('1000', 'owner_id');

-- Storage. The second path segment is cast to uuid only after it has been
-- shown to look like one: CASE is the one construct whose evaluation order
-- Postgres guarantees, so a malformed name is refused instead of erroring.
create or replace function private.may_use_resource_path(path text)
returns boolean
language sql
stable
set search_path = ''
as $$
  select case
    when split_part(path, '/', 1) = 'u'
      then split_part(path, '/', 2) = auth.uid()::text
    when split_part(path, '/', 1) = 'c'
         and split_part(path, '/', 2) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      then private.is_conversation_member(split_part(path, '/', 2)::uuid)
    else false
  end;
$$;

revoke execute on function private.may_use_resource_path(text) from public, anon;
grant execute on function private.may_use_resource_path(text) to authenticated;

-- The bucket's read, upload and remove policies are in
-- supabase-phase17.sql. They used to be here, and were too wide: reads
-- checked only the path (a host-removed file stayed downloadable) and
-- uploads had no quota. Until phase 17 runs, the bucket refuses everyone.
drop policy if exists "student-resources read" on storage.objects;
drop policy if exists "student-resources upload" on storage.objects;
drop policy if exists "student-resources delete own" on storage.objects;


-- ############################################################################
-- PART 3 — safety: blocking and reporting
-- ############################################################################

create table if not exists public.blocks (
  blocker_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint blocks_not_self check (blocker_id <> blocked_id)
);

alter table public.blocks enable row level security;

drop policy if exists "blocks own" on public.blocks;
create policy "blocks own" on public.blocks
  for all to authenticated using (blocker_id = auth.uid()) with check (blocker_id = auth.uid());

-- You never see messages from someone you blocked, in either app.
-- Restrictive, so it narrows "messages read" rather than adding a way in.
drop policy if exists "blocked senders are hidden" on public.messages;
create policy "blocked senders are hidden" on public.messages
  as restrictive
  for select to authenticated
  using (not exists (
    select 1 from public.blocks b
    where b.blocker_id = auth.uid() and b.blocked_id = messages.user_id
  ));

-- Someone you blocked cannot put you into a chat: not a new 1:1, not a
-- group, not a room. Definer because the block row belongs to the person
-- being added, which the person adding them cannot (and must not) read.
create or replace function private.refuse_blocked_adds()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and new.user_id <> auth.uid() and exists (
    select 1 from public.blocks b
    where b.blocker_id = new.user_id and b.blocked_id = auth.uid()
  ) then
    raise exception 'This person can''t be added.' using errcode = '42501';
  end if;
  return new;
end;
$$;

revoke execute on function private.refuse_blocked_adds() from public, anon, authenticated;

drop trigger if exists trg_refuse_blocked_adds on public.conversation_participants;
create trigger trg_refuse_blocked_adds
  before insert on public.conversation_participants
  for each row execute function private.refuse_blocked_adds();

-- Reports go to whoever operates this deployment (read them in the
-- dashboard). Message text is ciphertext on the server, so the reporter
-- may attach the decrypted text as evidence -- the app asks first.
-- The reporter's id is kept null-able so deleting your account does not
-- delete the reports you filed.
create table if not exists public.reports (
  id               uuid primary key default gen_random_uuid(),
  reporter_id      uuid default auth.uid() references public.profiles (id) on delete set null,
  reported_user_id uuid references public.profiles (id) on delete set null,
  conversation_id  uuid references public.conversations (id) on delete set null,
  message_id       uuid references public.messages (id) on delete set null,
  reason           text not null check (reason in ('harassment', 'spam', 'inappropriate', 'impersonation', 'safety', 'other')),
  details          text check (details is null or char_length(details) <= 1000),
  evidence         text check (evidence is null or char_length(evidence) <= 4000),
  status           text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at       timestamptz not null default now()
);
create index if not exists idx_reports_reporter on public.reports (reporter_id, created_at desc);

alter table public.reports enable row level security;

drop policy if exists "reports insert" on public.reports;
create policy "reports insert" on public.reports
  for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and status = 'open'
    and (conversation_id is null or private.is_conversation_member(conversation_id))
  );

drop policy if exists "reports read own" on public.reports;
create policy "reports read own" on public.reports
  for select to authenticated using (reporter_id = auth.uid());

create or replace function private.rate_limit_reports()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.reports r
      where r.reporter_id = auth.uid() and r.created_at > now() - interval '1 day') >= 20 then
    raise exception 'You have sent a lot of reports today. Try again tomorrow.' using errcode = '54000';
  end if;
  return new;
end;
$$;

revoke execute on function private.rate_limit_reports() from public, anon, authenticated;

drop trigger if exists trg_rate_limit_reports on public.reports;
create trigger trg_rate_limit_reports before insert on public.reports
  for each row execute function private.rate_limit_reports();


-- ############################################################################
-- PART 4 — circles and rooms
-- ############################################################################

-- What a group is FOR. NULL is an ordinary group made in Panalo Chat.
alter table public.conversations add column if not exists kind text;
alter table public.conversations drop constraint if exists conversations_kind_check;
alter table public.conversations add constraint conversations_kind_check
  check (kind is null or kind in ('crew', 'study', 'class', 'project', 'event'));

-- A room that ends. After this moment it is hidden from everyone; a day
-- later it is deleted with everything in it.
alter table public.conversations add column if not exists ends_at timestamptz;
alter table public.conversations drop constraint if exists conversations_ends_at_check;
alter table public.conversations add constraint conversations_ends_at_check
  check (ends_at is null or type = 'group');

-- Who may post: everyone, or only owners and admins (announcements).
alter table public.conversations add column if not exists posting text not null default 'everyone';
alter table public.conversations drop constraint if exists conversations_posting_check;
alter table public.conversations add constraint conversations_posting_check
  check (posting in ('everyone', 'hosts'));

-- An end date must be in the future when set, and no more than 60 days out:
-- a "temporary" room that runs for years is just a group.
create or replace function private.check_room_end()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Rules for people; a migration or the dashboard (no signed-in user) may
  -- set anything, e.g. to end a room early by hand.
  if auth.uid() is null then
    return new;
  end if;
  if new.ends_at is not null
     and (tg_op = 'INSERT' or new.ends_at is distinct from old.ends_at) then
    if new.ends_at <= now() then
      raise exception 'A room has to end in the future.' using errcode = '22023';
    end if;
    if new.ends_at > now() + interval '60 days' then
      raise exception 'A temporary room can last at most 60 days.' using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

revoke execute on function private.check_room_end() from public, anon, authenticated;

drop trigger if exists trg_check_room_end on public.conversations;
create trigger trg_check_room_end
  before insert or update on public.conversations
  for each row execute function private.check_room_end();

-- Helpers for the policies below. Definer, because they read
-- conversations, whose own policies would otherwise hide exactly the rows
-- (ended rooms) they need to see. In `private`: no API endpoint.
create or replace function private.conversation_ended(conv uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((select c.ends_at <= now() from public.conversations c where c.id = conv), false);
$$;

create or replace function private.may_post(conv uuid)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select coalesce((
    select c.posting = 'everyone'
           or exists (select 1 from public.conversation_participants p
                      where p.conversation_id = conv and p.user_id = auth.uid()
                        and p.role in ('owner', 'admin'))
    from public.conversations c where c.id = conv
  ), false);
$$;

revoke execute on function private.conversation_ended(uuid) from public, anon;
revoke execute on function private.may_post(uuid) from public, anon;
grant execute on function private.conversation_ended(uuid) to authenticated;
grant execute on function private.may_post(uuid) to authenticated;

drop policy if exists "ended rooms are gone" on public.conversations;
create policy "ended rooms are gone" on public.conversations
  as restrictive
  for select to authenticated
  using (ends_at is null or ends_at > now());

drop policy if exists "ended rooms are silent" on public.messages;
create policy "ended rooms are silent" on public.messages
  as restrictive
  for select to authenticated
  using (not private.conversation_ended(conversation_id));

-- Posting rules. A key request (src/keystatus.js) is always allowed: it is
-- how someone who cannot read a room asks to be let back in.
drop policy if exists "rooms decide who posts" on public.messages;
create policy "rooms decide who posts" on public.messages
  as restrictive
  for insert to authenticated
  with check (
    not private.conversation_ended(conversation_id)
    and (private.may_post(conversation_id) or (iv is null and content = '[[keyrequest]]'))
  );

-- ---- Join codes and the waiting room ------------------------------------
-- A host makes a code. Anyone with the code can ASK to join; a host lets
-- them in. Letting someone in is what shares the room's key with them, so
-- it stays a person's decision -- the same trust src/keyshare.js asks for.
create table if not exists public.room_codes (
  conversation_id uuid primary key references public.conversations (id) on delete cascade,
  code            text not null unique check (code ~ '^[A-HJ-NP-Z2-9]{8}$'),
  created_by      uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now()
);

create table if not exists public.room_requests (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id         uuid not null references public.profiles (id) on delete cascade,
  username        text not null,
  created_at      timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists idx_room_requests_user on public.room_requests (user_id, created_at desc);

alter table public.room_codes    enable row level security;
alter table public.room_requests enable row level security;

drop policy if exists "room_codes hosts" on public.room_codes;
create policy "room_codes hosts" on public.room_codes
  for all to authenticated
  using (private.my_conversation_role(conversation_id) in ('owner', 'admin'))
  with check (
    private.my_conversation_role(conversation_id) in ('owner', 'admin')
    and exists (select 1 from public.conversations c where c.id = conversation_id and c.type = 'group')
  );

-- No insert policy: requests are only made through request_to_join().
drop policy if exists "room_requests read" on public.room_requests;
create policy "room_requests read" on public.room_requests
  for select to authenticated
  using (user_id = auth.uid() or private.my_conversation_role(conversation_id) in ('owner', 'admin'));

drop policy if exists "room_requests delete" on public.room_requests;
create policy "room_requests delete" on public.room_requests
  for delete to authenticated
  using (user_id = auth.uid() or private.my_conversation_role(conversation_id) in ('owner', 'admin'));

-- Ask to join a room by its code.
--
-- SECURITY DEFINER for the same reason as find_profile_by_username: a code
-- has to find a room the caller cannot see yet. It reveals nothing else:
-- one exact code in, at most that room's name out, and only to someone who
-- was given the code. Statuses: 'pending', 'member', 'invalid'.
-- Every attempt counts toward 30 an hour, so codes can't be guessed.
-- Kept IDENTICAL to supabase-phase17.sql.
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

-- Once someone is in, their request is done.
create or replace function private.clear_room_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.room_requests r
  where r.conversation_id = new.conversation_id and r.user_id = new.user_id;
  return new;
end;
$$;

revoke execute on function private.clear_room_request() from public, anon, authenticated;

drop trigger if exists trg_clear_room_request on public.conversation_participants;
create trigger trg_clear_room_request
  after insert on public.conversation_participants
  for each row execute function private.clear_room_request();

-- room_requests is deliberately NOT in the realtime publication: Realtime
-- does not apply RLS to DELETE events, so it would broadcast who asked to
-- join which room to everyone. Hosts poll instead. (Phase 17 removes it
-- from databases that ran an earlier version of this file.)

-- Ended rooms are deleted a day after they end (and everything in them, by
-- cascade). Archive FILES shared into them stay in Storage, for the same
-- reason as phase 15: a database job cannot remove Storage objects.
create or replace function private.purge_ended_rooms()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  removed integer;
begin
  delete from public.conversations where ends_at <= now() - interval '1 day';
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke execute on function private.purge_ended_rooms() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
    perform cron.schedule('panalo-purge-ended-rooms', '17 * * * *', 'select private.purge_ended_rooms()');
  else
    raise notice 'pg_cron is not available: ended rooms are hidden but not deleted.';
  end if;
end;
$$;


-- ############################################################################
-- PART 5 — verify
-- ############################################################################

-- EXPECTED OUTPUT, one row per check:
--   students tables                     10 of 10
--   archive bucket                      private
--   blocked senders hidden              yes
--   ended rooms hidden                  yes
--   callable SECURITY DEFINER functions delete_my_account, find_profile_by_username, request_to_join
select 'students tables' as check_name,
       (select count(*) || ' of 10' from information_schema.tables
        where table_schema = 'public'
          and table_name in ('student_profiles', 'student_tasks', 'focus_sessions', 'student_events',
                             'activity_log', 'student_goals', 'resources', 'blocks', 'reports',
                             'room_codes')) as result
union all
select 'archive bucket',
       (select case when public then 'PUBLIC: re-run this file' else 'private' end
        from storage.buckets where id = 'student-resources')
union all
select 'blocked senders hidden',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_policies
        where tablename = 'messages' and policyname = 'blocked senders are hidden')
union all
select 'ended rooms hidden',
       (select case when count(*) > 0 then 'yes' else 'MISSING' end from pg_policies
        where tablename = 'conversations' and policyname = 'ended rooms are gone')
union all
select 'callable SECURITY DEFINER functions',
       (select string_agg(p.proname, ', ' order by p.proname) from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prosecdef
          and has_function_privilege('authenticated', p.oid, 'EXECUTE'));

-- Done. ✅
