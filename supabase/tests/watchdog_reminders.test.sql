-- Migrations 104 (CodeRabbit fixes) and 105 (outbox watchdog, task reminders).
--
-- What is asserted:
--   1. The admin live feed shows a normal task title (also one with a six-digit
--      pin code), and hides one that holds a phone number (8+ digits, however
--      spaced) or an email address.
--   2. Signed-out visitors cannot execute the four task-access helpers; signed-in
--      people still can.
--   3. Two payments cannot share a payment-link id; payments with no id are fine.
--   4. Housekeeping trims live-feed rows older than 30 days and keeps newer ones,
--      and the insert trigger no longer deletes anything itself.
--   5. The outbox watchdog: nothing stuck means no alert; an event unsent for more
--      than 15 minutes leaves one alert; a second run stays quiet; a fresh unsent
--      event is not "stuck".
--   6. Task reminders: a poster is reminded once when finished work will be
--      approved within 24 hours (not when it is later, or the task is not funded);
--      a worker is reminded once when a started job falls due within the hour (not
--      when later, not when already past). Running again sends nothing more.
--   7. Only the service role can call the two new functions.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/watchdog_reminders.test.sql

begin;

create or replace function pg_temp.make_user(p_name text) returns uuid
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'test+' || v_user || '@taskdrop.test', '', now(), now(), now());
  update public.profiles set display_name = p_name where id = v_user;
  return v_user;
end;
$$;

-- ---- 1. live feed titles ----------------------------------------------------
do $$
declare
  v_poster uuid := pg_temp.make_user('Feed Poster');
  v_task   uuid;
  v_title  text;
begin
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Fix my kitchen tap', 10000, 60) returning id into v_task;
  select summary->>'title' into v_title from public.admin_live_events
   where kind = 'task_posted' and record_id = v_task;
  if v_title is distinct from 'Fix my kitchen tap' then
    raise exception 'FAIL: a normal title was not shown in the live feed: %', v_title;
  end if;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Call me on 98765 43210 please', 10000, 60) returning id into v_task;
  if not exists (select 1 from public.admin_live_events
                  where kind = 'task_posted' and record_id = v_task and summary->'title' = 'null'::jsonb) then
    raise exception 'FAIL: a title holding a phone number reached the live feed';
  end if;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'mail me at someone@example.com', 10000, 60) returning id into v_task;
  if not exists (select 1 from public.admin_live_events
                  where kind = 'task_posted' and record_id = v_task and summary->'title' = 'null'::jsonb) then
    raise exception 'FAIL: a title holding an email address reached the live feed';
  end if;

  -- Six digits (an Indian pin code) is not a phone number: still shown.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Deliver parcel to 560001', 10000, 60) returning id into v_task;
  select summary->>'title' into v_title from public.admin_live_events
   where kind = 'task_posted' and record_id = v_task;
  if v_title is distinct from 'Deliver parcel to 560001' then
    raise exception 'FAIL: a title with a pin code was hidden: %', v_title;
  end if;
end;
$$;

-- ---- 2. helpers: anon out, signed-in in -------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array['is_task_poster', 'user_bid_on_task', 'user_assigned_task', 'task_open_for_bid'] loop
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'private' and p.proname = fn
                  and has_function_privilege('anon', p.oid, 'EXECUTE')) then
      raise exception 'FAIL: signed-out visitors can still execute private.%()', fn;
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'private' and p.proname = fn
                      and has_function_privilege('authenticated', p.oid, 'EXECUTE')) then
      raise exception 'FAIL: signed-in people can no longer execute private.%(), so policies would break', fn;
    end if;
  end loop;
end;
$$;

-- ---- 3. one payment per payment link ----------------------------------------
do $$
declare
  v_user   uuid := pg_temp.make_user('Pay Tester');
  v_task   uuid;
  v_failed boolean := false;
begin
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_user, 'services', 'pay test', 10000, 60) returning id into v_task;

  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status)
  values (v_user, v_task, 'escrow', 103000, 'plink_dup_test', 'created');
  begin
    insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status)
    values (v_user, v_task, 'escrow', 103000, 'plink_dup_test', 'created');
  exception when unique_violation then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: two payments with the same payment-link id were accepted';
  end if;

  -- Payments with no reference stay allowed, as many as needed.
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status)
  values (v_user, v_task, 'escrow', 100, null, 'created'), (v_user, v_task, 'escrow', 100, null, 'created');
end;
$$;

-- ---- 4. live feed clean-up lives in housekeeping ----------------------------
do $$
declare
  v_out jsonb;
