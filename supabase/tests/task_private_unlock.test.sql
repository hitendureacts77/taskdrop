-- The exact pin and typed address open to the hired worker only once the work starts (migration 173,
-- debug loop B60). Rolls back; leaves nothing.
--
-- A test session's session_user is postgres, which private.is_admin() lets through, so a SELECT on
-- task_private cannot show the worker's view here. The rule is checked through the helper the policy uses
-- and the policy's text (as private_task_address.test.sql does).
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/task_private_unlock.test.sql

begin;

do $$
declare
  v_poster   uuid := gen_random_uuid();
  v_worker   uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_task     uuid;
  v_bid      uuid;
  v_qual     text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'tpu+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_stranger)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'TPU Poster'), (v_worker, 'TPU Worker'), (v_stranger, 'TPU Stranger') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_stranger) on conflict (user_id) do nothing;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_label, loc_lat, loc_lng)
  values (v_poster, 'services', 'pin unlock', 100000, 240, 'Madhapur, Hyderabad', 17.4506, 78.3928)
  returning id into v_task;
  assert exists (select 1 from public.task_private where task_id = v_task), 'the exact pin is stored privately';

  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;

  -- Hired (offer locked) but not started: no exact pin yet.
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status)
  values (v_task, v_bid, v_worker, 103000, 'assigned');
  update public.tasks set status = 'LOCKED' where id = v_task;
  assert private.user_assigned_task(v_task, v_worker), 'the worker is assigned (tasks stay readable to them)';
  assert not private.user_working_task(v_task, v_worker), 'a locked offer does not open the exact pin';

  -- Work started: it opens, and stays open through the later stages.
  update public.assignments set status = 'started' where task_id = v_task;
  update public.tasks set status = 'TASK_STARTED' where id = v_task;
  assert private.user_working_task(v_task, v_worker), 'the worker reads the pin once work starts (directions)';
  update public.tasks set status = 'WORK_DONE' where id = v_task;
  assert private.user_working_task(v_task, v_worker), 'still open after the work is marked done';
  assert not private.user_working_task(v_task, v_stranger), 'a stranger never reads it';
  assert not private.user_working_task(v_task, null), 'nobody signed out reads it';

  -- Refunded off the job: the worker loses it.
  update public.assignments set status = 'refunded' where task_id = v_task;
  assert not private.user_working_task(v_task, v_worker), 'a refunded worker loses the exact pin';

  -- The policy: poster, admin, and the working worker (not every assignment row).
  select qual into v_qual from pg_policies
   where schemaname = 'public' and tablename = 'task_private' and policyname = 'task_private_parties_read';
  assert v_qual like '%user_working_task%', 'task_private_parties_read uses user_working_task';
  assert v_qual not like '%user_assigned_task%', 'task_private_parties_read no longer opens to any assignment row';
  assert v_qual like '%poster_id%' and v_qual like '%is_admin%', 'the poster and admins still read it';

  raise notice 'task_private_unlock: all assertions passed';
end;
$$;

rollback;
