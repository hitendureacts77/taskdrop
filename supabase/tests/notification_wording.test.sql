-- Notification wording (migration 128).
--
-- A customer reads the title on a lock screen and decides whether to open the app.
-- So every notification must say what happened and who did it, use only the app's
-- own words, and name the task. This runs a task through its life with the real
-- functions and checks what each side was told. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/notification_wording.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.back_to_admin() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

-- "title | body" of the newest notification of one kind for one person on one task.
create or replace function pg_temp.said(p_user uuid, p_kind text, p_task uuid default null) returns text
language sql as $$
  select n.title || ' | ' || coalesce(n.body, '')
    from public.notifications n
   where n.user_id = p_user and n.kind = p_kind and (p_task is null or n.task_id = p_task)
   order by n.created_at desc, n.id
   limit 1
$$;

-- Everything in this test shares one transaction timestamp, so "newest" is a tie between two of the
-- same kind: clear the earlier ones before the action whose message is being checked.
create or replace function pg_temp.forget(p_user uuid, p_kind text) returns void
language sql as $$
  delete from public.notifications where user_id = p_user and kind = p_kind
$$;

create or replace function pg_temp.expect(p_label text, p_got text, p_want text) returns void
language plpgsql as $$
begin
  if p_got is distinct from p_want then
    raise exception E'FAIL: %\n   got:  %\n   want: %', p_label, p_got, p_want;
  end if;
end;
$$;

-- ---- 1. the helpers --------------------------------------------------------
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
begin
  perform pg_temp.expect('whole rupees have no decimals', private.rupees(10000), '₹100');
  perform pg_temp.expect('paise are kept', private.rupees(5050), '₹50.50');
  perform pg_temp.expect('Indian grouping', private.rupees(12345678), '₹1,23,456.78');
  perform pg_temp.expect('lakhs', private.rupees(100000000), '₹10,00,000');
  perform pg_temp.expect('short task name', private.label('Fix a tap'), '"Fix a tap"');
  perform pg_temp.expect('long task name is cut', private.label(repeat('a', 60)), '"' || repeat('a', 40) || '…"');
  perform pg_temp.expect('missing task name', private.label(null), '"your task"');

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'words+' || u.id || '@taskdrop.test', '', now(), now(), now()
    from (values (v_a), (v_b), (v_c), (v_d)) as u(id);
  update public.profiles set display_name = 'Asha Rao'       where id = v_a;
  update public.profiles set display_name = 'New user'       where id = v_b;
  update public.profiles set display_name = 'p9876543210'    where id = v_c;
  update public.profiles set display_name = 'Tasker 3210'    where id = v_d;

  perform pg_temp.expect('a real name gives the first name', private.who(v_a, 'The customer'), 'Asha');
  perform pg_temp.expect('"New user" is never used as a name', private.who(v_b, 'The customer'), 'The customer');
  perform pg_temp.expect('a phone-number name is never shown', private.who(v_c, 'The customer'), 'The customer');
  perform pg_temp.expect('a generated Tasker name is never shown', private.who(v_d, 'Your worker'), 'Your worker');
  perform pg_temp.expect('an unknown person falls back', private.who(gen_random_uuid(), 'Someone'), 'Someone');
end;
$$;

