-- ============================================================================
-- PANALO — Phase 25: log in with your username
-- ============================================================================
--
-- Run after phase 24. Safe to re-run.
--
-- Supabase signs people in by email. To accept a username instead, the app
-- needs that account's email -- but an "email for this username" lookup
-- would let anyone who knows a username read the email behind it, and the
-- privacy page promises your email is never shown to anyone.
--
-- So login_email() returns the email only together with the right
-- password: it checks the password against the account's own hash first.
-- Someone who has both could sign in anyway, so nothing new is revealed.
-- The app then signs in normally, with the email, through Supabase (bot
-- check, leaked-password rules and all).
--
-- Guessing passwords through it is limited: ten wrong tries per username
-- per hour, after which only email login works for that hour. Attempts are
-- kept a day, then erased.
-- ============================================================================

create table if not exists private.login_attempts (
  id          bigint generated always as identity primary key,
  username_lc text not null,
  at          timestamptz not null default now()
);
create index if not exists login_attempts_user_at on private.login_attempts (username_lc, at);
revoke all on private.login_attempts from public, anon, authenticated;
alter table private.login_attempts enable row level security;

create or replace function public.login_email(p_username text, p_password text)
returns text
language plpgsql
security definer
set search_path = extensions, public
as $$
declare
  u     text := lower(ltrim(btrim(coalesce(p_username, '')), '@'));
  mail  text;
  hash  text;
  fails integer;
begin
  if u = '' or char_length(u) > 60 or p_password is null or char_length(p_password) > 200 then
    return null;
  end if;
  select count(*) into fails
    from private.login_attempts a
   where a.username_lc = u and a.at > now() - interval '1 hour';
  if fails >= 10 then
    raise exception 'Too many tries with this username. Use your email, or try again in an hour.' using errcode = '54000';
  end if;
  select au.email, au.encrypted_password into mail, hash
    from public.profiles p
    join auth.users au on au.id = p.id
   where lower(p.username) = u;
  if mail is not null and hash is not null and hash <> '' and crypt(p_password, hash) = hash then
    return mail;
  end if;
  insert into private.login_attempts (username_lc) values (u);
  return null;
end;
$$;

revoke execute on function public.login_email(text, text) from public;
grant execute on function public.login_email(text, text) to anon, authenticated;

create or replace function private.purge_login_attempts()
returns integer
language sql
security definer
set search_path = ''
as $$
  with gone as (delete from private.login_attempts where at < now() - interval '1 day' returning 1)
  select count(*)::int from gone
$$;
revoke execute on function private.purge_login_attempts() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('panalo-purge-login-attempts', '41 * * * *', 'select private.purge_login_attempts()');
  end if;
end;
$$;


-- ############################################################################
-- Verify
-- ############################################################################
select 'username login' as check_name,
       case when to_regprocedure('public.login_email(text, text)') is not null then 'yes' else 'MISSING' end as result;

-- Done. ✅
