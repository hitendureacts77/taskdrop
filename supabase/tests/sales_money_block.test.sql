-- Sales cannot read company money or settings (migration 099).
--
-- One transaction, rolled back, so no rows are left behind.
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sales_money_block.test.sql
-- (or: supabase db query --linked -f supabase/tests/sales_money_block.test.sql)
--
-- The test session is postgres, for which private.is_admin() is true, so every
-- admin-visible row is visible unless the Sales restriction hides it. That makes
-- row visibility testable here: the same query is run as a full admin and as Sales.

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

-- how many rows a query returns, as whoever the session currently is
create or replace function pg_temp.n(p_sql text) returns bigint
language plpgsql as $$
declare v bigint;
begin
  execute 'select count(*) from (' || p_sql || ') q' into v;
  return v;
end;
$$;

do $$
declare
  v_full    uuid := gen_random_uuid();
  v_support uuid := gen_random_uuid();
  v_sales   uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_task    uuid;
  v_err     text;
  v_blocked constant text := '%does not include company money%';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'salesblock+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_full), (v_support), (v_sales), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_full, 'S Full'), (v_support, 'S Support'), (v_sales, 'S Sales'), (v_other, 'S Other')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  select u, 'admin' from unnest(array[v_full, v_support, v_sales]) u on conflict do nothing;
  insert into public.admin_staff (user_id, staff_role) values (v_support, 'support'), (v_sales, 'sales');

  -- money belonging to someone else, and to the Sales login itself
  insert into public.wallets (user_id, balance_minor) values (v_other, 5000), (v_sales, 700)
  on conflict (user_id) do update set balance_minor = excluded.balance_minor;
  insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason)
  values (v_other, 100, 4900, 0, 'test fix'), (v_sales, 50, 650, 0, 'own fix');
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (v_other, 1000, 'requested', 'other@upi'), (v_sales, 200, 'requested', 'sales@upi');
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_other, 'services', 'sales block job', 10000, 60) returning id into v_task;
  insert into public.platform_ledger (task_id, kind, amount_minor, note) values (v_task, 'worker_commission', 600, 'test');
  insert into public.admin_live_events (kind, record_type, summary)
  values ('withdrawal_requested', 'payout', '{"who":"X"}'), ('signup', 'profile', '{"who":"Y"}'),
         ('task_status', 'task', '{"to":"DISPUTED"}'), ('task_status', 'task', '{"to":"COMPLETED"}');
  perform pg_temp.become(v_full);
  perform public.admin_log_event('sales_block_test', v_task::text, 'a row for the audit log');

  -- ---- the same reads as a full admin: everything is there -----------------------------
  perform pg_temp.as_owner();
  perform pg_temp.become(v_full);
  if pg_temp.n(format('select 1 from public.wallets where user_id = %L', v_other)) <> 1 then raise exception 'FAIL: admin cannot see a wallet'; end if;
  if pg_temp.n('select 1 from public.platform_ledger') < 1 then raise exception 'FAIL: admin cannot see the ledger'; end if;
  if pg_temp.n(format('select 1 from public.payouts where user_id = %L', v_other)) <> 1 then raise exception 'FAIL: admin cannot see a payout'; end if;
  if pg_temp.n('select 1 from public.admin_audit_log') < 1 then raise exception 'FAIL: admin cannot see the audit log'; end if;
  if pg_temp.n(format('select 1 from public.admin_staff where user_id = %L', v_sales)) <> 1 then raise exception 'FAIL: admin cannot see the team'; end if;
  if pg_temp.n('select 1 from public.admin_live_events where kind = ''withdrawal_requested''') < 1 then raise exception 'FAIL: admin cannot see money events'; end if;
  perform * from public.admin_payout_queue();
  perform public.platform_earnings();

  -- Support is not Sales: the restriction must not reach it.
  perform pg_temp.as_owner();
  perform pg_temp.become(v_support);
  if pg_temp.n('select 1 from public.platform_ledger') < 1 then raise exception 'FAIL: support lost the ledger'; end if;
  if pg_temp.n(format('select 1 from public.wallets where user_id = %L', v_other)) <> 1 then raise exception 'FAIL: support lost a wallet'; end if;

  -- ---- Sales: other people's money and the settings are closed -------------------------
  perform pg_temp.as_owner();
  perform pg_temp.become(v_sales);
  if not private.is_money_blind() then raise exception 'FAIL: a sales login is not money-blind'; end if;
  if pg_temp.n(format('select 1 from public.wallets where user_id = %L', v_other)) <> 0 then raise exception 'FAIL: sales can read someone else''s wallet'; end if;
  if pg_temp.n(format('select 1 from public.wallet_adjustments where user_id = %L', v_other)) <> 0 then raise exception 'FAIL: sales can read someone else''s wallet corrections'; end if;
  if pg_temp.n(format('select 1 from public.payouts where user_id = %L', v_other)) <> 0 then raise exception 'FAIL: sales can read someone else''s payout'; end if;
  if pg_temp.n('select 1 from public.platform_ledger') <> 0 then raise exception 'FAIL: sales can read the company ledger'; end if;
  if pg_temp.n('select 1 from public.admin_audit_log') <> 0 then raise exception 'FAIL: sales can read the audit log'; end if;
  if pg_temp.n('select 1 from public.admin_alerts') <> 0 then raise exception 'FAIL: sales can read staff alerts'; end if;
  if pg_temp.n('select 1 from public.app_controls') <> 0 then raise exception 'FAIL: sales can read the app controls'; end if;
  if pg_temp.n('select 1 from public.crm_rules') <> 0 then raise exception 'FAIL: sales can read the automation rules'; end if;
  if pg_temp.n(format('select 1 from public.admin_staff where user_id <> %L', v_sales)) <> 0 then raise exception 'FAIL: sales can read the rest of the team'; end if;
  if pg_temp.n('select 1 from public.admin_live_events where kind in (''withdrawal_requested'', ''payout_status'', ''wallet_adjustment'')') <> 0 then raise exception 'FAIL: sales can read money events'; end if;
  if pg_temp.n('select 1 from public.admin_live_events where kind = ''task_status'' and summary ->> ''to'' = ''DISPUTED''') <> 0 then raise exception 'FAIL: sales can read dispute events'; end if;

  -- ---- Sales: what they are meant to keep ---------------------------------------------------
  if pg_temp.n(format('select 1 from public.wallets where user_id = %L', v_sales)) <> 1 then raise exception 'FAIL: sales lost their own wallet'; end if;
  if pg_temp.n(format('select 1 from public.payouts where user_id = %L', v_sales)) <> 1 then raise exception 'FAIL: sales lost their own payout'; end if;
  if pg_temp.n(format('select 1 from public.wallet_adjustments where user_id = %L', v_sales)) <> 1 then raise exception 'FAIL: sales lost their own wallet corrections'; end if;
  if pg_temp.n(format('select 1 from public.admin_staff where user_id = %L', v_sales)) <> 1 then raise exception 'FAIL: sales lost their own staff row'; end if;
  if pg_temp.n('select 1 from public.admin_live_events where kind = ''signup''') < 1 then raise exception 'FAIL: sales lost ordinary events'; end if;
  if pg_temp.n('select 1 from public.admin_live_events where kind = ''task_status'' and summary ->> ''to'' = ''COMPLETED''') < 1 then raise exception 'FAIL: sales lost ordinary job events'; end if;
  if pg_temp.n(format('select 1 from public.tasks where id = %L', v_task)) <> 1 then raise exception 'FAIL: sales lost the jobs'; end if;
  if pg_temp.n(format('select 1 from public.profiles where id = %L', v_other)) <> 1 then raise exception 'FAIL: sales lost the people'; end if;
  perform public.crm_add_lead('Sales Block Cafe', '+91 90000 00001', 'business', 'test', 'still works', null);

  -- ---- Sales: the money functions refuse ---------------------------------------------------
  v_err := pg_temp.try('select * from public.admin_payout_queue()');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read the payout queue (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.admin_earnings_daily(current_date - 30)');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read daily earnings (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.admin_money_position()');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read the money position (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.platform_earnings()');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read platform earnings (%)', v_err; end if;
  v_err := pg_temp.try('select public.platform_stats(7)');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read platform stats (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.admin_business_daily(current_date - 7, current_date)');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read business figures (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.admin_funnel(current_date - 7, current_date)');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read the funnel (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.admin_retention(8)');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read retention (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.admin_promotion_roi(current_date - 7, current_date)');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read promotion returns (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.admin_reconcile(current_date - 7, current_date)');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read the reconciliation (%)', v_err; end if;
  v_err := pg_temp.try('select * from public.admin_reconciliation_runs(5)');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read reconciliation runs (%)', v_err; end if;
  v_err := pg_temp.try(format('select public.escrow_refund_due(%L)', v_task));
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales read what a refund is due (%)', v_err; end if;
  v_err := pg_temp.try(format('select public.admin_mark_payout(%L, ''paid'', ''x'')', gen_random_uuid()));
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales marked a payout (%)', v_err; end if;
  v_err := pg_temp.try(format('select public.admin_resolve_dispute(%L, ''worker'', ''x'')', v_task));
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales decided a dispute (%)', v_err; end if;
  v_err := pg_temp.try('select public.admin_set_payout_method(''manual'')');
  if coalesce(v_err, '') not like v_blocked then raise exception 'FAIL: sales changed the payout method (%)', v_err; end if;

  raise notice 'sales_money_block: all assertions passed';
end;
$$;

rollback;