-- ---- 2. a task from offer to payment ---------------------------------------------
do $$
declare
  v_cust   uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_nobody uuid := gen_random_uuid();
  v_task   uuid;
  v_bid    uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'words+' || u.id || '@taskdrop.test', '', now(), now(), now()
    from (values (v_cust), (v_worker), (v_nobody)) as u(id);
  update public.profiles set display_name = 'Asha Rao'   where id = v_cust;
  update public.profiles set display_name = 'Ravi Kumar' where id = v_worker;
  update public.profiles set display_name = 'New user'   where id = v_nobody;
  insert into public.wallets (user_id) values (v_cust), (v_worker), (v_nobody) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 5000000 where user_id = v_cust;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_cust, 'services', 'Fix a leaking kitchen tap', 200000, 240) returning id into v_task;

  -- An offer from a worker with a real name, then from one without.
  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 150000, 240) returning id into v_bid;
  perform pg_temp.back_to_admin();
  perform pg_temp.expect('offer', pg_temp.said(v_cust, 'quote', v_task),
    'Ravi offered ₹1,500 | To do "Fix a leaking kitchen tap". Open it to compare offers.');

  perform pg_temp.forget(v_cust, 'quote');
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_nobody, 123456, 240);
  perform pg_temp.expect('offer from an unnamed worker', pg_temp.said(v_cust, 'quote', v_task),
    'A worker offered ₹1,234.56 | To do "Fix a leaking kitchen tap". Open it to compare offers.');

  -- The customer picks Ravi (lock_bid also pays from the wallet).
  perform pg_temp.become(v_cust);
  perform public.lock_bid(v_bid);
  perform pg_temp.back_to_admin();
  perform pg_temp.expect('picked', pg_temp.said(v_worker, 'picked', v_task),
    'Asha picked you | For "Fix a leaking kitchen tap". You can start once they have paid.');
  perform pg_temp.expect('paid', pg_temp.said(v_worker, 'funded', v_task),
    'Asha has paid. You can start | "Fix a leaking kitchen tap": your payment is held safely until the work is approved.');

  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  perform pg_temp.back_to_admin();
  perform pg_temp.expect('started', pg_temp.said(v_cust, 'started', v_task),
    'Ravi started your task | "Fix a leaking kitchen tap" is now in progress.');

  -- A message while the work is going on, then a photo.
  insert into public.messages (task_id, sender_id, body) values (v_task, v_worker, 'I am on my way with the part');
  perform pg_temp.expect('message', pg_temp.said(v_cust, 'message', v_task),
    'Ravi sent you a message | "Fix a leaking kitchen tap": I am on my way with the part');
  perform pg_temp.forget(v_cust, 'message');
  insert into public.messages (task_id, sender_id, body) values (v_task, v_worker, '::media::abc');
  perform pg_temp.expect('photo message', pg_temp.said(v_cust, 'message', v_task),
    'Ravi sent you a message | "Fix a leaking kitchen tap": 📷 Photo');

  perform pg_temp.become(v_worker);
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Fixed the tap and tested it', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.back_to_admin();
  perform pg_temp.expect('submitted', pg_temp.said(v_cust, 'submitted', v_task),
    'Ravi sent in the work | For "Fix a leaking kitchen tap". Approve it to pay them, or ask for changes.');

  perform pg_temp.become(v_cust);
  perform public.request_revision(v_task, 'Please check the washer too');
  perform pg_temp.back_to_admin();
  perform pg_temp.expect('changes asked', pg_temp.said(v_worker, 'revision', v_task),
    'Asha asked for changes | On "Fix a leaking kitchen tap". Open it to see what to fix, then send it again.');

  perform pg_temp.become(v_worker);
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Washer replaced too', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.become(v_cust);
  perform public.confirm_release(v_task);
  perform pg_temp.back_to_admin();
  perform pg_temp.expect('approved', pg_temp.said(v_worker, 'released', v_task),
    'Asha approved your work | "Fix a leaking kitchen tap": your earnings will show in your wallet soon.');
end;
$$;

-- ---- 3. cancelling: the fine, the refund, and a problem report -------------------
do $$
declare
  v_cust   uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_task   uuid;
  v_bid    uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'words+' || u.id || '@taskdrop.test', '', now(), now(), now()
    from (values (v_cust), (v_worker)) as u(id);
  update public.profiles set display_name = 'Meera Nair'  where id = v_cust;
  update public.profiles set display_name = 'Kiran Das'   where id = v_worker;
  insert into public.wallets (user_id) values (v_cust), (v_worker) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 5000000 where user_id = v_cust;

  -- Cancelled after the work started: a fine to the worker, the rest back to the customer.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_cust, 'services', repeat('Paint the living room walls ', 3), 100000, 240) returning id into v_task;
  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;
  perform pg_temp.become(v_cust);
  perform public.lock_bid(v_bid);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  perform pg_temp.become(v_cust);
  perform public.cancel_task(v_task);
  perform pg_temp.back_to_admin();

  perform pg_temp.expect('fine', pg_temp.said(v_worker, 'cancel_fine', v_task),
    'Meera cancelled after you started | You were paid ₹50 for your time on "Paint the living room walls Paint the li…". It is in your wallet.');
  perform pg_temp.expect('refund', pg_temp.said(v_cust, 'wallet_refund', v_task),
    '₹980 is back in your wallet | "Paint the living room walls Paint the li…" was cancelled. ₹50 went to the worker for the time already spent.');
  perform pg_temp.expect('cancelled (customer)', pg_temp.said(v_cust, 'cancelled', v_task),
    'Task cancelled | "Paint the living room walls Paint the li…" was cancelled.');
  perform pg_temp.expect('cancelled (worker)', pg_temp.said(v_worker, 'cancelled', v_task),
    'Task cancelled | "Paint the living room walls Paint the li…" was cancelled. You can offer on other tasks.');

  -- A problem is reported on finished work.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_cust, 'services', 'Deliver a parcel', 100000, 240) returning id into v_task;
  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;
  perform pg_temp.become(v_cust);
  perform public.lock_bid(v_bid);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Parcel delivered', '[]'::jsonb);
  perform public.mark_work_done(v_task);
  perform pg_temp.become(v_cust);
  perform public.open_dispute(v_task, 'It never arrived');
  perform pg_temp.back_to_admin();
  perform pg_temp.expect('problem reported', pg_temp.said(v_worker, 'dispute', v_task),
    'A problem was reported | On "Deliver a parcel". Our team is looking into it and will update you here.');
  perform pg_temp.expect('problem reported (customer)', pg_temp.said(v_cust, 'dispute', v_task),
    'A problem was reported | On "Deliver a parcel". Our team is looking into it and will update you here.');