begin
  insert into public.admin_live_events (kind, record_type, summary, created_at)
  values ('test_old', 'task', '{}'::jsonb, now() - interval '40 days'),
         ('test_new', 'task', '{}'::jsonb, now() - interval '2 days');
  v_out := public.run_housekeeping();
  if exists (select 1 from public.admin_live_events where kind = 'test_old') then
    raise exception 'FAIL: a live-feed row older than 30 days was kept';
  end if;
  if not exists (select 1 from public.admin_live_events where kind = 'test_new') then
    raise exception 'FAIL: a recent live-feed row was removed';
  end if;
  if (v_out->>'admin_live_events')::int < 1 then
    raise exception 'FAIL: housekeeping did not report the live-feed rows it removed: %', v_out;
  end if;
end;
$$;

-- The insert itself must not delete: put an old row in, then add 25 events.
do $$
declare
  i integer;
begin
  insert into public.admin_live_events (kind, record_type, summary, created_at)
  values ('test_keep', 'task', '{}'::jsonb, now() - interval '40 days');
  for i in 1..30 loop
    perform private.admin_live('test_burst', 'task', null, null, '{}'::jsonb);
  end loop;
  if not exists (select 1 from public.admin_live_events where kind = 'test_keep') then
    raise exception 'FAIL: the live-feed insert deleted old rows by itself';
  end if;
end;
$$;

-- ---- 5. outbox watchdog -----------------------------------------------------
do $$
declare
  v_out   jsonb;
  v_count integer;
begin
  -- A clean slate for this transaction only (it is rolled back).
  delete from private.outbox where sent_at is null;
  delete from public.admin_alerts where kind = 'outbox_stuck';

  v_out := public.run_outbox_watchdog();
  if (v_out->>'stuck')::int <> 0 or (v_out->>'alerted')::boolean then
    raise exception 'FAIL: the watchdog raised an alarm with nothing waiting: %', v_out;
  end if;

  -- Fresh and unsent: not stuck yet.
  insert into private.outbox (kind, data, created_at) values ('test.fresh', '{}'::jsonb, now() - interval '2 minutes');
  v_out := public.run_outbox_watchdog();
  if (v_out->>'stuck')::int <> 0 then
    raise exception 'FAIL: a two-minute-old event was called stuck: %', v_out;
  end if;

  -- Old and unsent: stuck, one alert.
  insert into private.outbox (kind, data, created_at) values ('test.old', '{}'::jsonb, now() - interval '30 minutes');
  v_out := public.run_outbox_watchdog();
  if (v_out->>'stuck')::int <> 1 or not (v_out->>'alerted')::boolean then
    raise exception 'FAIL: a stuck event did not raise an alert: %', v_out;
  end if;
  select count(*) into v_count from public.admin_alerts where kind = 'outbox_stuck';
  if v_count <> 1 then
    raise exception 'FAIL: expected one outbox alert, found %', v_count;
  end if;

  -- Still stuck: no second alert inside six hours.
  v_out := public.run_outbox_watchdog();
  if (v_out->>'alerted')::boolean then
    raise exception 'FAIL: the watchdog repeated its alert within six hours';
  end if;
  select count(*) into v_count from public.admin_alerts where kind = 'outbox_stuck';
  if v_count <> 1 then
    raise exception 'FAIL: a repeated run left % alerts', v_count;
  end if;

  -- An event already sent is never stuck.
  update private.outbox set sent_at = now() where kind = 'test.old';
  v_out := public.run_outbox_watchdog();
  if (v_out->>'stuck')::int <> 0 then
    raise exception 'FAIL: a sent event was counted as stuck: %', v_out;
  end if;
end;
$$;

-- ---- 6. task reminders ------------------------------------------------------
do $$
declare
  v_poster uuid := pg_temp.make_user('Reminder Poster');
  v_worker uuid := pg_temp.make_user('Reminder Worker');
  v_soon   uuid;
  v_later  uuid;
  v_unpaid uuid;
  v_due    uuid;
  v_far    uuid;
  v_past   uuid;
  v_out    jsonb;
