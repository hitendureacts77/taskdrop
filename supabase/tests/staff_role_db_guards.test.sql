-- The database enforces staff roles on money writes (migration 100).
--
-- One transaction, rolled back, so no rows are left behind.
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/staff_role_db_guards.test.sql
-- (or: supabase db query --linked -f supabase/tests/staff_role_db_guards.test.sql)
-- The test session is postgres, so each login is faked with request.jwt.claims and
-- role = authenticated, the way PostgREST does it.

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
  v_viewer  uuid := gen_random_uuid();
  v_worker  uuid := gen_random_uuid();
  v_poster  uuid := gen_random_uuid();
  v_payout  uuid;
  v_task    uuid;
  v_who     uuid;
  v_err     text;
  v_row     public.payouts;
  v_method  jsonb;
  v_staff   constant text := '%staff role%';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'dbguards+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_finance), (v_support), (v_viewer), (v_worker), (v_poster)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'G Full'), (v_finance, 'G Finance'), (v_support, 'G Support'),
         (v_viewer, 'G Viewer'), (v_worker, 'G Worker'), (v_poster, 'G Poster')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_finance, v_support, v_viewer]) u on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role)
  values (v_finance, 'finance'), (v_support, 'support'), (v_viewer, 'viewer');
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';
  select value into v_method from public.settings where key = 'payout_method';

  insert into public.wallets (user_id, balance_minor) values (v_worker, 0), (v_poster, 0)
  on conflict (user_id) do update set balance_minor = 0;
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_worker, 1000, 'requested', 'guard@upi') returning id into v_payout;
  -- not disputed: the dispute call must get past the guard and stop at "not disputed"
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'db guard job', 10000, 60) returning id into v_task;

  -- ---- Support and Viewer are refused on all three, before anything is touched ----------
  foreach v_who in array array[v_support, v_viewer] loop
    perform pg_temp.become(v_who);
    v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''paid'', ''x'')', v_payout));
    if coalesce(v_err, '') not like v_staff then raise exception 'FAIL: a support/viewer login marked a payout (%)', v_err; end if;
    v_err := pg_temp.try(format('select public.admin_resolve_dispute(%L, ''worker'', ''x'')', v_task));
    if coalesce(v_err, '') not like v_staff then raise exception 'FAIL: a support/viewer login decided a dispute (%)', v_err; end if;
    v_err := pg_temp.try('select public.admin_set_payout_method(''razorpayx'')');
    if coalesce(v_err, '') not like v_staff then raise exception 'FAIL: a support/viewer login changed the payout method (%)', v_err; end if;
  end loop;
  perform pg_temp.as_owner();
  if (select status from public.payouts where id = v_payout) <> 'requested' then raise exception 'FAIL: a refused call still moved the payout'; end if;
  if (select value from public.settings where key = 'payout_method') is distinct from v_method then raise exception 'FAIL: a refused call still changed the payout method'; end if;

  -- ---- money staff without the authenticator code is refused -----------------------------
  foreach v_who in array array[v_full, v_finance] loop
    perform pg_temp.become(v_who, 'aal1');
    v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''paid'', ''x'')', v_payout));
    if coalesce(v_err, '') not like '%authenticator%' then raise exception 'FAIL: marked a payout without the code (%)', v_err; end if;
    v_err := pg_temp.try(format('select public.admin_resolve_dispute(%L, ''worker'', ''x'')', v_task));
    if coalesce(v_err, '') not like '%authenticator%' then raise exception 'FAIL: decided a dispute without the code (%)', v_err; end if;
    v_err := pg_temp.try('select public.admin_set_payout_method(''manual'')');
    if coalesce(v_err, '') not like '%authenticator%' then raise exception 'FAIL: changed the payout method without the code (%)', v_err; end if;
  end loop;

  -- ---- Finance and a full admin get through the guard (payouts, disputes) -------------------
  perform pg_temp.become(v_finance);
  v_err := pg_temp.try(format('select public.admin_resolve_dispute(%L, ''worker'', ''x'')', v_task));
  if coalesce(v_err, '') not like '%not disputed%' then raise exception 'FAIL: finance did not reach the dispute rules (%)', v_err; end if;
  v_row := public.admin_mark_payout(v_payout, 'processing', 'guard test');
  if v_row.status <> 'processing' then raise exception 'FAIL: finance could not mark a payout (%)', v_row.status; end if;
  -- the payout method is a setting, and the settings table (089) is full-admin only
  v_err := pg_temp.try('select public.admin_set_payout_method(''manual'')');
  if coalesce(v_err, '') not like '%full admin%' then raise exception 'FAIL: finance changed a setting (%)', v_err; end if;

  perform pg_temp.become(v_full);
  v_err := pg_temp.try(format('select public.admin_resolve_dispute(%L, ''poster'', ''x'')', v_task));
  if coalesce(v_err, '') not like '%not disputed%' then raise exception 'FAIL: a full admin did not reach the dispute rules (%)', v_err; end if;
  v_row := public.admin_mark_payout(v_payout, 'failed', 'guard test failed');
  if v_row.status <> 'failed' then raise exception 'FAIL: a full admin could not mark a payout (%)', v_row.status; end if;
  if public.admin_set_payout_method('manual') <> 'manual' then raise exception 'FAIL: a full admin could not set the payout method'; end if;

  -- A plain, non-staff user cannot be tested here: session_user is postgres, so
  -- private.is_admin() is always true. That case is covered by the live test with real logins.

  raise notice 'staff_role_db_guards: all assertions passed';
end;
$$;

rollback;
