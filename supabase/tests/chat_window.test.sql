-- Migration 215 (plan 1.19 row B): chat only while a task is locked, for 48 hours after it is completed,
-- then the messages are deleted by the pg_cron job `chat-purge`.
--
-- What is asserted:
--   1. Nobody writes into the thread of a task that is still OPEN.
--   2. Poster and worker write while it is locked.
--   3. Both still write within 48 hours of completion; task_chat_states says 'closing'.
--   4. After 48 hours writing is refused; task_chat_states says 'closed' / 'window_ended'.
--   5. A cancelled task's thread is closed at once ('cancelled').
--   6. purge_ended_chats deletes the finished task's messages and its 'message' notifications,
--      keeps a live task's thread, and is a no-op the second time.
--   7. An open report on the task pauses deletion; once handled, deletion waits another 48 hours.
--   8. A DISPUTED task's thread is kept.
--   9. chat-purge is listed, scheduled through the wrapper, and has a dispatch case.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/chat_window.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('role', 'postgres', true);
  perform set_config('request.jwt.claims', '', true);
end;
$$;

create or replace function pg_temp.can_write(p_task uuid, p_user uuid) returns boolean
language plpgsql as $$
begin
  perform pg_temp.become(p_user);
  begin
    insert into public.messages (task_id, sender_id, body) values (p_task, p_user, 'hello there');
  exception when others then
    perform pg_temp.as_operator();
    return false;
  end;
  perform pg_temp.as_operator();
  return true;
end;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_task   uuid;
  v_live   uuid;
  v_bid    uuid;
  v_s      record;
  v_r      jsonb;
  v_report uuid;
begin
  -- ---- fixtures ---------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'chatwin+' || u.id || '@taskdrop.test', '', now(), now(), now()
    from (values (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name) values (v_poster, 'Window Poster'), (v_worker, 'Window Worker')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Chat window test', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;

  -- ---- 1. OPEN: closed ----------------------------------------------------------------------
  assert not pg_temp.can_write(v_task, v_poster), '1: the poster wrote into an OPEN task''s thread';
  perform pg_temp.become(v_poster);
  select * into v_s from public.task_chat_states(array[v_task]);
  assert v_s.state = 'closed' and v_s.reason = 'not_locked' and not v_s.can_send, '1: state of an OPEN task';

  -- ---- 2. locked: open ----------------------------------------------------------------------
  perform public.lock_bid(v_bid);
  perform pg_temp.as_operator();
  assert pg_temp.can_write(v_task, v_poster), '2: the poster cannot write on a locked task';
  assert pg_temp.can_write(v_task, v_worker), '2: the worker cannot write on a locked task';

  -- ---- 3. completed an hour ago: still open ---------------------------------------------------
  update public.assignments set status = 'released' where task_id = v_task;
  update public.tasks set status = 'COMPLETED', completed_at = now() - interval '1 hour' where id = v_task;
  assert pg_temp.can_write(v_task, v_worker), '3: the worker cannot write 1 hour after completion';
  perform pg_temp.become(v_worker);
  select * into v_s from public.task_chat_states(array[v_task]);
  assert v_s.state = 'closing' and v_s.can_send and v_s.closes_at > now(), '3: state inside the 48 hours';
  perform pg_temp.as_operator();

  -- ---- 4. completed 49 hours ago: closed ------------------------------------------------------
  update public.tasks set completed_at = now() - interval '49 hours' where id = v_task;
  assert not pg_temp.can_write(v_task, v_poster), '4: the poster wrote 49 hours after completion';
  assert not pg_temp.can_write(v_task, v_worker), '4: the worker wrote 49 hours after completion';
  perform pg_temp.become(v_poster);
  select * into v_s from public.task_chat_states(array[v_task]);
  assert v_s.state = 'closed' and v_s.reason = 'window_ended', '4: state after the 48 hours';
  -- reading still works until deletion
  assert (select count(*) from public.messages where task_id = v_task) >= 3, '4: the poster can no longer read the thread';
  perform pg_temp.as_operator();

  -- ---- 7. an open report pauses deletion ------------------------------------------------------
  insert into public.reports (reporter_id, target_type, target_id, reason)
  values (v_poster, 'task', v_task, 'test report') returning id into v_report;
  assert private.task_chat_purge_before(v_task) is null, '7: an open report must pause deletion';
  update public.reports set status = 'actioned', handled_at = now() - interval '1 hour' where id = v_report;
  assert private.task_chat_purge_before(v_task) is null, '7: deletion waits 48 hours after the report is handled';
  update public.reports set handled_at = now() - interval '49 hours' where id = v_report;
  assert private.task_chat_purge_before(v_task) = 'infinity'::timestamptz, '7: due 48 hours after the report was handled';

  -- ---- 8. a dispute pauses deletion -----------------------------------------------------------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, status)
  values (v_poster, 'services', 'Chat window live', 100000, 240, 'DISPUTED') returning id into v_live;
  insert into public.messages (task_id, sender_id, body, created_at) values (v_live, v_poster, 'what happened?', now() - interval '10 days');
  assert private.task_chat_purge_before(v_live) is null, '8: a DISPUTED task''s thread must be kept';

  -- ---- 6. the purge ---------------------------------------------------------------------------
  assert exists (select 1 from public.notifications where task_id = v_task and kind = 'message'), '6: fixture has a chat notice';
  v_r := private.purge_ended_chats(500);
  assert not exists (select 1 from public.messages where task_id = v_task), '6: the finished task''s messages are still there';
  assert not exists (select 1 from public.notifications where task_id = v_task and kind = 'message'), '6: the chat notices are still there';
  assert exists (select 1 from public.messages where task_id = v_live), '6: the disputed task''s thread was deleted';
  assert (v_r ->> 'messages')::int >= 3, '6: the run did not count the deleted messages: ' || v_r::text;
  v_r := private.purge_ended_chats(500);
  assert not exists (select 1 from public.messages where task_id = v_task), '6: second run';

  -- ---- 5. cancelled: closed at once -----------------------------------------------------------
  update public.tasks set status = 'CANCELLED' where id = v_live;
  perform pg_temp.become(v_poster);
  select * into v_s from public.task_chat_states(array[v_live]);
  assert v_s.state = 'closed' and v_s.reason = 'cancelled', '5: state of a cancelled task';
  perform pg_temp.as_operator();
  assert not pg_temp.can_write(v_live, v_poster), '5: the poster wrote on a cancelled task';

  -- ---- 9. the job -----------------------------------------------------------------------------
  assert exists (select 1 from private.cron_jobs where job = 'chat-purge'), '9: chat-purge is not listed';
  assert exists (select 1 from cron.job where jobname = 'chat-purge'
                    and command like '%private.run_cron_job(''chat-purge'')%'
                    and command like '%statement_timeout%'), '9: chat-purge is not scheduled through the wrapper';
  assert pg_get_functiondef('private.cron_dispatch(text)'::regprocedure) like '%when ''chat-purge'' then%', '9: no dispatch case';
  assert not has_function_privilege('authenticated', 'private.purge_ended_chats(integer)', 'execute'), '9: purge is open to authenticated';
  assert not has_function_privilege('anon', 'public.task_chat_states(uuid[])', 'execute'), '9: task_chat_states is open to anon';

  raise notice 'ALL CHAT WINDOW TESTS PASSED';
end;
$$;

rollback;