begin
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'review soon', 10000, 60) returning id into v_soon;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'review later', 10000, 60) returning id into v_later;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'review unfunded', 10000, 60) returning id into v_unpaid;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'due soon', 10000, 60) returning id into v_due;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'due far', 10000, 60) returning id into v_far;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'due past', 10000, 60) returning id into v_past;

  update public.tasks set status = 'WORK_DONE', funded_at = now(), auto_complete_at = now() + interval '10 hours' where id = v_soon;
  update public.tasks set status = 'WORK_DONE', funded_at = now(), auto_complete_at = now() + interval '60 hours' where id = v_later;
  update public.tasks set status = 'WORK_DONE', funded_at = null,  auto_complete_at = now() + interval '10 hours' where id = v_unpaid;
  update public.tasks set status = 'TASK_STARTED', due_at = now() + interval '30 minutes' where id = v_due;
  update public.tasks set status = 'TASK_STARTED', due_at = now() + interval '5 hours'    where id = v_far;
  update public.tasks set status = 'TASK_STARTED', due_at = now() - interval '30 minutes' where id = v_past;

  -- The worker is on the three started jobs.
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_due, v_worker, 10000, 60);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_far, v_worker, 10000, 60);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_past, v_worker, 10000, 60);
  insert into public.assignments (task_id, bid_id, worker_id, status, escrow_minor)
  select b.task_id, b.id, v_worker, 'started', 10000 from public.bids b where b.worker_id = v_worker;

  v_out := public.run_task_reminders();
  if (v_out->>'review_reminders')::int < 1 or (v_out->>'due_reminders')::int < 1 then
    raise exception 'FAIL: the reminders did not run: %', v_out;
  end if;

  if not exists (select 1 from public.notifications where user_id = v_poster and task_id = v_soon and kind = 'review_reminder') then
    raise exception 'FAIL: the poster was not reminded about work waiting for approval';
  end if;
  if exists (select 1 from public.notifications where task_id = v_later and kind = 'review_reminder') then
    raise exception 'FAIL: a poster was reminded long before the work would be approved for them';
  end if;
  if exists (select 1 from public.notifications where task_id = v_unpaid and kind = 'review_reminder') then
    raise exception 'FAIL: a poster was reminded about a task that was never funded';
  end if;
  if not exists (select 1 from public.notifications where user_id = v_worker and task_id = v_due and kind = 'due_reminder') then
    raise exception 'FAIL: the worker was not reminded that the job is due within the hour';
  end if;
  if exists (select 1 from public.notifications where task_id = v_far and kind = 'due_reminder') then
    raise exception 'FAIL: a worker was reminded about a job due hours away';
  end if;
  if exists (select 1 from public.notifications where task_id = v_past and kind = 'due_reminder') then
    raise exception 'FAIL: a worker was reminded about a job that is already late';
  end if;

  -- Again: nothing more is sent.
  v_out := public.run_task_reminders();
  if (v_out->>'review_reminders')::int <> 0 or (v_out->>'due_reminders')::int <> 0 then
    raise exception 'FAIL: a second run sent reminders again: %', v_out;
  end if;
  if (select count(*) from public.notifications where task_id = v_soon and kind = 'review_reminder') <> 1
     or (select count(*) from public.notifications where task_id = v_due and kind = 'due_reminder') <> 1 then
    raise exception 'FAIL: a person was reminded more than once about the same task';
  end if;
end;
$$;

-- ---- 7. who may call what ---------------------------------------------------
do $$
declare
  fn       text;
  v_user   uuid := gen_random_uuid();
  v_failed boolean;
begin
  foreach fn in array array['run_outbox_watchdog', 'run_task_reminders'] loop
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = fn) then
      raise exception 'FAIL: public.%() does not exist', fn;
    end if;
    if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                where n.nspname = 'public' and p.proname = fn
                  and (has_function_privilege('anon', p.oid, 'EXECUTE')
                    or has_function_privilege('authenticated', p.oid, 'EXECUTE'))) then
      raise exception 'FAIL: a signed-in or anonymous caller can execute public.%()', fn;
    end if;
    if not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                    where n.nspname = 'public' and p.proname = fn
                      and has_function_privilege('service_role', p.oid, 'EXECUTE')) then
      raise exception 'FAIL: the service role cannot execute public.%(), so Inngest cannot work', fn;
    end if;
  end loop;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user, 'role', 'authenticated')::text, true);
  foreach fn in array array['run_outbox_watchdog', 'run_task_reminders'] loop
    v_failed := false;
    begin
      if fn = 'run_outbox_watchdog' then perform public.run_outbox_watchdog();
      else perform public.run_task_reminders();
      end if;
    exception when insufficient_privilege then v_failed := true;
    end;
    if not v_failed then
      raise exception 'FAIL: public.%() ran for an authenticated claim', fn;
    end if;
  end loop;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

rollback;
