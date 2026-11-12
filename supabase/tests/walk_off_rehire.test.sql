-- A worker who walked off, and a worker hired again (debug round 1: W2, W3, W4; migrations 167, 176).
--
-- W3: re-hiring a worker makes their assignment the newest again, so "the task's worker" lookups
--     (newest assignment) find them and not the worker who walked off in between.
-- W4: a re-hired or newly hired worker reads only the chat from the start of their own assignment;
--     the poster reads everything; a worker who walked off reads nothing.
-- W2: chat and task notices never reach a worker who walked off; the poster still hears who left.
--
-- Everything shares one transaction timestamp, so the test moves assignments and messages back in
-- time by hand (as the operator) to stand for the hours between the steps. Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/walk_off_rehire.test.sql

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

-- ---- 1. walk off, hire someone else, walk off, hire the first again ---------------------
do $$
declare
  v_poster uuid := gen_random_uuid();
  v_w1     uuid := gen_random_uuid();
  v_w2     uuid := gen_random_uuid();
  v_task   uuid;
  v_bid1   uuid;
  v_bid2   uuid;
  v_seen   int;
  v_newest uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rehire+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_w1), (v_w2)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Rehire Poster'), (v_w1, 'Rehire One'), (v_w2, 'Rehire Two')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_w1), (v_w2) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Rehire test', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_w1, 100000, 240) returning id into v_bid1;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_w2, 90000, 240) returning id into v_bid2;

  -- W1 hired (two hours ago), says something, walks off.
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid1);
  perform pg_temp.as_operator();
  update public.assignments set created_at = now() - interval '2 hours' where task_id = v_task and worker_id = v_w1;
  perform pg_temp.become(v_w1);
  insert into public.messages (task_id, sender_id, body) values (v_task, v_w1, 'first worker line');
  perform pg_temp.as_operator();
  update public.messages set created_at = now() - interval '110 minutes' where task_id = v_task and sender_id = v_w1;
  perform pg_temp.become(v_w1);
  perform public.cancel_task(v_task);

  -- W2 hired (an hour ago); the poster sends an address; W2 walks off.
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid2);
  perform pg_temp.as_operator();
  update public.assignments set created_at = now() - interval '1 hour' where task_id = v_task and worker_id = v_w2;
  perform pg_temp.become(v_poster);
  insert into public.messages (task_id, sender_id, body) values (v_task, v_poster, 'second worker thread: the gate code');
  perform pg_temp.as_operator();
  update public.messages set created_at = now() - interval '30 minutes'
   where task_id = v_task and body like 'second worker thread%';
  perform pg_temp.become(v_w2);
  perform public.cancel_task(v_task);
  -- W2 rightly heard about that message while hired; clear it so the check below is about what follows.
  perform pg_temp.as_operator();
  delete from public.notifications where user_id = v_w2 and task_id = v_task and kind = 'message';

  -- W1 hired again, now.
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid1);
  insert into public.messages (task_id, sender_id, body) values (v_task, v_poster, 'welcome back');

  -- ---- W3: the re-hired worker is the newest assignment again ----------------------------
  perform pg_temp.as_operator();
  select a.worker_id into v_newest from public.assignments a
   where a.task_id = v_task order by a.created_at desc limit 1;
  assert v_newest = v_w1, 'W3: the re-hired worker must be the newest assignment, not the one who walked off';
  assert private.task_worker(v_task) = v_w1, 'W3: private.task_worker must name the re-hired worker';
  assert private.task_live_worker(v_task) = v_w1, 'W2: the live worker is the re-hired one';

  -- ---- W4: who reads which messages -----------------------------------------------------
  perform pg_temp.become(v_poster);
  select count(*) into v_seen from public.messages where task_id = v_task;
  assert v_seen = 3, format('W4: the poster must read the whole thread, saw %s of 3', v_seen);

  perform pg_temp.become(v_w1);
  select count(*) into v_seen from public.messages where task_id = v_task;
  assert v_seen = 1, format('W4: the re-hired worker must read only the messages since their hire, saw %s', v_seen);
  select count(*) into v_seen from public.messages where task_id = v_task and body like 'second worker thread%';
  assert v_seen = 0, 'W4: the re-hired worker must not read the previous worker''s thread';

  perform pg_temp.become(v_w2);
  select count(*) into v_seen from public.messages where task_id = v_task;
  assert v_seen = 0, format('W4: a worker who walked off must read nothing, saw %s', v_seen);

  -- ---- W2: the poster's next message reaches only the re-hired worker ---------------------
  perform pg_temp.as_operator();
  assert exists (select 1 from public.notifications n
                  where n.user_id = v_w1 and n.task_id = v_task and n.kind = 'message'),
    'W2: the re-hired worker hears the poster''s message';
  assert not exists (select 1 from public.notifications n
                      where n.user_id = v_w2 and n.task_id = v_task and n.kind = 'message'),
    'W2: the worker who walked off must not get the poster''s chat lines';

  raise notice 'walk_off_rehire part 1 passed';
end;
$$;

-- ---- 2. walked off, task still open: no notices to the worker who left ------------------
do $$
declare
  v_poster uuid := gen_random_uuid();
  v_w      uuid := gen_random_uuid();
  v_task   uuid;
  v_bid    uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rehire+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_w)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Leaver Poster'), (v_w, 'Ravi Kumar') on conflict (id) do nothing;
  update public.profiles set display_name = 'Ravi Kumar' where id = v_w;
  insert into public.wallets (user_id) values (v_poster), (v_w) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Leaver test', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_w, 100000, 240) returning id into v_bid;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  perform pg_temp.become(v_w);
  perform public.cancel_task(v_task);

  perform pg_temp.as_operator();
  assert exists (select 1 from public.notifications n
                  where n.user_id = v_poster and n.task_id = v_task and n.kind = 'reopened'
                    and n.title = 'Ravi left your task'),
    'W2: the poster still hears which worker left';
  assert private.task_live_worker(v_task) is null, 'W2: nobody is the live worker after a walk-off';

  -- The poster writes into the open task's thread, then cancels it.
  perform pg_temp.become(v_poster);
  insert into public.messages (task_id, sender_id, body) values (v_task, v_poster, 'are you coming back?');
  perform public.cancel_task(v_task);

  perform pg_temp.as_operator();
  assert not exists (select 1 from public.notifications n
                      where n.user_id = v_w and n.task_id = v_task and n.kind in ('message', 'cancelled')),
    'W2: a worker who walked off gets neither the poster''s chat line nor the cancel notice';
  assert exists (select 1 from public.notifications n
                  where n.user_id = v_poster and n.task_id = v_task and n.kind = 'cancelled'),
    'the poster is still told the task was cancelled';

  raise notice 'walk_off_rehire part 2 passed';
end;
$$;

rollback;
