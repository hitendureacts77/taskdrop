-- The `environment` setting (migration 127): staging by default, read through
-- get_app_controls (what app-config serves), changed only by a full admin with
-- the authenticator code, on the 'all' row only, and written to the audit log.
--
-- One transaction, rolled back, so no rows are left behind. See the note in
-- app_controls.test.sql: the test session is postgres, so private.is_admin() is
-- always true and an ordinary person's refusal is covered by the staff-role checks.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/environment_setting.test.sql

begin;

create or replace function pg_temp.become(p_user uuid, p_aal text default 'aal2') returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', p_aal)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

do $$
declare
  v_full    uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_err     text;
  v_cfg     jsonb;
  v_n       int;
  v_before  int;
  p         text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'env+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_finance), (v_support)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'Env Full'), (v_finance, 'Env Finance'), (v_support, 'Env Support')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_finance, v_support]) u on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role, notify)
  values (v_finance, 'finance', false), (v_support, 'support', false);
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  -- ---- the default is staging, on every row and for every caller -------------
  perform pg_temp.as_owner();
  update public.app_controls set environment = 'staging';
  select count(*) into v_n from public.app_controls where environment = 'staging';
  if v_n <> 4 then raise exception 'FAIL: expected four staging rows, found %', v_n; end if;
  foreach p in array array['web', 'android', 'ios', 'not-a-platform'] loop
    if public.get_app_controls(p, '1.0.0') ->> 'environment' is distinct from 'staging' then
      raise exception 'FAIL: % did not get staging by default', p;
    end if;
  end loop;
  if public.get_app_controls(null, null) ->> 'environment' is distinct from 'staging' then
    raise exception 'FAIL: a caller with no platform did not get staging';
  end if;
  -- the column default is what a fresh project and an old row get
  if (select column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'app_controls' and column_name = 'environment')
     is distinct from '''staging''::text' then
    raise exception 'FAIL: the environment column does not default to staging';
  end if;
  -- the answer keeps the fields it had
  v_cfg := public.get_app_controls('web', null);
  if not (v_cfg ?& array['platform', 'maintenance', 'update_required', 'signups_open', 'posting', 'topups',
                         'withdrawals', 'require_phone_verified', 'banner_text']) then
    raise exception 'FAIL: get_app_controls lost a field (%)', v_cfg;
  end if;

  -- ---- only the table's own check values, and only on the all row ------------
  v_err := pg_temp.try('update public.app_controls set environment = ''alpha'' where platform = ''all''');
  if v_err is null then raise exception 'FAIL: an unknown environment was stored'; end if;
  v_err := pg_temp.try('update public.app_controls set environment = ''production'' where platform = ''web''');
  if v_err is null then raise exception 'FAIL: a platform row was set to production'; end if;

  -- ---- who may change it -------------------------------------------------------
  perform pg_temp.become(v_support);
  v_err := pg_temp.try('select public.admin_set_app_control(''all'', ''{"environment": "production"}'', null)');
  if coalesce(v_err, '') not like '%staff role%' then
    raise exception 'FAIL: support changed the environment (%)', v_err;
  end if;
  -- finance may change money switches only; the environment is not one of them
  perform pg_temp.become(v_finance);
  v_err := pg_temp.try('select public.admin_set_app_control(''all'', ''{"environment": "production"}'', null)');
  if coalesce(v_err, '') not like '%staff role%' then
    raise exception 'FAIL: finance changed the environment (%)', v_err;
  end if;
  v_err := pg_temp.try('select public.admin_set_app_control(''all'', ''{"withdrawals": false, "environment": "production"}'', null)');
  if coalesce(v_err, '') not like '%staff role%' then
    raise exception 'FAIL: finance slipped the environment in beside a money switch (%)', v_err;
  end if;
  -- a full admin needs the authenticator code, like the money switches
  perform pg_temp.become(v_full, 'aal1');
  v_err := pg_temp.try('select public.admin_set_app_control(''all'', ''{"environment": "production"}'', null)');
  if coalesce(v_err, '') not like '%authenticator%' then
    raise exception 'FAIL: the environment changed without the authenticator code (%)', v_err;
  end if;
  perform pg_temp.as_owner();
  if public.get_app_controls(null, null) ->> 'environment' is distinct from 'staging' then
    raise exception 'FAIL: a refused change still moved the environment';
  end if;

  -- ---- what is accepted ---------------------------------------------------------
  perform pg_temp.become(v_full, 'aal2');
  foreach p in array array['"alpha"', '""', '"Production"', 'true', 'null', '1'] loop
    v_err := pg_temp.try(format('select public.admin_set_app_control(''all'', %L, null)', '{"environment": ' || p || '}'));
    if v_err is null then raise exception 'FAIL: a bad environment value % was accepted', p; end if;
  end loop;
  foreach p in array array['web', 'android', 'ios'] loop
    v_err := pg_temp.try(format('select public.admin_set_app_control(%L, ''{"environment": "production"}'', null)', p));
    if coalesce(v_err, '') not like '%all row only%' then
      raise exception 'FAIL: environment was changed on the % row (%)', p, v_err;
    end if;
  end loop;

  select count(*) into v_before from public.admin_audit_log where action = 'app_control_changed';
  v_cfg := public.admin_set_app_control('all', '{"environment": "production"}', 'going live');
  if v_cfg ->> 'environment' is distinct from 'production' or (v_cfg ->> 'updated_by')::uuid is distinct from v_full then
    raise exception 'FAIL: a full admin with a code could not set production (%)', v_cfg;
  end if;
  foreach p in array array['web', 'android', 'ios'] loop
    if public.get_app_controls(p, null) ->> 'environment' is distinct from 'production' then
      raise exception 'FAIL: production on All did not reach %', p;
    end if;
  end loop;
  if public.get_app_controls(null, null) ->> 'environment' is distinct from 'production' then
    raise exception 'FAIL: production on All did not reach a caller with no platform';
  end if;
  -- and it never touched another switch
  if not (public.get_app_controls('web', null) ->> 'bidding')::boolean
     or not (public.get_app_controls('web', null) ->> 'topups')::boolean then
    raise exception 'FAIL: changing the environment switched something else off';
  end if;

  -- ---- the audit trail ----------------------------------------------------------
  perform pg_temp.as_owner();
  select count(*) into v_n from public.admin_audit_log
   where action = 'app_control_changed' and target_id = 'app_controls:all' and actor = v_full
     and detail like 'reason: going live%' and detail like '%environment: staging -> production%';
  if v_n <> 1 then raise exception 'FAIL: the environment change is not in the audit log exactly once (%)', v_n; end if;

  -- a no-op writes nothing; a refused change writes nothing
  select count(*) into v_before from public.admin_audit_log where action = 'app_control_changed';
  perform pg_temp.become(v_full, 'aal2');
  perform public.admin_set_app_control('all', '{"environment": "production"}', 'same again');
  perform pg_temp.become(v_support);
  perform pg_temp.try('select public.admin_set_app_control(''all'', ''{"environment": "staging"}'', null)');
  perform pg_temp.as_owner();
  select count(*) into v_n from public.admin_audit_log where action = 'app_control_changed';
  if v_n <> v_before then raise exception 'FAIL: a no-op or refused environment change was logged'; end if;

  -- ---- and back to staging ----------------------------------------------------
  perform pg_temp.become(v_full, 'aal2');
  v_cfg := public.admin_set_app_control('all', '{"environment": "staging"}', 'back to staging');
  if v_cfg ->> 'environment' is distinct from 'staging' then
    raise exception 'FAIL: could not set the environment back to staging (%)', v_cfg;
  end if;
  perform pg_temp.as_owner();
  if public.get_app_controls('web', null) ->> 'environment' is distinct from 'staging' then
    raise exception 'FAIL: staging did not come back';
  end if;

  raise notice 'environment_setting: all assertions passed';
end;
$$;

rollback;
