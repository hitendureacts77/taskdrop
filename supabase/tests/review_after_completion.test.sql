-- A review needs finished work (migration 125). Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/review_after_completion.test.sql

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
  v_poster   uuid := gen_random_uuid();
  v_worker   uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_task     uuid;
  v_bid      uuid;
  v_failed   boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rac+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_stranger)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'RAC Poster'), (v_worker, 'RAC Worker'), (v_stranger, 'RAC Stranger') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_stranger) on conflict (user_id) do nothing;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category)
  values (v_poster, 'services', 'review after completion', 100000, 240, 'Plumbing') returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status)
  values (v_task, v_bid, v_worker, 103000, 'started');
  update public.tasks set status = 'TASK_STARTED' where id = v_task;

  -- Work started but not approved: neither side may review yet.
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin perform public.submit_review(v_task, 5::smallint, 'too early'); exception when others then v_failed := true; end;
  assert v_failed, 'the poster cannot review before the work is approved';
  perform pg_temp.become(v_worker);
  v_failed := false;
  begin perform public.submit_review(v_task, 5::smallint, 'too early'); exception when others then v_failed := true; end;
  assert v_failed, 'the worker cannot review before the work is approved';

  -- Delivered and waiting for approval is still too early.
  perform pg_temp.as_operator();
  update public.tasks set status = 'WORK_DONE' where id = v_task;
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin perform public.submit_review(v_task, 1::smallint, 'before approving'); exception when others then v_failed := true; end;
  assert v_failed, 'the poster cannot review while the work awaits approval';

  -- Approved: both sides may review, a stranger still may not, and a review can be edited.
  perform pg_temp.as_operator();
  update public.tasks set status = 'COMPLETED' where id = v_task;
  update public.assignments set status = 'released' where task_id = v_task;
  perform pg_temp.become(v_poster);
  perform public.submit_review(v_task, 5::smallint, 'great');
  perform public.submit_review(v_task, 4::smallint, 'edited');
  perform pg_temp.become(v_worker);
  perform public.submit_review(v_task, 5::smallint, 'clear brief');
  perform pg_temp.become(v_stranger);
  v_failed := false;
  begin perform public.submit_review(v_task, 1::smallint, 'troll'); exception when others then v_failed := true; end;
  assert v_failed, 'a stranger still cannot review';

  perform pg_temp.as_operator();
  assert (select count(*) from public.reviews where task_id = v_task) = 2, 'one review per side';
  assert (select rating from public.reviews where task_id = v_task and author_id = v_poster) = 4, 'the poster edited their own review';
  -- AUTO_COMPLETED counts as finished too.
  update public.tasks set status = 'AUTO_COMPLETED' where id = v_task;
  perform pg_temp.become(v_poster);
  perform public.submit_review(v_task, 3::smallint, 'auto-completed still reviewable');
end;
$$;

rollback;
