-- A job's typed address is for the poster and the person hired (migration 126). Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/private_task_address.test.sql

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
  v_seen     text;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'pta+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_stranger)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'PTA Poster'), (v_worker, 'PTA Worker'), (v_stranger, 'PTA Stranger') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_stranger) on conflict (user_id) do nothing;

  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, loc_label, loc_lat, loc_lng)
  values (v_poster, 'services', 'private address', 100000, 240, 'Plumbing', 'Madhapur, Hyderabad', 17.4506, 78.3928)
  returning id into v_task;

  -- Only the poster can store the address.
  perform pg_temp.become(v_stranger);
  v_failed := false;
  begin perform public.set_task_address(v_task, 'Flat 402, Test Towers'); exception when others then v_failed := true; end;
  assert v_failed, 'a stranger cannot set a task''s address';
  perform pg_temp.become(v_worker);
  v_failed := false;
  begin perform public.set_task_address(v_task, 'Flat 402, Test Towers'); exception when others then v_failed := true; end;
  assert v_failed, 'a worker who is not hired cannot set it either';

  perform pg_temp.become(v_poster);
  perform public.set_task_address(v_task, '  Flat 402, Test Towers, Road 5  ');
  select address into v_seen from public.task_private where task_id = v_task;
  assert v_seen = 'Flat 402, Test Towers, Road 5', 'the poster reads their own address back, trimmed';
  v_failed := false;
  begin perform public.set_task_address(v_task, repeat('x', 401)); exception when others then v_failed := true; end;
  assert v_failed, 'an address is limited to 400 characters';

  -- The coordinates the trigger stored are still there, and a stranger sees no row.
  assert (select loc_lat from public.task_private where task_id = v_task) is not null, 'the exact coordinates are kept';
  -- A test session runs as postgres, which the policy's admin check lets through, so who can read the row is
  -- asserted from what the policy is built from (it is the one migration 074 wrote), not by a SELECT here. The
  -- live check is `BREAKIT=1 npx playwright test e2e/breakit.spec.ts` (a stranger reads no address).
  perform pg_temp.as_operator();
  assert exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_private' and cmd = 'SELECT'),
    'task_private keeps its read policy (poster, assigned worker, admin)';
  assert not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'task_private' and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')),
    'nobody can write task_private directly';

  -- Hired: the worker can read it.
  perform pg_temp.as_operator();
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (v_task, v_worker, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status) values (v_task, v_bid, v_worker, 103000, 'assigned');
  perform pg_temp.become(v_worker);
  select address into v_seen from public.task_private where task_id = v_task;
  assert v_seen = 'Flat 402, Test Towers, Road 5', 'the hired worker can read the address';

  -- Clearing it.
  perform pg_temp.become(v_poster);
  perform public.set_task_address(v_task, '   ');
  assert (select address from public.task_private where task_id = v_task) is null, 'a blank address clears it';
end;
$$;

rollback;
