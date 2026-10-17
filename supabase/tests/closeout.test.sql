-- Closing the admin control-center plan (migration 097): what blocking does,
-- the Sales role, leads, automation rules, the money check runs, the verified
-- phone switch and the devices summary.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/closeout.test.sql
-- Note: the test session's user is postgres, for which private.is_admin() is true,
-- so "not an admin" cases cannot be asserted here; staff-role cases can.
-- (or: supabase db query --linked -f supabase/tests/closeout.test.sql)

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

-- null when the statement ran; otherwise the error message.
create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

create or replace function pg_temp.role_refused(p_sql text) returns boolean
language plpgsql as $$
declare v text := pg_temp.try(p_sql);
begin
  return coalesce(v, '') like '%staff role%';
end;
$$;

do $$
declare
  v_full    uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_sales   uuid := gen_random_uuid();
  v_viewer  uuid := gen_random_uuid();
  v_poster  uuid := gen_random_uuid();
  v_worker  uuid := gen_random_uuid();
  v_idle    uuid := gen_random_uuid();
  v_task    uuid;
  v_rule    uuid;
  v_lead    uuid;
  v_err     text;
  v_n       int;
  v_made    int;
  v_json    jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'closeout+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_support), (v_sales), (v_viewer), (v_poster), (v_worker), (v_idle)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'C Full'), (v_support, 'C Support'), (v_sales, 'C Sales'), (v_viewer, 'C Viewer'),
         (v_poster, 'C Poster'), (v_worker, 'C Worker'), (v_idle, 'C Idle')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_support, v_sales, v_viewer]) u on conflict do nothing;
  insert into public.user_roles (user_id, role) values (v_worker, 'worker') on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role)
  values (v_support, 'support'), (v_sales, 'sales'), (v_viewer, 'viewer');
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'closeout test job', 10000, 60) returning id into v_task;

  -- ---- blocking: the blocker stops seeing the job and cannot bid on it ---------
  -- A test session runs as postgres, and private.is_admin() is true for that
  -- session user, so a SELECT on tasks always sees every row here. The parts of
  -- the tasks_hide_blocked rule are therefore asserted directly, and the bid
  -- policy (which has no admin bypass) is asserted through a real insert.
  perform pg_temp.become(v_worker);
  perform public.block_user(v_poster);
  if not private.is_blocking(v_worker, v_poster) then raise exception 'FAIL: block_user did not record the block'; end if;
  if private.has_assignment(v_task, v_worker) then raise exception 'FAIL: has_assignment is true for someone never assigned'; end if;
  if (select polqual is null from pg_policy where polname = 'tasks_hide_blocked' and polrelid = 'public.tasks'::regclass) then
    raise exception 'FAIL: the tasks_hide_blocked policy is missing';
  end if;
  perform pg_temp.as_owner();
  if not private.bid_is_blocked(v_task, v_worker) then raise exception 'FAIL: bid_is_blocked missed the worker''s own block'; end if;
  perform pg_temp.become(v_worker);
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 5000, 30)', v_task, v_worker));
  if v_err is null or v_err not like '%row-level security%' then
    raise exception 'FAIL: a blocker was able to bid on the blocked person''s job (%)', coalesce(v_err, 'no error');
  end if;
  perform public.unblock_user(v_poster);
  if private.is_blocking(v_worker, v_poster) then raise exception 'FAIL: unblocking did not remove the block'; end if;

  -- the poster blocks the worker: the worker still sees the job but cannot bid
  perform pg_temp.become(v_poster);
  perform public.block_user(v_worker);
  perform pg_temp.become(v_worker);
  if private.is_blocking(v_worker, v_poster) then raise exception 'FAIL: being blocked made the worker a blocker'; end if;
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 5000, 30)', v_task, v_worker));
  if v_err is null or v_err not like '%row-level security%' then
    raise exception 'FAIL: a blocked person was able to bid (%)', coalesce(v_err, 'no error');
  end if;

  -- ---- Sales: people area yes, money and settings no ---------------------------
  perform pg_temp.become(v_full);
  if public.admin_set_staff(v_sales, 'sales') <> 'sales' then raise exception 'FAIL: admin_set_staff refused the sales role'; end if;
  perform pg_temp.become(v_sales);
  v_lead := public.crm_add_lead('Test Cafe', '+91 90000 00000', 'business', 'walk-in', 'wants to post jobs', null);
  perform public.crm_update_lead(v_lead, 'contacted', 'called, will call back', v_sales);
  if (select stage from public.crm_leads where id = v_lead) <> 'contacted' then raise exception 'FAIL: lead stage did not change'; end if;
  perform public.crm_add_task('sales follow-up', v_idle, now() + interval '1 day', null, null, null);
  if not pg_temp.role_refused('update public.settings set value = value where key = ''review_window_days''') then
    raise exception 'FAIL: sales changed a setting';
  end if;
  if pg_temp.try(format(
       'insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason) values (%L, 100, 0, 0, ''x'')', v_idle)) is null then
    raise exception 'FAIL: sales changed someone''s wallet';
  end if;
  v_err := pg_temp.try('select public.admin_save_crm_rule(null, ''x'', ''funded_no_task'', 3, true)');
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: sales edited an automation rule (%)', v_err; end if;

  -- viewers and support cannot add leads or edit rules respectively
  perform pg_temp.become(v_viewer);
  if not pg_temp.role_refused('select public.crm_add_lead(''Nope'')') then raise exception 'FAIL: a viewer added a lead'; end if;
  perform pg_temp.become(v_support);
  v_err := pg_temp.try('select public.admin_save_crm_rule(null, ''x'', ''funded_no_task'', 3, true)');
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: support edited an automation rule (%)', v_err; end if;

  -- ---- automation rules: admin edits, the service key runs them, once -----------
  perform pg_temp.become(v_full);
  select count(*) into v_n from public.crm_rules;
  if v_n < 2 then raise exception 'FAIL: the two starter rules are missing'; end if;
  v_rule := public.admin_save_crm_rule(null, 'Test: topped up, no job', 'funded_no_task', 7, true);
  if not exists (select 1 from public.admin_audit_log where action = 'crm_rule_saved' and target_id = 'crm_rules:' || v_rule) then
    raise exception 'FAIL: saving a rule left no audit row';
  end if;
  v_err := pg_temp.try('select public.run_crm_rules()');
  if v_err is null then raise exception 'FAIL: a signed-in admin could run the rule runner'; end if;

  perform pg_temp.as_owner();
  insert into public.payments (user_id, purpose, amount_minor, status, paid_at)
  values (v_idle, 'topup', 50000, 'paid', now() - interval '10 days');
  v_made := public.run_crm_rules();
  if v_made < 1 then raise exception 'FAIL: the funded-but-idle rule created no follow-up (%)', v_made; end if;
  select count(*) into v_n from public.crm_tasks where user_id = v_idle and source = 'automation' and status = 'open';
  if v_n <> 1 then raise exception 'FAIL: expected one automation follow-up, found %', v_n; end if;
  select public.run_crm_rules() into v_made;
  select count(*) into v_n from public.crm_tasks where user_id = v_idle and source = 'automation';
  if v_n <> 1 then raise exception 'FAIL: running the rules twice made a duplicate follow-up (%)', v_n; end if;
  -- someone who then posts is not chased
  insert into public.payments (user_id, purpose, amount_minor, status, paid_at)
  values (v_worker, 'topup', 50000, 'paid', now() - interval '10 days');
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_worker, 'services', 'posted after top-up', 10000, 60);
  perform public.run_crm_rules();
  if exists (select 1 from public.crm_tasks where user_id = v_worker and source = 'automation') then
    raise exception 'FAIL: the rule chased someone who had posted a job';
  end if;

  -- ---- money check: the nightly run and who can read it ---------------------------
  v_json := public.run_reconciliation(3);
  if v_json ->> 'run' is null then raise exception 'FAIL: run_reconciliation returned no run id'; end if;
  perform pg_temp.become(v_full);
  if (select count(*) from public.admin_reconciliation_runs(5)) < 1 then raise exception 'FAIL: the run is not listed'; end if;
  v_err := pg_temp.try('select public.run_reconciliation(3)');
  if v_err is null then raise exception 'FAIL: a signed-in admin ran the service-only reconciliation'; end if;
  v_err := pg_temp.try('select * from public.reconcile_provider_candidates(3)');
  if v_err is null then raise exception 'FAIL: a signed-in admin read the provider candidates'; end if;
  perform pg_temp.become(v_sales);
  v_err := pg_temp.try('select * from public.admin_reconciliation_runs(5)');
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: sales read the money check runs (%)', v_err; end if;
  perform pg_temp.as_owner();
  perform public.record_provider_reconciliation(12, '[{"payment":"x","note":"test"}]'::jsonb);
  if not exists (select 1 from public.reconciliation_runs where kind = 'razorpay' and mismatches = 1 and checked = 12) then
    raise exception 'FAIL: the Razorpay comparison was not recorded';
  end if;
  if not exists (select 1 from public.admin_alerts where kind = 'reconcile') then
    raise exception 'FAIL: a mismatch left no alert';
  end if;

  -- ---- verified phone switch ---------------------------------------------------
  perform pg_temp.become(v_full);
  perform public.admin_set_app_control('android', '{"require_phone_verified": true}'::jsonb, 'closeout test');
  if (public.get_app_controls('android', null) ->> 'require_phone_verified')::boolean is not true then
    raise exception 'FAIL: the verified-phone switch did not show for android';
  end if;
  if (public.get_app_controls('ios', null) ->> 'require_phone_verified')::boolean is not false then
    raise exception 'FAIL: the android switch leaked to ios';
  end if;
  if (public.get_app_controls(null, null) ->> 'require_phone_verified')::boolean is not false then
    raise exception 'FAIL: the android switch leaked to an old app';
  end if;
  perform pg_temp.become(v_support);
  v_err := pg_temp.try('select public.admin_set_app_control(''android'', ''{"require_phone_verified": false}''::jsonb, ''x'')');
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: support changed the verified-phone switch (%)', v_err; end if;

  -- ---- devices summary -------------------------------------------------------------
  perform pg_temp.as_owner();
  insert into public.app_devices (user_id, install_id, platform, app_version, os_version)
  values (v_worker, 'closeout-install-1', 'android', '9.9.9', 'Android 14');
  perform pg_temp.become(v_full);
  if not exists (select 1 from public.admin_devices_summary() where platform = 'android' and app_version = '9.9.9') then
    raise exception 'FAIL: the devices summary missed a device';
  end if;

  raise notice 'closeout: all assertions passed';
end;
$$;

rollback;