end;
$$;

-- ---- 4. withdrawals, wallet changes and reminders --------------------------------------
do $$
declare
  v_user  uuid := gen_random_uuid();
  v_other uuid := gen_random_uuid();
  v_task  uuid;
  v_out   jsonb;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'words+' || u.id || '@taskdrop.test', '', now(), now(), now()
    from (values (v_user), (v_other)) as u(id);
  update public.profiles set display_name = 'Dev Patel' where id = v_user;
  insert into public.wallets (user_id) values (v_user), (v_other) on conflict (user_id) do nothing;

  perform private.notify_payout(v_user, 'sent', 25000);
  perform pg_temp.expect('withdrawal sent', pg_temp.said(v_user, 'payout_paid'),
    '₹250 withdrawal sent | It is on its way to your bank or UPI account.');
  perform pg_temp.forget(v_user, 'payout_paid');
  perform private.notify_payout(v_user, 'sent', 25000, null, 'UTR123');
  perform pg_temp.expect('withdrawal sent with reference', pg_temp.said(v_user, 'payout_paid'),
    '₹250 withdrawal sent | It is on its way to your bank or UPI account. Bank reference: UTR123.');
  perform private.notify_payout(v_user, 'failed', 25000, 'The account number is wrong.');
  perform pg_temp.expect('withdrawal failed', pg_temp.said(v_user, 'payout_failed'),
    '₹250 withdrawal failed | Your money is back in your earnings. Check your bank or UPI details and try again. Reason: The account number is wrong.');
  perform pg_temp.forget(v_user, 'payout_failed');
  perform private.notify_payout(v_user, 'returned', 25000, 'Your bank sent the money back');
  perform pg_temp.expect('withdrawal returned', pg_temp.said(v_user, 'payout_failed'),
    'Your bank sent ₹250 back | Your money is back in your earnings. Check your bank or UPI details and try again. Reason: Your bank sent the money back.');
  perform pg_temp.forget(v_user, 'payout_failed');
  perform private.notify_payout(v_user, 'failed', 25000);
  perform pg_temp.expect('withdrawal failed without a reason', pg_temp.said(v_user, 'payout_failed'),
    '₹250 withdrawal failed | Your money is back in your earnings. Check your bank or UPI details and try again.');

  insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason)
  values (v_user, 50000, 0, 0, 'test credit');
  perform pg_temp.expect('wallet credit', pg_temp.said(v_user, 'wallet'),
    '₹500 added to your wallet | Open your wallet to see why.');
  perform pg_temp.forget(v_user, 'wallet');
  insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason)
  values (v_user, -2550, 50000, 0, 'test debit');
  perform pg_temp.expect('wallet debit', pg_temp.said(v_user, 'wallet'),
    '₹25.50 taken from your wallet | Open your wallet to see why.');

  -- Reminders: finished work waits for the customer; a started job falls due.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_user, 'services', 'Review my essay', 10000, 60) returning id into v_task;
  update public.tasks set status = 'WORK_DONE', funded_at = now(), auto_complete_at = now() + interval '10 hours' where id = v_task;
  v_out := public.run_task_reminders();
  perform pg_temp.expect('review reminder', pg_temp.said(v_user, 'review_reminder', v_task),
    'Work is waiting for your approval | "Review my essay": approve it or report a problem. If you do nothing, it is approved for you within 24 hours.');

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_user, 'services', 'Walk the dog', 10000, 60) returning id into v_task;
  update public.tasks set status = 'TASK_STARTED', due_at = now() + interval '30 minutes' where id = v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_task, v_other, 10000, 60);
  insert into public.assignments (task_id, bid_id, worker_id, status, escrow_minor)
  select b.task_id, b.id, v_other, 'started', 10000 from public.bids b where b.task_id = v_task;
  v_out := public.run_task_reminders();
  perform pg_temp.expect('due reminder', pg_temp.said(v_other, 'due_reminder', v_task),
    'Due within the hour | Send "Walk the dog" before the deadline.');
end;
$$;

-- ---- 5. the rules hold for everything written above ------------------------------------
do $$
declare
  r record;
begin
  for r in
    -- Only what this test created (it shares one transaction timestamp); older rows on a shared
    -- database were written in the old words.
    select kind, title, body from public.notifications
     where created_at >= now()
       and (title ~* '(escrow|poster|quote[ds]?\y|clearing|e2e|auto-accepted)'
         or coalesce(body, '') ~* '(escrow|poster|quote[ds]?\y|clearing|e2e|auto-accepted)'
         or length(title) > 50
         or length(coalesce(body, '')) > 150)
  loop
    if r.kind <> 'quote' then   -- the kind code stays "quote"; only the words change
      raise exception 'FAIL: a notification breaks the wording rules: % | %', r.title, r.body;
    end if;
  end loop;
  raise notice 'notification_wording: all assertions passed';
end;
$$;

rollback;
