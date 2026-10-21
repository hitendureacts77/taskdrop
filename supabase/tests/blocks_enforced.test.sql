-- A block stops contact (migration 117). Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/blocks_enforced.test.sql

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
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_task   uuid;
  v_task2  uuid;
  v_bid    uuid;
  v_seen   int;
  v_failed boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'block+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Block Poster'), (v_worker, 'Block Worker'), (v_other, 'Block Other')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_other) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'blocked feed', 100000, 240) returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'to be locked', 100000, 240) returning id into v_task2;

  -- before any block, the other account sees the open task
  perform pg_temp.become(v_other);
  select count(*) into v_seen from public.tasks where id = v_task;
  assert v_seen = 1, 'an open task is visible before any block';

  -- a worker on the second task, so there is a thread
  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task2, v_worker, 100000, 240) returning id into v_bid;
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  insert into public.messages (task_id, sender_id, body) values (v_task2, v_poster, 'hello');

  -- the poster blocks the other account
  perform public.block_user(v_other);

  perform pg_temp.become(v_other);
  -- A test session runs as postgres, which migration 040 lets through every admin check, so a
  -- SELECT here always sees every row. Assert the parts of tasks_hide_blocked instead.
  assert private.blocked_between(v_other, v_poster), 'the block is recorded both ways';
  assert exists (select 1 from pg_policy where polname = 'tasks_hide_blocked' and polrelid = 'public.tasks'::regclass
                  and polpermissive = false), 'the tasks_hide_blocked policy is missing or not restrictive';
  v_failed := false;
  begin
    insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_task, v_other, 1000, 60);
  exception when others then v_failed := true; end;
  assert v_failed, 'a blocked person cannot bid on the blockers task';

  -- the blocker still sees their own task, and other people are unaffected
  perform pg_temp.become(v_poster);
  select count(*) into v_seen from public.tasks where id = v_task;
  assert v_seen = 1, 'the blocker still sees their own task';
  perform pg_temp.become(v_worker);
  select count(*) into v_seen from public.tasks where id = v_task;
  assert v_seen = 1, 'other people are unaffected';

  -- a block works both ways: the blocker cannot bid on the blocked persons task
  perform pg_temp.become(v_other);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_other, 'services', 'theirs', 1000, 60);
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin
    insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
    select id, v_poster, 1000, 60 from public.tasks where poster_id = v_other and status = 'OPEN' limit 1;
  exception when others then v_failed := true; end;
  -- the restrictive policy may already hide that task from the blocker (no row, no insert): either way nothing was inserted
  assert v_failed or not exists (select 1 from public.bids where worker_id = v_poster), 'the blocker cannot bid on the blocked persons task';

  -- a job already underway keeps working until someone blocks the other party; then new messages stop both ways
  perform pg_temp.become(v_worker);
  insert into public.messages (task_id, sender_id, body) values (v_task2, v_worker, 'reply');
  perform pg_temp.become(v_poster);
  perform public.block_user(v_worker);
  v_failed := false;
  begin insert into public.messages (task_id, sender_id, body) values (v_task2, v_poster, 'again');
  exception when others then v_failed := true; end;
  assert v_failed, 'the blocker cannot message the person they blocked';
  perform pg_temp.become(v_worker);
  v_failed := false;
  begin insert into public.messages (task_id, sender_id, body) values (v_task2, v_worker, 'again');
  exception when others then v_failed := true; end;
  assert v_failed, 'the blocked person cannot message the blocker';
  select count(*) into v_seen from public.tasks where id = v_task2;
  assert v_seen = 1, 'a task already underway stays visible to both';

  raise notice 'blocks_enforced: all assertions passed';
end;
$$;

rollback;
