-- Admin "sign out everywhere" (migration 116). Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_sign_out_everywhere.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
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

do $$
declare
  v_admin  uuid := gen_random_uuid();
  v_person uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_n      integer;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'signout+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_person), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'Admin'), (v_person, 'Person'), (v_other, 'Other') on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  insert into auth.sessions (id, user_id, created_at, updated_at)
  values (gen_random_uuid(), v_person, now(), now()), (gen_random_uuid(), v_person, now(), now()),
         (gen_random_uuid(), v_other, now(), now());

  -- a person who is not an admin cannot
  perform pg_temp.become(v_person);
  v_failed := false;
  begin perform public.admin_sign_out_everywhere(v_other, 'because');
  exception when others then v_failed := true; end;
  assert v_failed, 'only an admin can end someone''s sessions';

  perform pg_temp.become(v_admin);
  -- a reason is required, and not yourself
  v_failed := false;
  begin perform public.admin_sign_out_everywhere(v_person, '  ');
  exception when others then v_failed := true; end;
  assert v_failed, 'a reason is required';
  v_failed := false;
  begin perform public.admin_sign_out_everywhere(v_admin, 'self');
  exception when others then v_failed := true; end;
  assert v_failed, 'an admin cannot use this on themselves';

  v_n := public.admin_sign_out_everywhere(v_person, 'lost phone');
  assert v_n = 2, 'both of their sessions are ended';

  perform pg_temp.as_operator();
  assert not exists (select 1 from auth.sessions where user_id = v_person), 'no session is left for them';
  assert exists (select 1 from auth.sessions where user_id = v_other), 'nobody else is touched';
  assert exists (select 1 from public.admin_audit_log where action = 'user_signed_out_everywhere' and target_id = 'user:' || v_person),
    'the action is in the audit log';

  raise notice 'admin_sign_out_everywhere: all assertions passed';
end;
$$;

rollback;
