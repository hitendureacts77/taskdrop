-- Admin cancel-with-refund and stop-promotion (migration 098).
--
-- One transaction, rolled back, so no rows are left behind.
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_cancel_pause.test.sql
-- (or: supabase db query --linked -f supabase/tests/admin_cancel_pause.test.sql)
-- The test session is postgres, for which private.is_admin() is true, so the
-- "not an admin" case cannot be asserted here; staff-role and MFA cases can.

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
  v_poster  uuid := gen_random_uuid();
  v_task    uuid;
  v_started uuid;
  v_promo   uuid;
  v_pay     uuid;
  v_before  bigint;
  v_after   bigint;
  v_err     text;
  v_row     public.tasks;
  v_prow    public.task_promotions;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'cancel+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_finance), (v_support), (v_poster)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'X Full'), (v_finance, 'X Finance'), (v_support, 'X Support'), (v_poster, 'X Poster')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_finance, v_support]) u on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role) values (v_finance, 'finance'), (v_support, 'support');
  update public.settings set value = 'true'::jsonb where key = 'admin_require_mfa';
  insert into public.wallets (user_id, balance_minor) values (v_poster, 0)
  on conflict (user_id) do update set balance_minor = 0;

  -- a wallet-funded open task, and one whose work has started
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'cancel test job', 10000, 60) returning id into v_task;
  update public.tasks set funded_at = now(), funded_via = 'wallet', funded_minor = 10300 where id = v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, status)
  values (v_poster, 'services', 'already started job', 10000, 60, 'TASK_STARTED') returning id into v_started;

  -- ---- who may: money staff with the authenticator code ----------------------------
  perform pg_temp.become(v_support);
  v_err := pg_temp.try(format('select public.admin_cancel_task_with_refund(%L, ''test'')', v_task));
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: support cancelled a task (%)', v_err; end if;
  perform pg_temp.become(v_full, 'aal1');
  v_err := pg_temp.try(format('select public.admin_cancel_task_with_refund(%L, ''test'')', v_task));
  if coalesce(v_err, '') not like '%authenticator%' then raise exception 'FAIL: cancelled without the authenticator code (%)', v_err; end if;
  perform pg_temp.become(v_full);
  v_err := pg_temp.try(format('select public.admin_cancel_task_with_refund(%L, ''  '')', v_task));
  if coalesce(v_err, '') not like '%why%' then raise exception 'FAIL: cancelled without a reason (%)', v_err; end if;
  v_err := pg_temp.try(format('select public.admin_cancel_task_with_refund(%L, ''too late'')', v_started));
  if coalesce(v_err, '') not like '%already started%' then raise exception 'FAIL: cancelled a task whose work had started (%)', v_err; end if;

  -- ---- cancel: wallet refunded, task closed, audited -------------------------------
  perform pg_temp.as_owner();
  select balance_minor into v_before from public.wallets where user_id = v_poster;
  perform pg_temp.become(v_finance);
  v_row := public.admin_cancel_task_with_refund(v_task, 'poster asked on support chat');
  if v_row.status <> 'CANCELLED' then raise exception 'FAIL: task is % after cancel', v_row.status; end if;
  perform pg_temp.as_owner();
  select balance_minor into v_after from public.wallets where user_id = v_poster;
  if v_after - v_before <> 10300 then raise exception 'FAIL: expected 10300 refunded, wallet moved by %', v_after - v_before; end if;
  if (select wallet_refunded_at is null from public.tasks where id = v_task) then raise exception 'FAIL: refund not stamped'; end if;
  if not exists (select 1 from public.admin_audit_log where action = 'cancel_task_with_refund' and target_id = v_task::text) then
    raise exception 'FAIL: the cancel left no audit row';
  end if;
  if not exists (select 1 from public.notifications where user_id = v_poster and kind = 'admin_cancelled') then
    raise exception 'FAIL: the poster was not told';
  end if;
  perform pg_temp.become(v_full);
  v_err := pg_temp.try(format('select public.admin_cancel_task_with_refund(%L, ''again'')', v_task));
  if coalesce(v_err, '') not like '%already closed%' then raise exception 'FAIL: cancelled twice (%)', v_err; end if;

  -- ---- stop a promotion: unspent budget back to the wallet ---------------------------
  perform pg_temp.as_owner();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'promoted job', 10000, 60) returning id into v_task;
  insert into public.payments (user_id, purpose, amount_minor, status, paid_at)
  values (v_poster, 'topup', 20000, 'paid', now()) returning id into v_pay;
  insert into public.task_promotions (task_id, user_id, amount_minor, days, status, payment_id, starts_at, ends_at)
  values (v_task, v_poster, 20000, 5, 'active', v_pay, now(), now() + interval '5 days') returning id into v_promo;
  select balance_minor into v_before from public.wallets where user_id = v_poster;

  perform pg_temp.become(v_support);
  v_err := pg_temp.try(format('select public.admin_pause_promotion(%L, ''test'')', v_promo));
  if coalesce(v_err, '') not like '%staff role%' then raise exception 'FAIL: support stopped a promotion (%)', v_err; end if;
  perform pg_temp.become(v_finance, 'aal1');
  v_err := pg_temp.try(format('select public.admin_pause_promotion(%L, ''test'')', v_promo));
  if coalesce(v_err, '') not like '%authenticator%' then raise exception 'FAIL: stopped a promotion without the code (%)', v_err; end if;
  perform pg_temp.become(v_finance);
  v_prow := public.admin_pause_promotion(v_promo, 'misleading ad');
  if v_prow.status <> 'cancelled' then raise exception 'FAIL: promotion is % after stopping', v_prow.status; end if;
  perform pg_temp.as_owner();
  select balance_minor into v_after from public.wallets where user_id = v_poster;
  if v_after - v_before <= 0 then raise exception 'FAIL: nothing was refunded for an unused promotion'; end if;
  if not exists (select 1 from public.admin_audit_log where action = 'pause_promotion' and target_id = v_promo::text) then
    raise exception 'FAIL: stopping left no audit row';
  end if;
  perform pg_temp.become(v_finance);
  v_err := pg_temp.try(format('select public.admin_pause_promotion(%L, ''again'')', v_promo));
  if coalesce(v_err, '') not like '%already finished%' then raise exception 'FAIL: stopped a finished promotion (%)', v_err; end if;

  raise notice 'admin_cancel_pause: all assertions passed';
end;
$$;

rollback;
