-- 142 — sessions a person (or an admin) can end, and that stop working at once (task 2.13 part I, hole H26).
--
-- Before this: "Sign out" ended only the device in your hand; nobody could end all of a person's sessions
-- from the app; and an admin's "sign out everywhere" (116) deleted the sessions but a token already issued
-- kept working for up to an hour, because the api checks a token's signature, not whether its session
-- still exists.
--
-- Now every way of ending sessions goes through private.end_sessions, which also writes a cutoff on the
-- person's profile. The api reads the cutoff (it already reads the profile for suspension) and refuses any
-- token issued before it, except the one session the person chose to keep. Additive: two nullable columns
-- and three new functions; 116's function keeps its name, arguments and result and only gains the cutoff.

alter table public.profiles
  add column if not exists sessions_revoked_at timestamptz,
  add column if not exists sessions_keep_session uuid;

comment on column public.profiles.sessions_revoked_at is
  'When this person''s sessions were last ended. The api refuses any token issued before it (task 2.13 part I).';
comment on column public.profiles.sessions_keep_session is
  'The one session that survived that ending (the device that changed the password), or null when all were ended.';

-- A person must not be able to write their own cutoff (the column-level update grants are an allow-list, so a
-- new column is not writable; this makes the intent explicit and keeps it so if a table-wide grant ever appears).
revoke update (sessions_revoked_at, sessions_keep_session) on public.profiles from anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- The one place sessions are ended. Returns how many sessions were ended.
-- p_keep: the session to leave alone (the device that just changed the password); null ends every session.
-- ---------------------------------------------------------------------------------------------------------
create or replace function private.end_sessions(p_user uuid, p_keep uuid default null)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_count integer;
begin
  select count(*) into v_count from auth.sessions
   where user_id = p_user and (p_keep is null or id <> p_keep);

  update public.profiles
     set sessions_revoked_at = now(), sessions_keep_session = p_keep
   where id = p_user;

  delete from auth.refresh_tokens
   where user_id = p_user::text and (p_keep is null or session_id is distinct from p_keep);
  delete from auth.sessions
   where user_id = p_user and (p_keep is null or id <> p_keep);

  -- Ending everything also stops notifications to phones that are no longer signed in.
  if p_keep is null then
    delete from public.push_tokens where user_id = p_user;
  end if;
  return v_count;
end;
$fn$;
revoke all on function private.end_sessions(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- "Sign out of all devices" and "sign out my other devices", called by the person themselves (through the api).
-- p_all = true ends every session including this one; false keeps the session making the call (read from the
-- caller's own token), for a password change.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.end_my_sessions(p_all boolean default false)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me   uuid := auth.uid();
  v_keep uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '28000'; end if;
  if not coalesce(p_all, false) then
    begin
      v_keep := nullif(auth.jwt() ->> 'session_id', '')::uuid;
    exception when others then
      v_keep := null;
    end;
    if v_keep is null then
      raise exception 'Cannot tell which device this is. Sign out of all devices instead.' using errcode = '22023';
    end if;
  end if;
  return private.end_sessions(v_me, case when coalesce(p_all, false) then null else v_keep end);
end;
$fn$;
revoke all on function public.end_my_sessions(boolean) from public, anon;
grant execute on function public.end_my_sessions(boolean) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- 116's admin button, now with the cutoff: the person's open apps stop working on their next call, not within
-- the hour. Same name, arguments, checks and audit entry as before.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_sign_out_everywhere(p_user uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_actor uuid := auth.uid();
  v_count integer;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not private.staff_can(v_actor, 'admin') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why, so the next admin knows'; end if;
  if p_user = v_actor then raise exception 'Use Sign out on your own devices instead'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'That person no longer exists'; end if;

  v_count := private.end_sessions(p_user, null);

  perform public.admin_log_event(
    'user_signed_out_everywhere',
    'user:' || p_user,
    left('reason: ' || left(btrim(p_reason), 200) || '; sessions ended: ' || v_count, 500));
  return v_count;
end;
$fn$;
revoke all on function public.admin_sign_out_everywhere(uuid, text) from public, anon;
grant execute on function public.admin_sign_out_everywhere(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------
-- Emergency: end every other staff member's sessions (the caller keeps theirs). Full admins only.
-- ---------------------------------------------------------------------------------------------------------
create or replace function public.admin_end_all_staff_sessions(p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_actor uuid := auth.uid();
  v_row   record;
  v_count integer := 0;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not private.staff_can(v_actor, 'admin') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why, so the next admin knows'; end if;

  for v_row in select user_id from public.user_roles where role = 'admin' and user_id <> v_actor loop
    v_count := v_count + private.end_sessions(v_row.user_id, null);
  end loop;

  perform public.admin_log_event(
    'staff_sessions_ended',
    'staff:all',
    left('reason: ' || left(btrim(p_reason), 200) || '; sessions ended: ' || v_count, 500));
  return v_count;
end;
$fn$;
revoke all on function public.admin_end_all_staff_sessions(text) from public, anon;
grant execute on function public.admin_end_all_staff_sessions(text) to authenticated;
