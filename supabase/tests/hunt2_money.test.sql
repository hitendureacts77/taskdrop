-- Money and job-flow guards from security hunt 2.14, rounds D and E (migration 148).
--
-- H51 a quote at or below zero is refused by the database, and lock_bid refuses one too.
-- H53 a card-paid job a helper backed out of cannot hire a dearer quote on the old
--     money; a wallet-paid job is charged the difference; payouts never pass what was paid in.
-- H54 a helper who backed out cannot start the job the poster gave to someone else.
-- B20 a poster cannot report a problem before the work is sent.
--
-- Uses the seed people Asha (poster), Ravi and Meera (helpers) and rows it makes itself.
-- One transaction, rolled back, so no rows are left behind.
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/hunt2_money.test.sql

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

-- A job hired and paid by card, the way the payment webhook leaves it: Asha posted it,
-- p_worker is hired at p_price, the card paid p_paid. Returns the task id.
create or replace function pg_temp.card_job(p_worker uuid, p_price bigint, p_paid bigint,
                                            p_status text, p_assign text) returns uuid
language plpgsql as $$
declare
  v_task uuid; v_bid uuid; v_pay uuid;
  v_asha constant uuid := '5eed0000-0000-4000-8000-000000000001';
begin
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_asha, 'services', 'hunt2 card job', p_price, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, is_locked)
  values (v_task, p_worker, p_price, 240, true) returning id into v_bid;
  insert into public.payments (user_id, task_id, purpose, amount_minor, status, provider, paid_at)
  values (v_asha, v_task, 'escrow', p_paid, 'paid', 'seed', now()) returning id into v_pay;
  insert into public.assignments (task_id, bid_id, worker_id, status, escrow_minor, payout_mode)
  values (v_task, v_bid, p_worker, p_assign::public.assignment_status,
          round(p_price * (1 + private.setting_num('poster_service_fee_pct', 0.03))), 'one_time');
  update public.tasks
     set status = p_status::public.task_status, locked_bid_id = v_bid, locked_minor = p_price,
         payout_mode = 'one_time', funded_at = now(), funding_payment_id = v_pay, funded_via = 'payment'
   where id = v_task;
  return v_task;
end;
$$;

do $$
declare
  v_asha   constant uuid := '5eed0000-0000-4000-8000-000000000001';
  v_ravi   constant uuid := '5eed0000-0000-4000-8000-000000000002';
  v_meera  constant uuid := '5eed0000-0000-4000-8000-000000000003';
  v_admin  uuid := gen_random_uuid();
  v_fee    numeric := private.setting_num('poster_service_fee_pct', 0.03);
  v_cut    numeric := private.setting_num('worker_commission_pct', 0.20);
  v_task   uuid;
  v_bid    uuid;
  v_err    text;
  v_before bigint;
  v_after  bigint;
  v_paid   bigint;
