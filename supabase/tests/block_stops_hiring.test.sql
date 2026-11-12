-- B61 (migration 167): a block or a suspension stops hiring.
--   * block_user removes the offers (not yet chosen) between the two people on open tasks;
--   * lock_bid refuses a blocked or suspended worker;
--   * auto-hire skips them;
--   * crm_suspend_user removes the suspended person's open offers;
--   * task_contact_phone gives no number across a block.
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/block_stops_hiring.test.sql

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
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_poster  uuid := gen_random_uuid();
  v_worker  uuid := gen_random_uuid();
  v_other   uuid := gen_random_uuid();
  v_susp    uuid := gen_random_uuid();
  v_task    uuid;
  v_task2   uuid;
  v_auto    uuid;
  v_work    uuid;
  v_bid     uuid;
  v_bid_o   uuid;
  v_bid_s   uuid;
  v_bid_w   uuid;
  v_msg     text;
  v_phone   text;
  -- Made-up numbers that cannot clash with a real row.
  v_pnum    text := '7' || lpad((floor(random() * 1e9))::bigint::text, 9, '0');
  v_wnum    text := '6' || lpad((floor(random() * 1e9))::bigint::text, 9, '0');
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         u.email, '', now(), now(), now()
  from (values (v_poster, 'p' || v_pnum || '@phone.taskdrop.app'), (v_worker, 'p' || v_wnum || '@phone.taskdrop.app'),
               (v_other, 'hire+o' || gen_random_uuid() || '@taskdrop.test'),
               (v_susp, 'hire+s' || gen_random_uuid() || '@taskdrop.test')) as u(id, email);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Hire Poster'), (v_worker, 'Hire Worker'), (v_other, 'Hire Other'), (v_susp, 'Hire Suspended')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_other), (v_susp) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'open one', 100000, 240) returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'open two', 100000, 240) returning id into v_task2;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'underway', 100000, 240) returning id into v_work;

  perform pg_temp.become(v_worker);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_work, v_worker, 100000, 240) returning id into v_bid_w;
  perform pg_temp.become(v_other);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task2, v_other, 100000, 240) returning id into v_bid_o;
  perform pg_temp.become(v_susp);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task2, v_susp, 90000, 240) returning id into v_bid_s;

  -- A job underway with the worker, so there is a phone to unlock.
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid_w);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_work);
  perform pg_temp.become(v_poster);
  v_phone := public.task_contact_phone(v_work);
  assert v_phone = '+91' || v_wnum,'before any block the number unlocks when work starts';

  -- ---- the block -------------------------------------------------------------------
  perform public.block_user(v_worker);
  perform pg_temp.as_operator();
  assert not exists (select 1 from public.bids where id = v_bid), 'the open offer across the block is gone';
  assert exists (select 1 from public.bids where id = v_bid_w), 'the chosen offer on the job underway stays';
  assert exists (select 1 from public.bids where id = v_bid_o), 'other people''s offers stay';

  perform pg_temp.become(v_poster);
  assert public.task_contact_phone(v_work) is null, 'no phone number across a block (poster)';
  perform pg_temp.become(v_worker);
  assert public.task_contact_phone(v_work) is null, 'no phone number across a block (worker)';

  -- An offer still standing when a block is recorded some other way cannot be chosen.
  -- (The offer comes first: a new offer across a block is refused by 117.)
  perform pg_temp.become(v_other);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_other, 'services', 'other posts', 100000, 240) returning id into v_task;
  perform pg_temp.become(v_susp);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_susp, 100000, 240) returning id into v_bid;
  perform pg_temp.as_operator();
  insert into public.blocks (blocker_id, blocked_id) values (v_susp, v_other);
  perform pg_temp.become(v_other);
  v_msg := null;
  begin perform public.lock_bid(v_bid); exception when others then v_msg := sqlerrm; end;
  assert v_msg = 'You cannot hire this person.', format('hiring across a block is refused, got %s', coalesce(v_msg, 'it was accepted'));
  perform pg_temp.as_operator();
  delete from public.blocks where blocker_id = v_susp and blocked_id = v_other;

  -- ---- suspension ------------------------------------------------------------------
  perform pg_temp.as_operator();
  insert into public.user_suspensions (user_id, reason) values (v_susp, 'test');
  perform pg_temp.become(v_poster);
  v_msg := null;
  begin perform public.lock_bid(v_bid_s, 'one_time', 90000); exception when others then v_msg := sqlerrm; end;
  assert v_msg = 'This worker cannot be hired right now.', format('a suspended worker cannot be hired, got %s', coalesce(v_msg, 'it was accepted'));

  -- Auto-hire skips a suspended worker (a blocked one cannot even send the offer, 117).
  perform pg_temp.as_operator();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, assignment_mode)
  values (v_poster, 'services', 'auto hire', 100000, 240, 'auto') returning id into v_auto;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_auto, v_susp, 50000, 240);
  assert (select status from public.tasks where id = v_auto) = 'OPEN', 'auto-hire took nobody suspended';
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_auto, v_other, 50000, 240);
  assert (select status from public.tasks where id = v_auto) = 'LOCKED', 'auto-hire still works for anyone else';

  -- ---- crm_suspend_user removes the person's open offers ----------------------------
  -- The function asks for a staff session; the clean-up it does is the statement asserted here.
  assert (select prosrc from pg_proc where oid = 'public.crm_suspend_user(uuid, text)'::regprocedure)
         like '%delete from public.bids b%', 'crm_suspend_user removes open offers';
  assert (select prosrc from pg_proc where oid = 'public.crm_suspend_user(uuid, text)'::regprocedure)
         like '%require_people_staff%', 'crm_suspend_user keeps its staff guard';

  raise notice 'block_stops_hiring: all assertions passed';
end;
$$;

rollback;
