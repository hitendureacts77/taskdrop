-- public.check_money_staff() (migration 147): the question the refund and payout functions ask the caller.
--
-- One transaction, rolled back, so no rows are left behind.
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/check_money_staff.test.sql

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
  v_poster  uuid := gen_random_uuid();
  v_err     text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'moneystaff+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_finance), (v_support), (v_viewer), (v_poster)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'M Full'), (v_finance, 'M Finance'), (v_support, 'M Support'), (v_viewer, 'M Viewer'), (v_poster, 'M Poster')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_finance, v_support, v_viewer]) u on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role)
  values (v_finance, 'finance'), (v_support, 'support'), (v_viewer, 'viewer');
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';

  -- ---- who may: money staff with the authenticator code ----------------------------
  perform pg_temp.become(v_full);
  if public.check_money_staff() <> v_full then raise exception 'FAIL: a full admin with the code was not let through'; end if;
  perform pg_temp.become(v_finance);
  if public.check_money_staff() <> v_finance then raise exception 'FAIL: finance with the code was not let through'; end if;

  -- ---- who may not -----------------------------------------------------------------
  perform pg_temp.become(v_support);
  v_err := pg_temp.try('select public.check_money_staff()');
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: support passed the money check (%)', v_err; end if;
  perform pg_temp.become(v_viewer);
  v_err := pg_temp.try('select public.check_money_staff()');
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: a viewer passed the money check (%)', v_err; end if;
  perform pg_temp.become(v_full, 'aal1');
  v_err := pg_temp.try('select public.check_money_staff()');
  if coalesce(v_err, '') not like '%authenticator%' then raise exception 'FAIL: a full admin passed without the code (%)', v_err; end if;
  perform pg_temp.become(v_poster);
  v_err := pg_temp.try('select public.check_money_staff()');
  -- Refused by the admin check on a real connection; the test harness runs as postgres, which that check
  -- trusts, so here the role rule refuses them instead. Either way they do not pass.
  if coalesce(v_err, '') not like '%Admins only%' and coalesce(v_err, '') not like '%staff role%' then
    raise exception 'FAIL: an ordinary person passed the money check (%)', v_err;
  end if;

  -- ---- the grant: signed-in only, never signed out ---------------------------------
  perform pg_temp.as_owner();
  if has_function_privilege('anon', 'public.check_money_staff()', 'execute') then
    raise exception 'FAIL: anon can run check_money_staff';
  end if;
  if not has_function_privilege('authenticated', 'public.check_money_staff()', 'execute') then
    raise exception 'FAIL: authenticated lost check_money_staff';
  end if;

  raise notice 'check_money_staff: all assertions passed';
end;
$$;

rollback;
