-- Sessions a person (or an admin) can end, and the cutoff the api reads (migration 142, task 2.13 part I).
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/session_cutoff.test.sql

begin;

-- A signed-in caller. p_session is the session id inside their token (what the api's token carries as session_id).
create or replace function pg_temp.become(p_user uuid, p_session uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
end;
$$;

do $$
declare
  v_admin   uuid := gen_random_uuid();
  v_admin2  uuid := gen_random_uuid();
  v_person  uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  s1 uuid := gen_random_uuid();
  s2 uuid := gen_random_uuid();
  s3 uuid := gen_random_uuid();
  so uuid := gen_random_uuid();
  sa uuid := gen_random_uuid();
  sa2 uuid := gen_random_uuid();
  v_n      integer;
  v_failed boolean;
  v_at     timestamptz;
  v_keep   uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'cutoff+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_admin2), (v_person), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'Admin'), (v_admin2, 'Admin Two'), (v_person, 'Person'), (v_other, 'Other') on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin'), (v_admin2, 'admin') on conflict do nothing;

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (s1, v_person, now(), now()), (s2, v_person, now(), now()), (s3, v_person, now(), now()),
         (so, v_other, now(), now()), (sa, v_admin, now(), now()), (sa2, v_admin2, now(), now());
  insert into auth.refresh_tokens (token, user_id, session_id)
  values ('cutoff-t1-' || s1, v_person::text, s1), ('cutoff-t2-' || s2, v_person::text, s2), ('cutoff-to-' || so, v_other::text, so);

  -- ---- 1. nobody has ended anything yet
  select sessions_revoked_at, sessions_keep_session into v_at, v_keep from public.profiles where id = v_person;
  assert v_at is null and v_keep is null, 'a new profile has no cutoff';

  -- ---- 2. sign out my other devices: the calling session stays, the rest go, and the cutoff names the survivor
  perform pg_temp.become(v_person, s2);
  v_n := public.end_my_sessions(false);
  assert v_n = 2, 'two other sessions are ended, got ' || v_n;
  perform pg_temp.as_operator();
  assert (select count(*) from auth.sessions where user_id = v_person) = 1, 'one session is left';
  assert exists (select 1 from auth.sessions where id = s2), 'the session that asked is the one that stays';
  assert not exists (select 1 from auth.refresh_tokens where session_id = s1), 'an ended session cannot be renewed';
  assert exists (select 1 from auth.refresh_tokens where session_id = s2), 'the kept session can still be renewed';
  select sessions_revoked_at, sessions_keep_session into v_at, v_keep from public.profiles where id = v_person;
  assert v_at is not null and v_at <= now(), 'the cutoff is written';
  assert v_keep = s2, 'the cutoff names the kept session';
  assert exists (select 1 from auth.sessions where id = so), 'another person''s session is untouched';
  assert exists (select 1 from auth.refresh_tokens where session_id = so), 'another person''s renewal token is untouched';
  select sessions_revoked_at into v_at from public.profiles where id = v_other;
  assert v_at is null, 'another person''s cutoff is untouched';

  -- ---- 3. a call that cannot say which device it is must not guess
  perform pg_temp.become(v_person, null);
  v_failed := false;
  begin perform public.end_my_sessions(false);
  exception when others then v_failed := true; end;
  assert v_failed, 'without a session in the token, only "all devices" is allowed';

  -- ---- 4. sign out of all devices: every session goes, none is kept
  perform pg_temp.become(v_person, s2);
  v_n := public.end_my_sessions(true);
  assert v_n = 1, 'the last session is ended, got ' || v_n;
  perform pg_temp.as_operator();
  assert (select count(*) from auth.sessions where user_id = v_person) = 0, 'no session is left';
  select sessions_keep_session into v_keep from public.profiles where id = v_person;
  assert v_keep is null, 'nothing survives a sign-out of all devices';

  -- ---- 5. only a signed-in person can ask
  perform pg_temp.as_anon();
  v_failed := false;
  begin perform public.end_my_sessions(true);
  exception when others then v_failed := true; end;
  assert v_failed, 'the anonymous role cannot end sessions';

  -- ---- 6. a person cannot write their own (or anyone's) cutoff to undo it
  perform pg_temp.become(v_person, null);
  v_failed := false;
  begin
    update public.profiles set sessions_revoked_at = null, sessions_keep_session = null where id = v_person;
    get diagnostics v_n = row_count;
    v_failed := v_n = 0;
  exception when others then v_failed := true; end;
  assert v_failed, 'the cutoff columns cannot be written by the person';
  v_failed := false;
  begin
    perform private.end_sessions(v_other, null);
  exception when others then v_failed := true; end;
  assert v_failed, 'the internal function is not callable by a signed-in person';

  -- ---- 7. the admin button now writes the cutoff too (116 kept its name and checks)
  perform pg_temp.as_operator();
  insert into auth.sessions (id, user_id, created_at, updated_at) values (gen_random_uuid(), v_other, now(), now());
  perform pg_temp.become(v_admin, sa);
  v_n := public.admin_sign_out_everywhere(v_other, 'lost phone');
  assert v_n = 2, 'both of the other person''s sessions are ended, got ' || v_n;
  perform pg_temp.as_operator();
  select sessions_revoked_at, sessions_keep_session into v_at, v_keep from public.profiles where id = v_other;
  assert v_at is not null and v_keep is null, 'the admin button writes the cutoff';

  -- ---- 8. end all staff sessions: a non-admin is refused, a reason is required, the caller keeps theirs
  perform pg_temp.become(v_person, null);
  v_failed := false;
  begin perform public.admin_end_all_staff_sessions('because');
  exception when others then v_failed := true; end;
  assert v_failed, 'only an admin can end the staff''s sessions';
  perform pg_temp.become(v_admin, sa);
  v_failed := false;
  begin perform public.admin_end_all_staff_sessions('   ');
  exception when others then v_failed := true; end;
  assert v_failed, 'a reason is required';
  v_n := public.admin_end_all_staff_sessions('stolen laptop');
  assert v_n = 1, 'the other admin''s session is ended, got ' || v_n;
  perform pg_temp.as_operator();
  assert exists (select 1 from auth.sessions where id = sa), 'the admin who pressed it stays signed in';
  assert not exists (select 1 from auth.sessions where id = sa2), 'the other admin is signed out';
  assert (select sessions_revoked_at from public.profiles where id = v_admin) is null, 'the caller gets no cutoff';
  assert (select sessions_revoked_at from public.profiles where id = v_admin2) is not null, 'the other admin does';
  assert exists (select 1 from public.admin_audit_log where action = 'staff_sessions_ended'), 'it is written to the audit log';
end;
$$;

rollback;
select 'ok  - session_cutoff';
