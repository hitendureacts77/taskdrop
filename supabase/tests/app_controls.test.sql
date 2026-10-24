-- App controls (migration 092): the merge rules, who may change what, the
-- authenticator code on money switches, the audit row, and device records.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- Note: private.is_admin() is true for the operator connection (session_user
-- postgres), which is what psql and the Supabase SQL runner use. So this test
-- cannot show that an ordinary person is refused by is_admin() or by row-level
-- security on a table; it accepts the staff-role refusal that follows is_admin()
-- and checks the row-level-security policies exist instead.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/app_controls.test.sql

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

do $$
declare
  v_full    uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_person  uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_err     text;
  v_cfg     jsonb;
  v_n       int;
  v_before  int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'controls+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_finance), (v_support), (v_person), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'Ctl Full'), (v_finance, 'Ctl Finance'), (v_support, 'Ctl Support'),
         (v_person, 'Ctl Person'), (v_other, 'Ctl Other')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_finance, v_support]) u
  on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role, notify)
  values (v_finance, 'finance', false), (v_support, 'support', false);
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  -- A known starting point: everything on, nothing in maintenance.
  perform pg_temp.as_owner();
  update public.app_controls set
    maintenance = false, maintenance_message = null, min_version = null, update_url = null,
    signups_open = true, signin_phone = true, signin_google = true, signin_apple = true, signin_password = true,
    posting = true, bidding = true, topups = true, withdrawals = true, promotions = true, chat_photos = true,
    banner_text = null, banner_level = 'info', banner_link = null, banner_ends_at = null;
  select count(*) into v_n from public.app_controls where platform in ('all', 'web', 'android', 'ios');
  if v_n <> 4 then raise exception 'FAIL: expected the four platform rows, found %', v_n; end if;

  -- ---- nobody writes the table directly ------------------------------------
  if has_table_privilege('authenticated', 'public.app_controls', 'INSERT')
     or has_table_privilege('authenticated', 'public.app_controls', 'UPDATE')
     or has_table_privilege('authenticated', 'public.app_controls', 'DELETE')
     or has_table_privilege('anon', 'public.app_controls', 'SELECT')
     or has_table_privilege('anon', 'public.app_devices', 'SELECT')
     or has_table_privilege('authenticated', 'public.app_devices', 'INSERT') then
    raise exception 'FAIL: app_controls or app_devices can be written directly, or read signed out';
  end if;
  if has_function_privilege('anon', 'public.admin_set_app_control(text, jsonb, text)', 'EXECUTE') then
    raise exception 'FAIL: a signed-out caller can run admin_set_app_control';
  end if;

  -- ---- the merge ------------------------------------------------------------
  v_cfg := public.get_app_controls('android', '1.0.0');
  if (v_cfg ->> 'maintenance')::boolean or (v_cfg ->> 'update_required')::boolean
     or not (v_cfg ->> 'bidding')::boolean or v_cfg -> 'banner_text' is distinct from 'null'::jsonb then
    raise exception 'FAIL: the defaults are not all-on (%)', v_cfg;
  end if;

  update public.app_controls set bidding = false where platform = 'android';
  if (public.get_app_controls('android', null) ->> 'bidding')::boolean then
    raise exception 'FAIL: bidding is off for Android but the config says on';
  end if;
  if not (public.get_app_controls('ios', null) ->> 'bidding')::boolean
     or not (public.get_app_controls('web', null) ->> 'bidding')::boolean then
    raise exception 'FAIL: switching Android off switched another platform off';
  end if;

  update public.app_controls set posting = false where platform = 'all';
  if (public.get_app_controls('ios', null) ->> 'posting')::boolean
     or (public.get_app_controls('web', null) ->> 'posting')::boolean then
    raise exception 'FAIL: an All switch did not reach every platform';
  end if;
  -- the old app sends no platform: it still gets the All row
  if (public.get_app_controls(null, null) ->> 'posting')::boolean then
    raise exception 'FAIL: the All row did not reach a caller with no platform';
  end if;
  if not (public.get_app_controls(null, null) ->> 'bidding')::boolean then
    raise exception 'FAIL: a caller with no platform picked up a platform row';
  end if;
  if not (public.get_app_controls('not-a-platform', 'garbage') ->> 'bidding')::boolean then
    raise exception 'FAIL: a bad platform or version broke the answer';
  end if;
  update public.app_controls set posting = true where platform = 'all';

  -- maintenance is on if either row says so, with the platform's own message first
  update public.app_controls set maintenance = true, maintenance_message = 'All down' where platform = 'all';
  update public.app_controls set maintenance_message = 'Android only' where platform = 'android';
  if not (public.get_app_controls('web', null) ->> 'maintenance')::boolean
     or public.get_app_controls('web', null) ->> 'maintenance_message' is distinct from 'All down' then
    raise exception 'FAIL: maintenance on All did not reach Web';
  end if;
  update public.app_controls set maintenance = false, maintenance_message = null where platform = 'all';
  update public.app_controls set maintenance = true where platform = 'android';
  if not (public.get_app_controls('android', null) ->> 'maintenance')::boolean
     or public.get_app_controls('android', null) ->> 'maintenance_message' is distinct from 'Android only'
     or (public.get_app_controls('ios', null) ->> 'maintenance')::boolean then
    raise exception 'FAIL: Android maintenance leaked, or lost its message';
  end if;
  update public.app_controls set maintenance = false, maintenance_message = null where platform = 'android';

  -- minimum version: numbers, not text; the higher row wins
  update public.app_controls set min_version = '1.10.0' where platform = 'all';
  update public.app_controls set min_version = '1.2' where platform = 'ios';
  if not (public.get_app_controls('android', '1.9.3') ->> 'update_required')::boolean then
    raise exception 'FAIL: 1.9.3 should be below 1.10.0';
  end if;
  if (public.get_app_controls('android', '1.10.0') ->> 'update_required')::boolean
     or (public.get_app_controls('android', '2.0.0') ->> 'update_required')::boolean then
    raise exception 'FAIL: the minimum version itself, or newer, was told to update';
  end if;
  if (public.get_app_controls('android', null) ->> 'update_required')::boolean then
    raise exception 'FAIL: an unknown version was told to update';
  end if;
  if public.get_app_controls('ios', '1.0.0') ->> 'min_version' is distinct from '1.10.0' then
    raise exception 'FAIL: the higher minimum version did not win';
  end if;
  update public.app_controls set min_version = null;

  -- the banner: it ends, and the platform's own wins
  update public.app_controls set banner_text = 'For everyone', banner_level = 'info' where platform = 'all';
  update public.app_controls set banner_text = 'Web only', banner_level = 'warning' where platform = 'web';
  if public.get_app_controls('web', null) ->> 'banner_text' is distinct from 'Web only'
     or public.get_app_controls('ios', null) ->> 'banner_text' is distinct from 'For everyone' then
    raise exception 'FAIL: banner choice is wrong';
  end if;
  update public.app_controls set banner_ends_at = now() - interval '1 minute' where platform = 'web';
  if public.get_app_controls('web', null) ->> 'banner_text' is distinct from 'For everyone' then
    raise exception 'FAIL: an ended banner still shows';
  end if;
  update public.app_controls set banner_text = null, banner_ends_at = null, banner_level = 'info';

  -- ---- admin_set_app_control: who -----------------------------------------
  perform pg_temp.become(v_person);
  v_err := pg_temp.try('select public.admin_set_app_control(''web'', ''{"bidding": false}'', null)');
  if coalesce(v_err, '') not like '%Admins only%' and coalesce(v_err, '') not like '%staff role%' then
    raise exception 'FAIL: an ordinary person changed app controls (%)', v_err;
  end if;

  perform pg_temp.become(v_support);
  v_err := pg_temp.try('select public.admin_set_app_control(''web'', ''{"bidding": false}'', null)');
  if coalesce(v_err, '') not like '%staff role%' then
    raise exception 'FAIL: support changed app controls (%)', v_err;
  end if;

  -- finance: money switches only, and only with the authenticator code
  perform pg_temp.become(v_finance);
  v_err := pg_temp.try('select public.admin_set_app_control(''web'', ''{"bidding": false}'', null)');
  if coalesce(v_err, '') not like '%staff role%' then
    raise exception 'FAIL: finance changed a non-money switch (%)', v_err;
  end if;
  v_err := pg_temp.try('select public.admin_set_app_control(''web'', ''{"withdrawals": false, "bidding": false}'', null)');
  if coalesce(v_err, '') not like '%staff role%' then
    raise exception 'FAIL: finance slipped a non-money switch in beside a money one (%)', v_err;
  end if;
  perform pg_temp.become(v_finance, 'aal1');
  v_err := pg_temp.try('select public.admin_set_app_control(''web'', ''{"withdrawals": false}'', null)');
  if coalesce(v_err, '') not like '%authenticator%' then
    raise exception 'FAIL: a money switch changed without the authenticator code (%)', v_err;
  end if;
  perform pg_temp.become(v_finance, 'aal2');
  v_cfg := public.admin_set_app_control('web', '{"withdrawals": false}', 'Razorpay X down');
  if (v_cfg ->> 'withdrawals')::boolean is distinct from false or (v_cfg ->> 'updated_by')::uuid is distinct from v_finance then
    raise exception 'FAIL: finance could not switch withdrawals off with a code (%)', v_cfg;
  end if;

  -- full admin: anything; money still needs the code, the rest does not
  perform pg_temp.become(v_full, 'aal1');
  v_cfg := public.admin_set_app_control('web', '{"bidding": false, "banner_text": "  Back at 6pm  ", "banner_level": "warning"}', 'planned work');
  if (v_cfg ->> 'bidding')::boolean is distinct from false or v_cfg ->> 'banner_level' is distinct from 'warning' then
    raise exception 'FAIL: a full admin could not change ordinary switches without a code (%)', v_cfg;
  end if;
  v_err := pg_temp.try('select public.admin_set_app_control(''web'', ''{"topups": false}'', null)');
  if coalesce(v_err, '') not like '%authenticator%' then
    raise exception 'FAIL: a full admin changed top-ups without the code (%)', v_err;
  end if;
  perform pg_temp.become(v_full, 'aal2');
  perform public.admin_set_app_control('web', '{"topups": false}', null);
  perform public.admin_set_app_control('web', '{"topups": true, "withdrawals": true}', null);

  -- ---- admin_set_app_control: what ------------------------------------------
  for v_err in
    select pg_temp.try(sql) from unnest(array[
      'select public.admin_set_app_control(''desktop'', ''{"bidding": false}'', null)',
      'select public.admin_set_app_control(''web'', ''{"not_a_switch": true}'', null)',
      'select public.admin_set_app_control(''web'', ''{"bidding": "yes"}'', null)',
      'select public.admin_set_app_control(''web'', ''{"min_version": "one.two"}'', null)',
      'select public.admin_set_app_control(''web'', ''{"banner_level": "loud"}'', null)',
      'select public.admin_set_app_control(''web'', ''{"banner_link": "http://insecure.example"}'', null)',
      'select public.admin_set_app_control(''web'', ''{"banner_ends_at": "not a date"}'', null)',
      'select public.admin_set_app_control(''web'', ''[1]'', null)',
      'select public.admin_set_app_control(null, ''{}'', null)'
    ]) as sql
  loop
    if v_err is null then raise exception 'FAIL: a bad control change was accepted'; end if;
  end loop;

  -- text is trimmed, blank clears, a banner can end
  v_cfg := public.admin_set_app_control('web', '{"banner_text": "  Hello  ", "banner_ends_at": "2999-01-01T00:00:00Z", "min_version": "2.1"}', null);
  if v_cfg ->> 'banner_text' is distinct from 'Hello' then raise exception 'FAIL: banner text was not stored trimmed (%)', v_cfg; end if;
  if public.get_app_controls('web', '2.0.9') ->> 'banner_text' is distinct from 'Hello'
     or not (public.get_app_controls('web', '2.0.9') ->> 'update_required')::boolean then
    raise exception 'FAIL: banner text or minimum version did not come through';
  end if;
  v_cfg := public.admin_set_app_control('web', '{"banner_text": "   ", "min_version": null, "banner_ends_at": null}', null);
  if v_cfg -> 'banner_text' is distinct from 'null'::jsonb or v_cfg -> 'min_version' is distinct from 'null'::jsonb then
    raise exception 'FAIL: blank text did not clear (%)', v_cfg;
  end if;

  -- ---- the audit trail ------------------------------------------------------
  perform pg_temp.as_owner();
  select count(*) into v_n from public.admin_audit_log
   where action = 'app_control_changed' and target_id = 'app_controls:web' and actor = v_finance
     and detail like 'reason: Razorpay X down%' and detail like '%withdrawals: true -> false%';
  if v_n <> 1 then raise exception 'FAIL: the finance change is not in the audit log exactly once (%)', v_n; end if;
  select count(*) into v_n from public.admin_audit_log
   where action = 'app_control_changed' and actor = v_full and detail like 'reason: planned work%bidding: true -> false%';
  if v_n <> 1 then raise exception 'FAIL: the full admin change is not in the audit log exactly once (%)', v_n; end if;

  -- a no-op writes nothing
  select count(*) into v_before from public.admin_audit_log where action = 'app_control_changed';
  perform pg_temp.become(v_full, 'aal2');
  perform public.admin_set_app_control('web', '{"bidding": false}', 'same again');
  perform pg_temp.as_owner();
  select count(*) into v_n from public.admin_audit_log where action = 'app_control_changed';
  if v_n <> v_before then raise exception 'FAIL: a change that changed nothing was logged'; end if;
  -- ... and a refused change writes nothing either
  perform pg_temp.become(v_support);
  perform pg_temp.try('select public.admin_set_app_control(''web'', ''{"bidding": true}'', null)');
  perform pg_temp.as_owner();
  select count(*) into v_n from public.admin_audit_log where action = 'app_control_changed';
  if v_n <> v_before then raise exception 'FAIL: a refused change was logged'; end if;

  -- ---- the table is readable by admins only ---------------------------------
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_controls' and cmd = 'SELECT' and qual like '%is_admin%') then
    raise exception 'FAIL: the controls table is not limited to admins by a row-level-security policy';
  end if;
  perform pg_temp.become(v_person);
  -- ... but everyone gets the merged answer
  if public.get_app_controls('web', null) is null then raise exception 'FAIL: get_app_controls returned nothing'; end if;
  perform pg_temp.become(v_support);
  select count(*) into v_n from public.app_controls;
  if v_n <> 4 then raise exception 'FAIL: an admin cannot read the controls table (%)', v_n; end if;

  -- ---- devices --------------------------------------------------------------
  perform pg_temp.become(v_person);
  perform public.record_device('install-abcdef12', 'android', '1.0.0', 'Android 15', false);
  perform public.record_device('install-abcdef12', 'android', '1.1.0', null, true); -- same install, newer app, push now on
  perform public.record_device('install-web-9999', 'web', '1.1.0', 'Chrome 140', false);
  select count(*) into v_n from public.app_devices where user_id = v_person;
  if v_n <> 2 then raise exception 'FAIL: expected two devices for one person, found %', v_n; end if;
  if not exists (select 1 from public.app_devices
                  where user_id = v_person and install_id = 'install-abcdef12'
                    and app_version = '1.1.0' and os_version = 'Android 15' and push_registered_at is not null) then
    raise exception 'FAIL: a repeat visit did not update the app version, keep the OS, or note push';
  end if;
  if pg_temp.try('select public.record_device(''x'', ''android'', null, null, false)') is null then
    raise exception 'FAIL: a short install id was accepted';
  end if;
  if pg_temp.try('select public.record_device(''install-abcdef12'', ''toaster'', null, null, false)') is null then
    raise exception 'FAIL: an unknown platform was accepted';
  end if;
  -- someone else sees none of it (one policy limits reads to the owner or staff, migration 122); staff see all
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'app_devices' and policyname = 'app_devices_read' and qual like '%auth.uid%' and qual like '%is_admin%') then
    raise exception 'FAIL: the devices table is not limited to its owner by a row-level-security policy';
  end if;
  perform pg_temp.become(v_support);
  select count(*) into v_n from public.app_devices where user_id = v_person;
  if v_n <> 2 then raise exception 'FAIL: staff cannot see devices (%)', v_n; end if;
  perform pg_temp.as_owner();
  if pg_temp.try('select public.record_device(''install-abcdef12'', ''android'', null, null, false)') is null then
    raise exception 'FAIL: a signed-out caller recorded a device';
  end if;

  raise notice 'app_controls: all assertions passed';
end;
$$;

rollback;
