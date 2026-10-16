-- Staff roles (migration 089): what finance, support and viewer admins may
-- change, enforced in the database, and who gets staff alerts.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staff_roles.test.sql

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

-- true when refused at all (direct table writes may stop at grants or RLS first).
create or replace function pg_temp.refused(p_sql text) returns boolean
language plpgsql as $$
begin
  return pg_temp.try(p_sql) is not null;
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
  v_full2   uuid := gen_random_uuid();
  v_finance uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_viewer  uuid := gen_random_uuid();
  v_person  uuid := gen_random_uuid();
  v_payout  uuid;
  v_err     text;
  v_n       int;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'staff+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_full2), (v_finance), (v_support), (v_viewer), (v_person)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'Staff Full'), (v_full2, 'Staff Full Two'), (v_finance, 'Staff Finance'),
         (v_support, 'Staff Support'), (v_viewer, 'Staff Viewer'), (v_person, 'Staff Person')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_full2, v_finance, v_support, v_viewer]) u
  on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role, notify) values
    (v_finance, 'finance', true), (v_support, 'support', true), (v_viewer, 'viewer', true),
    (v_full2, 'admin', false);
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  -- ---- viewer: reads, never writes -----------------------------------------
  perform pg_temp.become(v_viewer);
  if not pg_temp.role_refused('update public.settings set value = value where key = ''review_window_days''') then
    raise exception 'FAIL: a viewer changed a setting';
  end if;
  if not pg_temp.role_refused(format('select public.crm_add_note(%L, ''note'', null)', v_person)) then
    raise exception 'FAIL: a viewer wrote a CRM note';
  end if;
  if not pg_temp.role_refused(format('select public.admin_set_admin(%L, true)', v_person)) then
    raise exception 'FAIL: a viewer granted admin';
  end if;
  if not pg_temp.refused(format(
       'insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason) values (%L, 100, 0, 0, ''x'')', v_person)) then
    raise exception 'FAIL: a viewer changed someone''s wallet';
  end if;
  select count(*) into v_n from public.settings; -- reading still works
  if v_n = 0 then raise exception 'FAIL: a viewer could not read settings'; end if;
  -- their own alerts, without an authenticator code
  perform pg_temp.become(v_viewer, 'aal1');
  perform public.admin_set_staff(v_viewer, 'viewer', false);
  if (select notify from public.admin_staff where user_id = v_viewer) then
    raise exception 'FAIL: a viewer could not switch their own alerts off';
  end if;
  -- but never their own role
  v_err := pg_temp.try(format('select public.admin_set_staff(%L, ''admin'')', v_viewer));
  if coalesce(v_err, '') not like '%own staff role%' then
    raise exception 'FAIL: a viewer promoted themselves (%)', v_err;
  end if;

  -- ---- finance: money yes, people and settings no ---------------------------
  perform pg_temp.become(v_finance);
  v_err := pg_temp.try(format(
    'insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason) values (%L, 100, 0, 0, ''finance test'')', v_person));
  if v_err like '%staff role%' then raise exception 'FAIL: finance was refused a wallet change'; end if;
  if not pg_temp.role_refused(format('select public.crm_add_note(%L, ''note'', null)', v_person)) then
    raise exception 'FAIL: finance wrote a CRM note';
  end if;
  if not pg_temp.role_refused('update public.settings set value = value where key = ''review_window_days''') then
    raise exception 'FAIL: finance changed a setting';
  end if;

  -- ---- support: people yes, money no ----------------------------------------
  perform pg_temp.become(v_support);
  perform public.crm_add_note(v_person, 'support can write notes', null);
  if not pg_temp.refused(format(
       'insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason) values (%L, 100, 0, 0, ''x'')', v_person)) then
    raise exception 'FAIL: support changed someone''s wallet';
  end if;

  -- ---- a payout, through the panel's own function: finance yes, support no --
  perform pg_temp.as_owner();
  insert into public.payouts (user_id, amount_minor, destination, status)
  values (v_person, 10000, 'staff.test@upi', 'requested')
  returning id into v_payout;
  perform pg_temp.become(v_support);
  if not pg_temp.role_refused(format('select public.admin_mark_payout(%L, ''processing'', null)', v_payout)) then
    raise exception 'FAIL: support moved a payout';
  end if;
  perform pg_temp.become(v_finance);
  perform public.admin_mark_payout(v_payout, 'processing', null);
  if (select status::text from public.payouts where id = v_payout) <> 'processing' then
    raise exception 'FAIL: finance could not move a payout';
  end if;

  -- ---- full admin: everything, including staff roles (with a code) ----------
  perform pg_temp.become(v_full, 'aal1');
  v_err := pg_temp.try(format('select public.admin_set_staff(%L, ''support'')', v_finance));
  if coalesce(v_err, '') not like '%authenticator code%' then
    raise exception 'FAIL: a staff role changed without an authenticator code (%)', v_err;
  end if;
  perform pg_temp.become(v_full);
  perform public.admin_set_staff(v_finance, 'support');
  if (select staff_role from public.admin_staff where user_id = v_finance) <> 'support' then raise exception 'FAIL: a full admin could not change a role'; end if;
  perform public.admin_set_staff(v_finance, 'finance');
  update public.settings set value = value where key = 'review_window_days';

  -- never the last full admin: make every other admin (real ones too -- this is
  -- rolled back) a viewer, then try to demote v_full from the operator's seat.
  perform pg_temp.as_owner();
  insert into public.admin_staff (user_id, staff_role)
  select ur.user_id, 'viewer' from public.user_roles ur where ur.role = 'admin' and ur.user_id <> v_full
  on conflict (user_id) do update set staff_role = 'viewer';
  v_err := pg_temp.try(format('select public.admin_set_staff(%L, ''viewer'')', v_full));
  if coalesce(v_err, '') not like '%last full admin%' then
    raise exception 'FAIL: the last full admin was demoted (%)', v_err;
  end if;
  update public.admin_staff set staff_role = 'admin' where user_id = v_full2;
  update public.admin_staff set staff_role = 'support' where user_id = v_support;
  update public.admin_staff set staff_role = 'finance' where user_id = v_finance;

  -- removing admin clears the staff row
  delete from public.user_roles where user_id = v_viewer and role = 'admin';
  if exists (select 1 from public.admin_staff where user_id = v_viewer) then
    raise exception 'FAIL: the staff row outlived the admin role';
  end if;

  -- ---- alerts: a help request reaches full admins and support with alerts on --
  insert into public.support_tickets (user_id, category, subject)
  values (v_person, 'other', 'Staff alert test');
  if not exists (select 1 from public.notifications where user_id = v_full and title = 'New help request') then
    raise exception 'FAIL: a full admin got no help-request alert';
  end if;
  if not exists (select 1 from public.notifications where user_id = v_support and title = 'New help request') then
    raise exception 'FAIL: support got no help-request alert';
  end if;
  if exists (select 1 from public.notifications where user_id in (v_finance, v_full2) and title = 'New help request') then
    raise exception 'FAIL: finance, or someone with alerts off, got a help-request alert';
  end if;

  -- ---- nobody writes admin_staff directly ------------------------------------
  -- (Reading is admin-only by RLS, private.is_admin(); a psql session as
  -- postgres counts as an operator there, so that can't be asserted here.)
  perform pg_temp.as_owner();
  if has_table_privilege('authenticated', 'public.admin_staff', 'INSERT')
     or has_table_privilege('authenticated', 'public.admin_staff', 'UPDATE')
     or has_table_privilege('anon', 'public.admin_staff', 'SELECT') then
    raise exception 'FAIL: admin_staff can be written directly, or read signed out';
  end if;

  raise notice 'staff_roles: all assertions passed';
end;
$$;

rollback;
