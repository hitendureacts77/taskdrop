-- Plan B money flow (migration 195, task 2.21).
--
-- Pay per task, the payment company holds the money, TaskDrop never holds a balance. This walks every
-- money row in docs/design/plan-b-money/DESIGN.md §2 against the database, with the provider played
-- by the service-role calls the money function makes (set_order, mark_paid, claim_move, record_move):
--   hire needs a payee account; hire opens a hold; paying holds it (once, exact amount only);
--   approve / auto-complete release; cancel before start refunds; cancel after start splits;
--   walk-away refunds and reopens; disputes both ways; the money stop blocks releases, never refunds;
--   unpaid hires expire; a late payment for an ended hire goes straight back; the ledger is
--   append-only; the app cannot call the service functions; the wallet path is unchanged when off.
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/plan_b_money.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal2')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- Post a task as the poster, offer on it as the worker, hire as the poster. Returns the task.
create or replace function pg_temp.hire(p_poster uuid, p_worker uuid, p_price bigint, p_title text) returns uuid
language plpgsql as $$
declare
  v_task uuid;
  v_bid  uuid;
begin
  perform pg_temp.become(p_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (p_poster, 'services', p_title, p_price, 240) returning id into v_task;
  perform pg_temp.become(p_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, p_worker, p_price, 240) returning id into v_bid;
  perform pg_temp.become(p_poster);
  perform public.lock_bid(v_bid, 'one_time', p_price);
  return v_task;
end;
$$;

create or replace function pg_temp.hold_of(p_task uuid) returns public.task_holds
language plpgsql as $$
declare
  v_hold public.task_holds;
begin
  perform pg_temp.as_operator();
  select * into v_hold from public.task_holds where task_id = p_task order by created_at desc limit 1;
  return v_hold;
end;
$$;

-- The payment company takes the money for a task's hold. Returns what mark_paid said.
create or replace function pg_temp.pay(p_task uuid, p_amount bigint default null) returns text
language plpgsql as $$
declare
  v_hold public.task_holds := pg_temp.hold_of(p_task);
begin
  perform pg_temp.as_operator();
  perform public.plan_b_set_order(v_hold.id, 'order_' || v_hold.id, 'https://checkout.test/' || v_hold.id);
  return public.plan_b_mark_paid('order_' || v_hold.id, 'pay_' || v_hold.id, 'tr_' || v_hold.id,
                                 coalesce(p_amount, v_hold.charged_minor));
end;
$$;

-- Run one waiting outside call for a hold, as the money function would. Returns the part, or null.
create or replace function pg_temp.move(p_hold uuid, p_ok boolean default true) returns text
language plpgsql as $$
declare
  v_claim jsonb;
begin
  perform pg_temp.as_operator();
  v_claim := public.plan_b_claim_move(p_hold);
  if v_claim is null then return null; end if;
  perform public.plan_b_record_move(p_hold, v_claim ->> 'part', p_ok, 'ref_' || (v_claim ->> 'part'), 'test');
  return v_claim ->> 'part';
end;
$$;

create or replace function pg_temp.ledger(p_hold uuid, p_kind text) returns bigint
language sql as $$
  select coalesce(sum(amount_minor), 0)::bigint from public.money_ledger where hold_id = p_hold and kind = p_kind;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_nopay  uuid := gen_random_uuid();
  v_admin  uuid := gen_random_uuid();
  v_price  constant bigint := 100000;
  v_fee    numeric;
  v_comm   numeric;
  v_finep  numeric;
  v_charged bigint;
  v_share  bigint;
  v_fine   bigint;
  v_task   uuid;
  v_bid    uuid;
  v_hold   public.task_holds;
  v_row    public.tasks;
  v_res    text;
  v_failed boolean;
  v_err    text;
  v_bal    bigint;
  v_json   jsonb;
begin
  perform pg_temp.as_operator();
  v_fee   := private.setting_num('poster_service_fee_pct', 0.03);
  v_comm  := private.setting_num('worker_commission_pct', 0.20);
  v_finep := private.setting_num('post_start_cancel_penalty_pct', 0.05);
  v_charged := round(v_price * (1 + v_fee))::bigint;
  v_share   := v_price - round(v_price * v_comm)::bigint;
  v_fine    := round(v_price * v_finep)::bigint;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'planb+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_nopay), (v_admin)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'PlanB Poster'), (v_worker, 'PlanB Worker'), (v_nopay, 'PlanB Unset'), (v_admin, 'PlanB Admin')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_nopay) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;
  -- These test accounts are brand new; the new-account caps (migrations 133, 152) are tested elsewhere.
  -- Count every account as established here (rolled back with the rest), so eleven hires fit in one run.
  insert into public.settings (key, value) values ('new_account_days', '0'::jsonb), ('new_account_tasks', '0'::jsonb)
  on conflict (key) do update set value = excluded.value;

  -- ---- the amounts match the rules package ------------------------------------------------
  select to_jsonb(a) into v_json from private.plan_b_amounts(v_price) a;
  assert (v_json ->> 'charged')::bigint = v_charged and (v_json ->> 'worker_share')::bigint = v_share
     and (v_json ->> 'fee')::bigint = v_charged - v_price and (v_json ->> 'fine')::bigint = v_fine,
    format('plan_b_amounts disagrees with the rules: %s', v_json);

  -- ---- switched off, the wallet path is exactly as before ---------------------------------
  update public.settings set value = to_jsonb('wallet'::text) where key = 'money_flow';
  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'planb wallet off', v_price, 240) returning id into v_task;
  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, v_price, 240) returning id into v_bid;
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    perform public.lock_bid(v_bid, 'one_time', v_price);
  exception when others then v_failed := true;
  end;
  assert v_failed, 'under the wallet flow an empty wallet must still refuse the hire';
  perform pg_temp.as_operator();
  assert not exists (select 1 from public.task_holds where task_id = v_task), 'the wallet flow must not open a hold';

  -- ---- switch Plan B on --------------------------------------------------------------------
  perform pg_temp.as_operator();
  update public.settings set value = to_jsonb('plan_b'::text) where key = 'money_flow';
  update public.settings set value = to_jsonb('simulated'::text) where key = 'money_provider';
  update public.settings set value = 'false'::jsonb where key = 'money_paused';

  -- ---- row 1: a worker who has not set up payments cannot be hired --------------------------
  v_err := null;
  begin
    perform pg_temp.hire(v_poster, v_nopay, v_price, 'planb no payee');
  exception when others then v_err := sqlerrm;
  end;
  assert v_err like '%not set up payments%', format('hiring a worker with no payee account should be refused, got %s', v_err);

  perform pg_temp.as_operator();
  perform public.plan_b_save_payee(v_worker, 'simulated', 'acc_test_worker', 'active', 'upi', 'UPI ••••@okhdfc');

  -- ---- top-ups and wallet payments are closed --------------------------------------------
  perform pg_temp.become(v_poster);
  v_err := null;
  begin
    perform public.pay_task_from_wallet(v_task);
  exception when others then v_err := sqlerrm;
  end;
  assert v_err like '%checkout%', format('paying from the wallet must be refused under Plan B, got %s', v_err);

  -- ---- row 1-2: hire opens a hold; paying holds it ---------------------------------------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb approve');
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'awaiting_payment', format('a hire should open an unpaid hold, was %s', v_hold.status);
  assert v_hold.charged_minor = v_charged and v_hold.worker_share_minor = v_share,
    format('hold amounts wrong: charged %s share %s', v_hold.charged_minor, v_hold.worker_share_minor);
  select * into v_row from public.tasks where id = v_task;
  assert v_row.status = 'LOCKED' and v_row.funded_at is null, 'a Plan B hire is locked but not funded until paid';
  select balance_minor into v_bal from public.wallets where user_id = v_poster;
  assert v_bal = 0, 'a Plan B hire must not touch the wallet';

  -- the worker cannot start before the money is in
  perform pg_temp.become(v_worker);
  v_failed := false;
  begin
    perform public.start_task(v_task);
  exception when others then v_failed := true;
  end;
  assert v_failed, 'work must not start before the payment is held';

  -- a wrong amount is kept for a person, not funded
  v_res := pg_temp.pay(v_task, v_charged - 1);
  assert v_res = 'amount_mismatch', format('a short payment should be held for staff, got %s', v_res);
  assert (pg_temp.hold_of(v_task)).status = 'awaiting_payment', 'a short payment must not mark the hold held';

  v_res := pg_temp.pay(v_task);
  assert v_res = 'held', format('the exact payment should hold the money, got %s', v_res);
  v_res := pg_temp.pay(v_task);
  assert v_res = 'already', format('a repeated payment message must change nothing, got %s', v_res);
  v_hold := pg_temp.hold_of(v_task);
  assert pg_temp.ledger(v_hold.id, 'paid') = v_charged, 'the ledger should record the payment exactly once';
  assert pg_temp.ledger(v_hold.id, 'on_hold') = v_share, 'the ledger should record the worker share on hold once';
  select * into v_row from public.tasks where id = v_task;
  assert v_row.funded_at is not null and v_row.funded_via = 'payment' and v_row.funded_minor = v_charged,
    'a held payment funds the task';

  -- ---- rows 3-4: done, approved, released ---------------------------------------------------
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  -- Proof of work is required before a task can be marked done (migration 057).
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Finished the work as agreed', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.become(v_poster);
  v_row := public.confirm_release(v_task);
  assert v_row.status = 'COMPLETED', format('approval completes the task, was %s', v_row.status);
  assert v_row.cleared_at is not null, 'a Plan B task is marked cleared, so the old wallet clearing sweep skips it';
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'release_asked' and v_hold.release_minor = v_share and v_hold.release_key = 'release:' || v_hold.id,
    format('approval should ask for the worker share with its own key, was %s', v_hold.status);
  assert (select clearing_minor + balance_minor from public.wallets where user_id = v_worker) = 0,
    'a Plan B release must not credit the worker wallet';

  -- the money stop holds the release back
  perform pg_temp.as_operator();
  update public.settings set value = 'true'::jsonb where key = 'money_paused';
  assert pg_temp.move(v_hold.id) is null, 'the money stop must hold a release back';
  update public.settings set value = 'false'::jsonb where key = 'money_paused';

  -- a refused release is marked for staff, and a retry sends it again
  assert pg_temp.move(v_hold.id, false) = 'release', 'the release should be tried';
  assert (pg_temp.hold_of(v_task)).status = 'failed', 'a refused release is marked failed';
  perform pg_temp.become(v_admin);
  assert public.admin_plan_b_retry_move(v_hold.id, 'test retry') = 'release_asked', 'staff can retry a failed move';
  assert pg_temp.move(v_hold.id) = 'release', 'the retried release runs';
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'released', format('a sent release finishes the hold, was %s', v_hold.status);
  assert pg_temp.ledger(v_hold.id, 'released') = v_share, 'the ledger records the release';
  assert pg_temp.ledger(v_hold.id, 'commission') + pg_temp.ledger(v_hold.id, 'service_fee') = v_charged - v_share,
    'TaskDrop keeps exactly the fee and the commission';
  assert pg_temp.move(v_hold.id) is null, 'a finished hold has nothing more to send';

  -- the worker sees it in the Money record
  perform pg_temp.become(v_worker);
  v_json := public.my_money_ledger(50);
  assert (v_json #>> '{totals,released_minor}')::bigint = v_share, format('the worker record is wrong: %s', v_json);
  assert public.my_task_hold(v_task) ->> 'status' = 'released', 'the worker sees the hold state';
  assert public.my_task_hold(v_task) ->> 'provider_payment_id' is null, 'provider ids stay on the server';

  -- ---- the ledger is append-only ----------------------------------------------------------
  perform pg_temp.as_operator();
  v_failed := false;
  begin
    update public.money_ledger set amount_minor = 1 where hold_id = v_hold.id;
  exception when others then v_failed := true;
  end;
  assert v_failed, 'ledger rows must never change';

  -- ---- auto-complete after 3 days releases too ---------------------------------------------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb auto');
  perform pg_temp.pay(v_task);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  -- Proof of work is required before a task can be marked done (migration 057).
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Finished the work as agreed', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.as_operator();
  update public.tasks set auto_complete_at = now() - interval '1 minute' where id = v_task;
  perform private.auto_complete_due();
  assert (select status from public.tasks where id = v_task) = 'AUTO_COMPLETED', 'the task auto-completes';
  assert (pg_temp.hold_of(v_task)).status = 'release_asked', 'auto-complete asks for the release';

  -- ---- row 5: cancel before work starts = full refund, even while the money stop is on ------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb cancel early');
  perform pg_temp.pay(v_task);
  perform pg_temp.become(v_poster);
  perform public.cancel_task(v_task, 'test');
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'refund_asked' and v_hold.refund_minor = v_charged and coalesce(v_hold.release_minor, 0) = 0,
    format('an early cancel refunds everything, was %s %s', v_hold.status, v_hold.refund_minor);
  update public.settings set value = 'true'::jsonb where key = 'money_paused';
  assert pg_temp.move(v_hold.id) = 'refund', 'refunds run even with the money stop on';
  update public.settings set value = 'false'::jsonb where key = 'money_paused';
  assert (pg_temp.hold_of(v_task)).status = 'refunded', 'the refund finishes the hold';
  assert pg_temp.ledger(v_hold.id, 'refunded') = v_charged, 'the ledger records the refund';
  assert (select balance_minor from public.wallets where user_id = v_poster) = 0, 'a Plan B refund never lands in the wallet';

  -- ---- row 6: cancel after work starts = fine to the worker, the rest back -----------------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb cancel late');
  perform pg_temp.pay(v_task);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  perform pg_temp.become(v_poster);
  perform public.cancel_task(v_task, 'test');
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'split_asked' and v_hold.release_minor = v_fine and v_hold.refund_minor = v_charged - v_fine,
    format('a late cancel splits: fine %s back %s, was %s/%s', v_fine, v_charged - v_fine, v_hold.release_minor, v_hold.refund_minor);
  assert pg_temp.move(v_hold.id) = 'refund', 'a split sends the refund first';
  assert pg_temp.move(v_hold.id) = 'release', 'then the fine';
  assert (pg_temp.hold_of(v_task)).status = 'split', 'both halves finish the split';
  assert pg_temp.ledger(v_hold.id, 'fine_paid') = v_fine and pg_temp.ledger(v_hold.id, 'refunded') = v_charged - v_fine,
    'the ledger records both halves';

  -- ---- row 7: the worker walks away = full refund, task opens, next hire pays again ---------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb walk away');
  perform pg_temp.pay(v_task);
  perform pg_temp.become(v_worker);
  perform public.cancel_task(v_task, 'test');
  select * into v_row from public.tasks where id = v_task;
  assert v_row.status = 'OPEN' and v_row.funded_at is null, 'a walk-away reopens the task unfunded';
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'refund_asked' and v_hold.refund_minor = v_charged, 'a walk-away refunds in full';

  -- ---- row 8: disputes, both ways -----------------------------------------------------------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb dispute worker');
  perform pg_temp.pay(v_task);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  -- Proof of work is required before a task can be marked done (migration 057).
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Finished the work as agreed', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.become(v_poster);
  perform public.open_dispute(v_task, 'planb test: not happy');
  assert (pg_temp.hold_of(v_task)).status = 'held', 'a dispute keeps the money on hold';
  perform pg_temp.become(v_admin);
  perform public.admin_resolve_dispute(v_task, 'worker', 'planb test');
  assert (pg_temp.hold_of(v_task)).status = 'release_asked', 'worker wins = release';

  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb dispute poster');
  perform pg_temp.pay(v_task);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  -- Proof of work is required before a task can be marked done (migration 057).
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Finished the work as agreed', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.become(v_poster);
  perform public.open_dispute(v_task, 'planb test: not done');
  perform pg_temp.become(v_admin);
  perform public.admin_resolve_dispute(v_task, 'poster', 'planb test');
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'refund_asked' and v_hold.refund_minor = v_charged, 'poster wins = full refund';

  -- ---- row 8b: a dispute decided as a split (migration 255) ---------------------------------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb dispute split');
  perform pg_temp.pay(v_task);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Finished part of the work', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.become(v_poster);
  perform public.open_dispute(v_task, 'planb test: half done');
  perform pg_temp.become(v_admin);
  v_failed := false;
  begin
    perform public.admin_resolve_dispute_split(v_task, v_price, 'planb test');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a split must leave something for each side';
  v_failed := false;
  begin
    perform public.admin_resolve_dispute_split(v_task, 40000, '  ');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'a split needs a reason';
  perform public.admin_resolve_dispute_split(v_task, 40000, 'planb test: half the work was done');
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'split_asked'
     and v_hold.release_minor = round(40000::numeric * v_hold.worker_share_minor / v_hold.offer_minor)::bigint
     and v_hold.refund_minor = v_hold.charged_minor - 40000
     and v_hold.release_key = 'dispute:' || v_hold.id,
    format('a dispute split pays the worker their cut of 40000 and refunds the rest, was %s/%s', v_hold.release_minor, v_hold.refund_minor);
  assert (select outcome from public.dispute_decisions where task_id = v_task) = 'split', 'the decision is recorded as a split';
  assert (select status from public.tasks where id = v_task) = 'COMPLETED', 'a split closes the job as finished';
  assert pg_temp.move(v_hold.id) = 'refund', 'a dispute split refunds first';
  assert pg_temp.move(v_hold.id) = 'release', 'then pays the worker';
  assert (pg_temp.hold_of(v_task)).status = 'split', 'both halves finish the dispute split';
  assert pg_temp.ledger(v_hold.id, 'released') = v_hold.release_minor, 'the worker''s part is booked as released';
  assert pg_temp.ledger(v_hold.id, 'fine_paid') = 0, 'a dispute split is not a fine';
  assert pg_temp.ledger(v_hold.id, 'commission') = v_hold.charged_minor - v_hold.release_minor - v_hold.refund_minor,
    'TaskDrop keeps only the commission on the part done';

  -- ---- TaskDrop cancels a paid hire: full refund ----------------------------------------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb admin cancel');
  perform pg_temp.pay(v_task);
  perform pg_temp.become(v_admin);
  perform public.admin_cancel_task_with_refund(v_task, 'planb test');
  v_hold := pg_temp.hold_of(v_task);
  assert v_hold.status = 'refund_asked' and v_hold.refund_minor = v_charged, 'an admin cancel refunds a Plan B hold in full';

  -- ---- an unpaid hire expires and the task opens; a late payment goes straight back ---------
  v_task := pg_temp.hire(v_poster, v_worker, v_price, 'planb expire');
  v_hold := pg_temp.hold_of(v_task);
  perform public.plan_b_set_order(v_hold.id, 'order_' || v_hold.id, 'https://checkout.test/' || v_hold.id);
  update public.task_holds set expires_at = now() - interval '1 minute' where id = v_hold.id;
  assert public.plan_b_expire_unpaid() >= 1, 'an unpaid hire past its time expires';
  assert (pg_temp.hold_of(v_task)).status = 'expired', 'the hold is expired';
  assert (select status from public.tasks where id = v_task) = 'OPEN', 'the task opens for offers again';

  -- the poster re-hires the same worker: a new live hold, and the old order paying late is refunded
  perform pg_temp.become(v_poster);
  perform public.lock_bid((select id from public.bids where task_id = v_task and worker_id = v_worker), 'one_time', v_price);
  perform pg_temp.as_operator();
  v_res := public.plan_b_mark_paid('order_' || v_hold.id, 'pay_late_' || v_hold.id, null, v_hold.charged_minor);
  assert v_res = 'refund', format('a payment for an ended hire must go straight back, got %s', v_res);
  assert (select status from public.task_holds where id = v_hold.id) = 'refund_asked', 'the late payment is refunded';
  assert (select count(*) from public.task_holds where task_id = v_task and status in ('awaiting_payment', 'held')) = 1,
    'the new hire keeps its own live hold';

  -- ---- the app cannot call the service functions, and the stop needs a full admin ----------
  assert not has_function_privilege('authenticated', 'public.plan_b_mark_paid(text, text, text, bigint)', 'EXECUTE'),
    'the app must not mark payments';
  assert not has_function_privilege('authenticated', 'public.plan_b_claim_move(uuid)', 'EXECUTE'),
    'the app must not claim money moves';
  assert not has_function_privilege('authenticated', 'public.plan_b_record_move(uuid, text, boolean, text, text)', 'EXECUTE'),
    'the app must not record money moves';
  assert not has_function_privilege('anon', 'public.my_money_ledger(integer)', 'EXECUTE'),
    'guests must not read money records';

  perform pg_temp.become(v_admin);
  v_json := public.admin_set_money_paused(true, 'planb test');
  assert (v_json ->> 'paused')::boolean, 'a full admin can stop money';
  perform pg_temp.as_operator();
  assert private.money_paused(), 'the stop is on';
  insert into public.admin_staff (user_id, staff_role) values (v_admin, 'finance')
  on conflict (user_id) do update set staff_role = 'finance';
  perform pg_temp.become(v_admin);
  v_failed := false;
  begin
    perform public.admin_set_money_paused(false, 'planb test');
  exception when others then v_failed := true;
  end;
  assert v_failed, 'only a full admin may switch the money stop';

  raise notice 'plan_b_money: all checks passed';
end;
$$;

rollback;