begin
  -- The seed people exist in the seeded test database; make sure of it either way.
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'hunt2+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_asha), (v_ravi), (v_meera), (v_admin)) as u(id)
  on conflict (id) do nothing;
  insert into public.profiles (id, display_name)
  values (v_asha, 'Asha'), (v_ravi, 'Ravi'), (v_meera, 'Meera'), (v_admin, 'Hunt Admin')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;
  insert into public.wallets (user_id) values (v_asha), (v_ravi), (v_meera)
  on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_asha;
  -- A block between the three (left by another test run) would stop the offers below.
  delete from public.blocks
   where blocker_id in (v_asha, v_ravi, v_meera) and blocked_id in (v_asha, v_ravi, v_meera);

  -- ---- H51: a price at or below zero never gets in --------------------------------------------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_asha, 'services', 'hunt2 open job', 100000, 240) returning id into v_task;

  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, -100000, 60)',
    v_task, v_ravi));
  if v_err is null then raise exception 'FAIL H51: a quote of minus Rs 1,000 was stored'; end if;
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 0, 60)', v_task, v_ravi));
  if v_err is null then raise exception 'FAIL H51: a quote of zero was stored'; end if;
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 10000000001, 60)', v_task, v_ravi));
  if v_err is null then raise exception 'FAIL H51: a quote above the api limit was stored'; end if;
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 50000, -5)', v_task, v_ravi));
  if v_err is null then raise exception 'FAIL H51: a quote with minus 5 minutes was stored'; end if;

  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (%L, ''services'', ''hunt2 bad'', -100, 60)',
    v_asha));
  if v_err is null then raise exception 'FAIL H51: a task with a negative price was stored'; end if;
  v_err := pg_temp.try(format('update public.tasks set benchmark_minor = -1 where id = %L', v_task));
  if v_err is null and (select benchmark_minor from public.tasks where id = v_task) < 0 then
    raise exception 'FAIL H51: a task price was changed to below zero';
  end if;

  -- The second guard: even a bad row that got in by another way cannot be accepted.
  perform pg_temp.as_owner();
  alter table public.bids drop constraint bids_price_minor_range;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_ravi, -100000, 60) returning id into v_bid;
  perform pg_temp.become(v_asha);
  v_before := (select balance_minor from public.wallets where user_id = v_asha);
  v_err := pg_temp.try(format('select public.lock_bid(%L)', v_bid));
  if v_err is null then raise exception 'FAIL H51: lock_bid accepted a quote of minus Rs 1,000'; end if;
  if (select balance_minor from public.wallets where user_id = v_asha) <> v_before then
    raise exception 'FAIL H51: the wallet changed when a negative quote was refused';
  end if;
  perform pg_temp.as_owner();
  delete from public.bids where id = v_bid;
  alter table public.bids add constraint bids_price_minor_range
    check (price_minor > 0 and price_minor <= 10000000000);

  -- ---- H53: card-paid job, helper backs out, poster picks a dearer quote ----------------------
  v_task := pg_temp.card_job(v_ravi, 100000, round(100000 * (1 + v_fee))::bigint, 'LOCKED', 'assigned');

  perform pg_temp.become(v_ravi);
  perform public.cancel_task(v_task, 'hunt2');
  if (select status::text from public.tasks where id = v_task) <> 'OPEN' then
    raise exception 'FAIL setup: the task did not reopen after the helper backed out';
  end if;

  perform pg_temp.become(v_meera);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_meera, 400000, 240) returning id into v_bid;

  perform pg_temp.become(v_asha);
  v_before := (select balance_minor from public.wallets where user_id = v_asha);
  v_err := pg_temp.try(format('select public.lock_bid(%L)', v_bid));
  if v_err is null then
    raise exception 'FAIL H53: a quote four times what was paid by card was accepted with no new payment';
  end if;
  if v_err not like '%higher than what you paid%' then
    raise exception 'FAIL H53: refused for the wrong reason: %', v_err;
  end if;
  if (select balance_minor from public.wallets where user_id = v_asha) <> v_before
     or (select status::text from public.tasks where id = v_task) <> 'OPEN' then
    raise exception 'FAIL H53: a refused quote still changed the wallet or the task';
  end if;

  -- A quote within what was paid still works, with no new charge (the old behaviour).
  perform pg_temp.become(v_meera);
  update public.bids set price_minor = 90000 where id = v_bid;
  perform pg_temp.become(v_asha);
  perform public.lock_bid(v_bid);
  if (select status::text from public.tasks where id = v_task) <> 'LOCKED'
     or (select balance_minor from public.wallets where user_id = v_asha) <> v_before then
    raise exception 'FAIL H53: a cheaper quote on a card-paid job did not lock for free';
  end if;

  -- ---- H54: the helper who backed out cannot take the job back ---------------------------------
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format('select public.start_task(%L)', v_task));
  if v_err is null then
    raise exception 'FAIL H54: a helper who backed out started the job given to someone else';
  end if;
  perform pg_temp.become(v_meera);
  perform public.start_task(v_task);
  perform pg_temp.as_owner();
  if (select status::text from public.assignments where task_id = v_task and worker_id = v_meera) <> 'started'
     or (select status::text from public.assignments where task_id = v_task and worker_id = v_ravi) <> 'refunded' then
    raise exception 'FAIL H54: the chosen helper is not the one on the job';
  end if;

  -- ---- B20: no dispute before the work is sent -------------------------------------------------
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format('select public.open_dispute(%L, ''hunt2'')', v_task));
  if v_err is null then raise exception 'FAIL B20: the poster disputed a job with no work sent'; end if;
  if v_err not like '%cancel it instead%' then raise exception 'FAIL B20: wrong message: %', v_err; end if;

  -- The legitimate path pays exactly as before: proof, done, approve.
  perform pg_temp.become(v_meera);
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_meera, 'Finished the work exactly as agreed', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.as_owner();
  v_before := (select clearing_minor from public.wallets where user_id = v_meera);
  perform pg_temp.become(v_asha);
  perform public.confirm_release(v_task);
  perform pg_temp.as_owner();
  if (select clearing_minor from public.wallets where user_id = v_meera) - v_before
     <> round(90000 * (1 - v_cut))::bigint then
    raise exception 'FAIL: a fully paid job did not pay the helper the quote less the commission';
  end if;

  -- An OPEN job cannot be disputed either.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_asha, 'services', 'hunt2 open dispute', 100000, 240) returning id into v_task;
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format('select public.open_dispute(%L, ''hunt2'')', v_task));
  if v_err is null then raise exception 'FAIL B20: the poster disputed an OPEN job'; end if;

  -- The helper can still report a problem while the job is under way (as before).
  perform pg_temp.as_owner();
  v_task := pg_temp.card_job(v_meera, 100000, round(100000 * (1 + v_fee))::bigint, 'TASK_STARTED', 'started');
  perform pg_temp.become(v_meera);
  perform public.open_dispute(v_task, 'hunt2: the poster is not answering');
  if (select status::text from public.tasks where id = v_task) <> 'DISPUTED' then
    raise exception 'FAIL B20: the helper could no longer report a problem on a started job';
  end if;

  -- ---- H53: a wallet-paid job that is still marked paid is charged the difference ---------------
  perform pg_temp.as_owner();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_asha, 'services', 'hunt2 wallet job', 100000, 240) returning id into v_task;
  update public.tasks set funded_at = now(), funded_via = 'wallet',
                          funded_minor = round(100000 * (1 + v_fee))::bigint
   where id = v_task;
  perform pg_temp.become(v_meera);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_meera, 200000, 240) returning id into v_bid;
  perform pg_temp.become(v_asha);
  v_before := (select balance_minor from public.wallets where user_id = v_asha);
  perform public.lock_bid(v_bid);
  v_after := (select balance_minor from public.wallets where user_id = v_asha);
  if v_before - v_after <> round(200000 * (1 + v_fee))::bigint - round(100000 * (1 + v_fee))::bigint then
    raise exception 'FAIL H53: the wallet was charged %, not the difference', v_before - v_after;
  end if;
  if (select funded_minor from public.tasks where id = v_task) <> round(200000 * (1 + v_fee))::bigint then
    raise exception 'FAIL H53: the job does not record the full amount paid';
  end if;

  -- ---- H53: payouts never pass what was paid in (a job left short by the old code) -------------
  perform pg_temp.as_owner();
  v_paid := round(100000 * (1 + v_fee))::bigint;
  v_task := pg_temp.card_job(v_meera, 400000, v_paid, 'WORK_DONE', 'started');
  v_before := (select clearing_minor from public.wallets where user_id = v_meera);
  perform pg_temp.become(v_asha);
  perform public.confirm_release(v_task);
  perform pg_temp.as_owner();
  v_after := (select clearing_minor from public.wallets where user_id = v_meera);
  if v_after - v_before > v_paid then
    raise exception 'FAIL H53: approving paid the helper % for % paid in', v_after - v_before, v_paid;
  end if;

  v_task := pg_temp.card_job(v_meera, 400000, v_paid, 'DISPUTED', 'started');
  v_before := (select balance_minor + clearing_minor from public.wallets where user_id = v_meera);
  perform pg_temp.become(v_admin);
  perform public.admin_resolve_dispute(v_task, 'worker', 'hunt2 cap');
  perform pg_temp.as_owner();
  v_after := (select balance_minor + clearing_minor from public.wallets where user_id = v_meera);
  if v_after - v_before > v_paid then
    raise exception 'FAIL H53: a staff decision paid the helper % for % paid in', v_after - v_before, v_paid;
  end if;

  raise notice 'hunt2_money: all assertions passed';
end;
$$;

rollback;
