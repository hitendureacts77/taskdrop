-- Who can read and write a task's chat thread.
--
-- The app reveals contacts when a task starts, so the thread has to be visible
-- to exactly two people and nobody else. Runs inside a transaction it rolls
-- back, leaving no messages behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/chat_access.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

do $$
declare
  v_poster   uuid := gen_random_uuid();
  v_worker   uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_task     uuid;
  v_bid      uuid;
  v_seen     int;
  v_failed   boolean;
begin
  -- ---- fixtures ---------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'chat+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_stranger)) as u(id);

  insert into public.profiles (id, display_name)
  values (v_poster, 'Chat Poster'), (v_worker, 'Chat Worker'), (v_stranger, 'Chat Stranger')
  on conflict (id) do nothing;

  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_stranger)
  on conflict (user_id) do nothing;

  -- lock_bid funds the task from the poster's wallet (migration 063).
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Chat access test', 100000, 240)
  returning id into v_task;

  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);

  -- ---- both parties can post and read the thread ------------------------
  insert into public.messages (task_id, sender_id, body)
  values (v_task, v_poster, 'Are you still coming?');

  perform pg_temp.become(v_worker);
  insert into public.messages (task_id, sender_id, body)
  values (v_task, v_worker, 'On my way.');

  select count(*) into v_seen from public.messages where task_id = v_task;
  if v_seen <> 2 then
    raise exception 'FAIL: the worker sees % messages, expected 2', v_seen;
  end if;

  -- ---- nobody else can read it ------------------------------------------
  perform pg_temp.become(v_stranger);
  select count(*) into v_seen from public.messages where task_id = v_task;
  if v_seen <> 0 then
    raise exception 'FAIL: a stranger read % messages from the thread', v_seen;
  end if;

  -- ---- or write into it --------------------------------------------------
  v_failed := false;
  begin
    insert into public.messages (task_id, sender_id, body) values (v_task, v_stranger, 'let me in');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: a stranger posted into the thread';
  end if;

  -- ---- and a participant cannot forge the other one ----------------------
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    insert into public.messages (task_id, sender_id, body) values (v_task, v_worker, 'forged');
  exception when others then v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL: the poster sent a message as the worker';
  end if;

  raise notice 'ALL CHAT ACCESS TESTS PASSED';
end;
$$;

rollback;
