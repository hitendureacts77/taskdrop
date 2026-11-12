-- Debug round B66 and B65 (migration 174). Rolls back; leaves nothing.
--
-- B66 signed-out callers cannot ask whether two accounts blocked each other; signed-in
--     people still can (the tasks_hide_blocked row rule needs it).
-- B65 when a poster cancels a card-paid job after the work started, the worker gets the
--     fine in their wallet and the card refund owed back is what was paid less that fine,
--     so TaskDrop never pays the fine itself.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/blocked_between_and_card_fine.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_failed boolean;
  v_task   uuid;
  v_bid    uuid;
  v_pay    uuid;
  v_price  bigint := 200000;
  v_paid   bigint;
  v_fine   bigint;
  v_due    bigint;
  v_before bigint;
begin
  -- ---- B66: who may call private.blocked_between ---------------------------------------------
  if has_function_privilege('anon', 'private.blocked_between(uuid, uuid)', 'execute') then
    raise exception 'FAIL B66: anon can still execute private.blocked_between';
  end if;
  if not has_function_privilege('authenticated', 'private.blocked_between(uuid, uuid)', 'execute') then
    raise exception 'FAIL B66: authenticated lost EXECUTE on private.blocked_between (tasks_hide_blocked needs it)';
  end if;
  if exists (select 1 from pg_proc p, aclexplode(p.proacl) a
              where p.oid = 'private.blocked_between(uuid, uuid)'::regprocedure
                and a.grantee = 0 and a.privilege_type = 'EXECUTE') then
    raise exception 'FAIL B66: PUBLIC can execute private.blocked_between';
  end if;

  -- A real signed-out call is refused (does not depend on the admin check).
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  v_failed := false;
  begin
    perform private.blocked_between(gen_random_uuid(), gen_random_uuid());
  exception when insufficient_privilege then v_failed := true;
  end;
  perform pg_temp.as_owner();
  if not v_failed then
    raise exception 'FAIL B66: a signed-out caller ran private.blocked_between';
  end if;

  -- ---- B65: card-paid job, poster cancels after the work started -----------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'b65+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'B65 Poster'), (v_worker, 'B65 Worker')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 0 where user_id in (v_poster, v_worker);

  -- Signed in, the row rule that calls blocked_between still works for the poster.
  perform pg_temp.become(v_poster);
  perform count(*) from public.tasks where status = 'OPEN';
  perform pg_temp.as_owner();

  -- The job the way the payment webhook leaves it (as in hunt2_money.test.sql).
  v_paid := round(v_price * (1 + private.setting_num('poster_service_fee_pct', 0.03)))::bigint;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'b65 card job', v_price, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, is_locked)
  values (v_task, v_worker, v_price, 240, true) returning id into v_bid;
  insert into public.payments (user_id, task_id, purpose, amount_minor, status, provider, paid_at)
  values (v_poster, v_task, 'escrow', v_paid, 'paid', 'seed', now()) returning id into v_pay;
  insert into public.assignments (task_id, bid_id, worker_id, status, escrow_minor, payout_mode)
  values (v_task, v_bid, v_worker, 'started', v_paid, 'one_time');
  update public.tasks
     set status = 'TASK_STARTED', locked_bid_id = v_bid, locked_minor = v_price, started_at = now(),
         payout_mode = 'one_time', funded_at = now(), funding_payment_id = v_pay,
         funded_via = 'payment', funded_minor = v_paid
   where id = v_task;

  perform pg_temp.become(v_poster);
  perform public.cancel_task(v_task);

  v_fine := round(v_price * private.setting_num('post_start_cancel_penalty_pct', 0.05))::bigint;
  if v_fine <= 0 then
    raise exception 'FAIL B65: expected a post-start fine above zero, got %', v_fine;
  end if;

  -- The card refund owed back is what was paid less the fine...
  select due_minor into v_due from public.escrow_refund_due(v_task);
  perform pg_temp.as_owner();
  if v_due <> v_paid - v_fine then
    raise exception 'FAIL B65: the card refund due is %, expected % (paid % less the % fine)',
      v_due, v_paid - v_fine, v_paid, v_fine;
  end if;
  if (select due_minor from public.refunds_outstanding where task_id = v_task) <> v_paid - v_fine then
    raise exception 'FAIL B65: refunds_outstanding does not take the fine off the card refund';
  end if;

  -- ...the worker got exactly the fine, and the poster's wallet was not credited as well.
  select balance_minor into v_before from public.wallets where user_id = v_worker;
  if v_before <> v_fine then
    raise exception 'FAIL B65: the worker was paid %, expected the % fine', v_before, v_fine;
  end if;
  if (select balance_minor from public.wallets where user_id = v_poster) <> 0 then
    raise exception 'FAIL B65: the card-paid poster was also refunded into the wallet';
  end if;

  raise notice 'blocked_between_and_card_fine ok';
end;
$$;

rollback;
