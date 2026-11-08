-- One offer per worker per task (migration 159).
--
--   * a worker can send one offer on a task; a second one is refused;
--   * the worker can change it while the task is open, and cannot delete it;
--   * once the task is no longer open the offer cannot be changed (the chosen offer is locked by the owner's functions);
--   * the same worker can still offer on a different task;
--   * TaskDrop's own side (owner) can still delete a task, which removes its offers;
--   * the unique rule on (task_id, worker_id) exists;
--   * hire side: a worker with an open service listing can be given the first 10 minutes of a task by a poster
--     who never hired them, unless they are blocked; a stranger with no listing is still refused.
--
-- Fresh made-up people (Asha poster, Ravi and Meera workers, Kiran a stranger) so no seed rows are needed.
-- One transaction, rolled back, so no rows are left behind.
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/one_quote_per_task.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated', 'aal', 'aal1')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

do $$
declare
  v_asha   uuid := gen_random_uuid();
  v_ravi   uuid := gen_random_uuid();
  v_meera  uuid := gen_random_uuid();
  v_kiran  uuid := gen_random_uuid();
  v_task   uuid;
  v_task2  uuid;
  v_listing uuid;
  v_bid    uuid;
  v_price  bigint;
  v_err    text;
  v_row    public.tasks;
begin
  -- ---- people ---------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'onequote159+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_asha), (v_ravi), (v_meera), (v_kiran)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_asha, 'Asha'), (v_ravi, 'Ravi'), (v_meera, 'Meera'), (v_kiran, 'Kiran')
  on conflict (id) do update set display_name = excluded.display_name;
  insert into public.wallets (user_id) values (v_asha), (v_ravi), (v_meera), (v_kiran) on conflict (user_id) do nothing;

  -- ---- the rule exists ------------------------------------------------------------------------
  if not exists (
    select 1 from pg_index i
     where i.indrelid = 'public.bids'::regclass and i.indisunique and i.indpred is null and i.indnatts = 2
       and (select array_agg(a.attname::text order by a.attname) from pg_attribute a
             where a.attrelid = i.indrelid and a.attnum = any (i.indkey)) = array['task_id', 'worker_id']
  ) then
    raise exception 'FAIL: bids has no unique rule on (task_id, worker_id)';
  end if;

  -- ---- two open requests by Asha ----------------------------------------------------------------
  perform pg_temp.become(v_asha);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_asha, 'services', 'Fix the tap', 100000, 120) returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_asha, 'services', 'Paint the gate', 100000, 120) returning id into v_task2;

  -- ---- one offer, never a second ------------------------------------------------------------------
  perform pg_temp.become(v_ravi);
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, message)
  values (v_task, v_ravi, 90000, 60, 'first') returning id into v_bid;
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 80000, 60)', v_task, v_ravi));
  if v_err is null or v_err not ilike '%duplicate%' then
    raise exception 'FAIL: a second offer on the same task must be refused, got %', v_err;
  end if;

  -- ---- editing while open works ------------------------------------------------------------------
  v_err := pg_temp.try(format('update public.bids set price_minor = 85000, message = ''changed'' where id = %L', v_bid));
  if v_err is not null then raise exception 'FAIL: editing an offer while the task is open was refused: %', v_err; end if;
  select price_minor into v_price from public.bids where id = v_bid;
  if v_price <> 85000 then raise exception 'FAIL: the edit did not change the price, got %', v_price; end if;

  -- ---- deleting through the data API is refused --------------------------------------------------
  v_err := pg_temp.try(format('delete from public.bids where id = %L', v_bid));
  if v_err is null or v_err not like '%cannot be taken back%' then
    raise exception 'FAIL: an app user must not be able to delete an offer, got %', v_err;
  end if;
  if not exists (select 1 from public.bids where id = v_bid) then
    raise exception 'FAIL: the offer disappeared';
  end if;

  -- ---- the same worker can offer on a different task ----------------------------------------------
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 70000, 60)', v_task2, v_ravi));
  if v_err is not null then raise exception 'FAIL: an offer on a second task was refused: %', v_err; end if;

  -- ---- once the task is no longer open, the offer cannot change ----------------------------------
  perform pg_temp.as_owner();
  update public.tasks set status = 'LOCKED' where id = v_task;
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format('update public.bids set price_minor = 60000 where id = %L', v_bid));
  if v_err is null or v_err not like '%no longer taking offers%' then
    raise exception 'FAIL: editing an offer on a task that is not open must be refused, got %', v_err;
  end if;
  select price_minor into v_price from public.bids where id = v_bid;
  if v_price <> 85000 then raise exception 'FAIL: the price changed on a task that is not open, got %', v_price; end if;

  perform pg_temp.as_owner();
  update public.tasks set status = 'OPEN' where id = v_task;
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format('update public.bids set price_minor = 80000 where id = %L', v_bid));
  if v_err is not null then raise exception 'FAIL: editing worked before and must work again once the task is open: %', v_err; end if;

  -- ---- TaskDrop's own side still removes offers --------------------------------------------------
  perform pg_temp.as_owner();
  delete from public.tasks where id = v_task2;
  if exists (select 1 from public.bids where task_id = v_task2) then
    raise exception 'FAIL: deleting a task must remove its offers';
  end if;
  delete from public.bids where id = v_bid;
  if exists (select 1 from public.bids where id = v_bid) then
    raise exception 'FAIL: the owner must still be able to delete an offer';
  end if;

  -- ---- hire side: first look for a worker with an open service listing ----------------------------
  -- Asha has never hired Meera or Kiran. Kiran has no listing.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, kind)
  values (v_meera, 'services', 'Tap and pipe repairs', 30000, 60, 'service') returning id into v_listing;

  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, preferred_worker_id)'
    || ' values (%L, ''services'', ''Fix the sink'', 50000, 60, %L)', v_asha, v_kiran));
  if v_err is null or v_err not like '%only to someone you hired before%' then
    raise exception 'FAIL: a stranger with no listing must still be refused, got %', v_err;
  end if;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, preferred_worker_id)
  values (v_asha, 'services', 'Fix the sink', 50000, 60, v_meera) returning * into v_row;
  if v_row.preferred_worker_id is distinct from v_meera or v_row.preferred_until is null
     or v_row.preferred_until > now() + interval '11 minutes' then
    raise exception 'FAIL: a worker with a listing must get the first 10 minutes, got % until %', v_row.preferred_worker_id, v_row.preferred_until;
  end if;

  -- Inside the window only Meera may offer.
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 45000, 60)', v_row.id, v_ravi));
  if v_err is null then raise exception 'FAIL: Ravi must wait while Meera has the first look'; end if;
  perform pg_temp.become(v_meera);
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 45000, 60)', v_row.id, v_meera));
  if v_err is not null then raise exception 'FAIL: Meera could not offer in her own first look: %', v_err; end if;

  -- A block either way closes the door again.
  perform pg_temp.as_owner();
  insert into public.blocks (blocker_id, blocked_id) values (v_meera, v_asha);
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, preferred_worker_id)'
    || ' values (%L, ''services'', ''Fix the sink again'', 50000, 60, %L)', v_asha, v_meera));
  if v_err is null or v_err not like '%only to someone you hired before%' then
    raise exception 'FAIL: a blocked pair must not get a first look, got %', v_err;
  end if;
end;
$$;

rollback;

select 'one_quote_per_task: ok' as result;
