-- Warning a person (migration 120).
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/warn_user.test.sql

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
  v_admin    uuid := gen_random_uuid();
  v_target   uuid := gen_random_uuid();
  v_reporter uuid := gen_random_uuid();
  v_report   uuid;
  v_warning  uuid;
  v_failed   boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'warn+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_target), (v_reporter)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'Warn Admin'), (v_target, 'Warn Target'), (v_reporter, 'Warn Reporter') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_admin), (v_target), (v_reporter) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  perform pg_temp.as_operator();
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_reporter, 'user', v_target, 'rude in chat') returning id into v_report;

  -- people who are not staff cannot
  perform pg_temp.become(v_reporter);
  v_failed := false;
  begin perform public.admin_warn_user(v_target, 'be nice'); exception when others then v_failed := true; end;
  assert v_failed, 'only staff can warn';

  perform pg_temp.become(v_admin);
  v_failed := false;
  begin perform public.admin_warn_user(v_target, '  '); exception when others then v_failed := true; end;
  assert v_failed, 'a reason is required';
  v_failed := false;
  begin perform public.admin_warn_user(v_admin, 'self'); exception when others then v_failed := true; end;
  assert v_failed, 'you cannot warn yourself';
  v_failed := false;
  begin perform public.admin_warn_user(gen_random_uuid(), 'nobody'); exception when others then v_failed := true; end;
  assert v_failed, 'the person must exist';

  v_warning := public.admin_warn_user(v_target, 'Please keep chat polite.', v_report);

  perform pg_temp.as_operator();
  assert exists (select 1 from public.user_warnings where id = v_warning and user_id = v_target and report_id = v_report),
    'the warning is kept on their record';
  assert exists (select 1 from public.notifications where user_id = v_target and kind = 'admin_warning'),
    'the person is told';
  assert (select status from public.reports where id = v_report) = 'actioned', 'the report is closed as actioned';
  assert exists (select 1 from public.admin_audit_log where action = 'user.warn' and target_id = v_target::text),
    'the warning is audit-logged';

  -- a warning without a report works too, and a second one is kept as well
  perform pg_temp.become(v_admin);
  perform public.admin_warn_user(v_target, 'Second warning, no report.');
  perform pg_temp.as_operator();
  assert (select count(*) from public.user_warnings where user_id = v_target) = 2, 'both warnings are kept';

  raise notice 'warn_user: all assertions passed';
end;
$$;

rollback;
