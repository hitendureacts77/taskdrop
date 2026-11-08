-- People map (migration 159, plan D20, docs/design/map-tab/PLAN.md).
--
-- A person's rounded spot is seen only by the people they have finished a task with, and only while they
-- chose to share. Asserted against the real grants, policies, functions and trigger:
--   1. a sharer's spot reaches the right person as the grid cell, never as the coordinates sent
--   2. a stranger sees nothing, and an unfinished task does not make two people "my people"
--   3. a block in either direction hides the spot
--   4. an expired spot is hidden, and the next beat brings it back
--   5. turning sharing off deletes the spot at once ("Hide me now" does too)
--   6. the signed-out role cannot call any of the new functions; nobody can read map_spots directly
--   7. someone under 18 (or with no age check) cannot switch sharing on
--   8. closing an account (soft delete) removes the spot and ends sharing
--   9. the beat throttle: a repeat from the same cell inside 50 seconds changes nothing
--  10. the other side of a task counts too (the hired worker sees the poster), the radius is honoured,
--      bad input is refused or ignored
--
-- Everything runs inside one transaction that is rolled back, so the test leaves no rows behind. (One
-- transaction means now() never moves, so the test sets times on the rows itself.)
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/people_map.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.become_signed_out() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.become_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'anon')::text, true);
  perform set_config('role', 'anon', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

-- Runs a statement; returns the error message, or null when it worked.
create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- A task between two people, left in the given state. Returns the task id.
create or replace function pg_temp.job(p_poster uuid, p_worker uuid, p_status text) returns uuid
language plpgsql as $$
declare
  v_task uuid;
  v_bid  uuid;
begin
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (p_poster, 'services', 'people map fixture', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, p_worker, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status)
  values (v_task, v_bid, p_worker,
          103000, case when p_status in ('COMPLETED', 'AUTO_COMPLETED') then 'released' else 'started' end::public.assignment_status);
  update public.tasks set status = p_status::public.task_status where id = v_task;
  return v_task;
end;
$$;

-- How many of the caller's people the map returns, optionally only the given person. Centre: Bengaluru.
create or replace function pg_temp.seen(p_who uuid default null, p_lat double precision default 12.97,
                                        p_lng double precision default 77.59, p_km double precision default 10)
returns integer language sql as $$
  select count(*)::integer from public.map_my_people(p_lat, p_lng, p_km) m where p_who is null or m.id = p_who
$$;

create temp table fx (k text primary key, v text);
grant all on fx to public;

-- ---- fixture ---------------------------------------------------------------------------------------
--   A  the viewer.   B  finished two tasks with A (A posted) and shares.   C  a stranger to A.
--   D  a minor.      E  posted a task A was hired for.                      F  has no age check at all.
--   G  has an unfinished task with A only.
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_d uuid := gen_random_uuid();
  v_e uuid := gen_random_uuid();
  v_f uuid := gen_random_uuid();
  v_g uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'pmap+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_a), (v_b), (v_c), (v_d), (v_e), (v_f), (v_g)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_a, 'Pmap A'), (v_b, 'Pmap B'), (v_c, 'Pmap C'), (v_d, 'Pmap D'),
         (v_e, 'Pmap E'), (v_f, 'Pmap F'), (v_g, 'Pmap G')
  on conflict (id) do update set display_name = excluded.display_name;
  insert into public.wallets (user_id)
  values (v_a), (v_b), (v_c), (v_d), (v_e), (v_f), (v_g) on conflict (user_id) do nothing;

  -- age gate: everyone but D and F is an adult (onboarding itself needs a passed check)
  insert into public.age_checks (user_id, birth_date, passed, min_age)
  select u.id, date '1990-01-01', true, 18 from (values (v_a), (v_b), (v_c), (v_e), (v_g)) as u(id)
  on conflict (user_id) do update set passed = true;
  insert into public.age_checks (user_id, birth_date, passed, min_age)
  values (v_d, (current_date - interval '15 years')::date, false, 18)
  on conflict (user_id) do update set passed = false;
  update public.profiles set onboarded_at = coalesce(onboarded_at, now()), deleted_at = null
   where id in (v_a, v_b, v_c, v_e, v_g);

  -- finished tasks: A posted two that B did (one auto-completed), E posted one that A did
  perform pg_temp.job(v_a, v_b, 'COMPLETED');
  perform pg_temp.job(v_a, v_b, 'AUTO_COMPLETED');
  perform pg_temp.job(v_e, v_a, 'COMPLETED');
  -- not finished: does not make G one of A's people
  perform pg_temp.job(v_a, v_g, 'TASK_STARTED');

  insert into fx values ('a', v_a::text), ('b', v_b::text), ('c', v_c::text), ('d', v_d::text),
                        ('e', v_e::text), ('f', v_f::text), ('g', v_g::text);
end;
$$;

-- ---- 6. who may call what, and the table cannot be read -------------------------------------------
do $$
declare
  v_a   uuid := (select v::uuid from fx where k = 'a');
  v_fns text[] := array[
    'map_sharing_set(boolean,text)', 'map_spot_beat(double precision,double precision)',
    'map_spot_clear()', 'map_my_people(double precision,double precision,double precision)'];
  v_fn  text;
  v_err text;
begin
  foreach v_fn in array v_fns loop
    if has_function_privilege('anon', ('public.' || v_fn)::regprocedure, 'execute') then
      raise exception 'FAIL: the signed-out role can execute public.%', v_fn;
    end if;
    if not has_function_privilege('authenticated', ('public.' || v_fn)::regprocedure, 'execute') then
      raise exception 'FAIL: signed-in people cannot execute public.%', v_fn;
    end if;
  end loop;
  if has_function_privilege('authenticated', 'private.snap_cell(double precision)'::regprocedure, 'execute')
     or has_function_privilege('authenticated', 'private.map_forget_closed()'::regprocedure, 'execute') then
    raise exception 'FAIL: signed-in people can execute a private people-map helper';
  end if;

  -- grants: nothing for the signed-out role; signed-in people cannot touch map_spots at all and only read map_sharing
  if has_table_privilege('anon', 'public.map_spots', 'select,insert,update,delete')
     or has_table_privilege('anon', 'public.map_sharing', 'select,insert,update,delete') then
    raise exception 'FAIL: the signed-out role holds rights on a people-map table';
  end if;
  if has_any_column_privilege('authenticated', 'public.map_spots', 'select,insert,update,references') then
    raise exception 'FAIL: signed-in people hold rights on map_spots';
  end if;
  if has_table_privilege('authenticated', 'public.map_sharing', 'insert,update,delete') then
    raise exception 'FAIL: signed-in people can write map_sharing directly';
  end if;
  if not (select relrowsecurity from pg_class where oid = 'public.map_spots'::regclass)
     or not (select relrowsecurity from pg_class where oid = 'public.map_sharing'::regclass) then
    raise exception 'FAIL: row rules are off on a people-map table';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'map_spots') then
    raise exception 'FAIL: map_spots has a policy; it must have none';
  end if;

  -- the real calls fail the same way
  perform pg_temp.become_anon();
  v_err := pg_temp.try('select public.map_spot_clear()');
  if v_err is null or v_err not ilike '%permission denied%' then
    raise exception 'FAIL: the signed-out role called map_spot_clear, got %', v_err;
  end if;
  v_err := pg_temp.try('select * from public.map_my_people(12.97, 77.59, 10)');
  if v_err is null or v_err not ilike '%permission denied%' then
    raise exception 'FAIL: the signed-out role called map_my_people, got %', v_err;
  end if;
  v_err := pg_temp.try('select * from public.map_spots');
  if v_err is null or v_err not ilike '%permission denied%' then
    raise exception 'FAIL: the signed-out role read map_spots, got %', v_err;
  end if;

  perform pg_temp.become(v_a);
  v_err := pg_temp.try('select * from public.map_spots');
  if v_err is null or v_err not ilike '%permission denied%' then
    raise exception 'FAIL: a signed-in person read map_spots, got %', v_err;
  end if;
  v_err := pg_temp.try('insert into public.map_spots (user_id, cell_lat, cell_lng, expires_at) values (''' || v_a || ''', 1, 1, now())');
  if v_err is null or v_err not ilike '%permission denied%' then
    raise exception 'FAIL: a signed-in person wrote map_spots, got %', v_err;
  end if;
  v_err := pg_temp.try('update public.map_sharing set share_live = true');
  if v_err is null or v_err not ilike '%permission denied%' then
    raise exception 'FAIL: a signed-in person wrote map_sharing, got %', v_err;
  end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 7. adults only; bad input -----------------------------------------------------------------------
do $$
declare
  v_a   uuid := (select v::uuid from fx where k = 'a');
  v_d   uuid := (select v::uuid from fx where k = 'd');
  v_f   uuid := (select v::uuid from fx where k = 'f');
  v_err text;
begin
  perform pg_temp.become(v_d);
  v_err := pg_temp.try('select public.map_sharing_set(true, ''v1'')');
  if v_err is null or v_err not ilike '%adults%' then
    raise exception 'FAIL: someone under 18 switched sharing on, got %', v_err;
  end if;
  perform pg_temp.become(v_f);
  v_err := pg_temp.try('select public.map_sharing_set(true, ''v1'')');
  if v_err is null or v_err not ilike '%adults%' then
    raise exception 'FAIL: someone with no age check switched sharing on, got %', v_err;
  end if;
  -- a beat from either is ignored
  perform public.map_spot_beat(12.97, 77.59);

  -- not signed in at all
  perform pg_temp.become_signed_out();
  v_err := pg_temp.try('select public.map_sharing_set(true, ''v1'')');
  if v_err is null or v_err not ilike '%sign in%' then
    raise exception 'FAIL: switching on with no sign-in must be refused, got %', v_err;
  end if;
  if pg_temp.seen() <> 0 then
    raise exception 'FAIL: a call with no signed-in person returned people';
  end if;

  -- a notice version that is not "v<number>" is refused
  perform pg_temp.become(v_a);
  v_err := pg_temp.try('select public.map_sharing_set(true, ''v1; drop table x'')');
  if v_err is null or v_err not ilike '%notice%' then
    raise exception 'FAIL: a bad notice version was accepted, got %', v_err;
  end if;
  v_err := pg_temp.try('select public.map_sharing_set(null, ''v1'')');
  if v_err is null then
    raise exception 'FAIL: a null on/off choice was accepted';
  end if;

  perform pg_temp.as_owner();
  if exists (select 1 from public.map_sharing where user_id in (v_a, v_d, v_f) and share_live)
     or exists (select 1 from public.map_spots where user_id in (v_a, v_d, v_f)) then
    raise exception 'FAIL: a refused switch-on left a sharing row or a spot behind';
  end if;
end;
$$;

-- ---- 1 and 2. the cell, and strangers --------------------------------------------------------------
do $$
declare
  v_a uuid := (select v::uuid from fx where k = 'a');
  v_b uuid := (select v::uuid from fx where k = 'b');
  v_c uuid := (select v::uuid from fx where k = 'c');
  v_g uuid := (select v::uuid from fx where k = 'g');
  v_row record;
  v_cons record;
begin
  -- nobody has agreed yet: A sees no one, whoever beats
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.97163, 77.59461);
  perform pg_temp.as_owner();
  if exists (select 1 from public.map_spots where user_id = v_b) then
    raise exception 'FAIL: a spot was stored for someone who had not agreed to share';
  end if;
  perform pg_temp.become(v_a);
  if pg_temp.seen() <> 0 then
    raise exception 'FAIL: A saw people before anyone shared';
  end if;

  -- B agrees; the choice is recorded with the notice and the time
  perform pg_temp.become(v_b);
  perform public.map_sharing_set(true, 'v1');
  select * into v_cons from public.map_sharing where user_id = v_b;     -- B may read their own row
  if not v_cons.share_live or v_cons.notice_version <> 'v1' or v_cons.consented_at is null or v_cons.withdrawn_at is not null then
    raise exception 'FAIL: B''s consent was not recorded, got %', v_cons;
  end if;
  perform pg_temp.become(v_a);
  if exists (select 1 from public.map_sharing where user_id = v_b) then
    raise exception 'FAIL: A can read B''s sharing row';
  end if;

  -- B beats with a precise spot: 12.97163 / 77.59461 sit in the cell centred 12.970 / 77.595
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.97163, 77.59461);
  perform pg_temp.as_owner();
  select * into v_row from public.map_spots where user_id = v_b;
  if v_row.cell_lat is null or abs(v_row.cell_lat - 12.970) > 1e-9 or abs(v_row.cell_lng - 77.595) > 1e-9 then
    raise exception 'FAIL: the stored spot is not the cell centre, got % / %', v_row.cell_lat, v_row.cell_lng;
  end if;
  if v_row.expires_at < now() + interval '14 minutes' or v_row.expires_at > now() + interval '16 minutes' then
    raise exception 'FAIL: the spot should expire about 15 minutes out, got %', v_row.expires_at;
  end if;

  -- A sees B at the cell, not at the coordinates B sent, with the two finished jobs counted
  perform pg_temp.become(v_a);
  select * into v_row from public.map_my_people(12.97, 77.59, 10) m where m.id = v_b;
  if v_row.id is null then
    raise exception 'FAIL: A (who finished tasks with B) cannot see B''s shared spot';
  end if;
  if abs(v_row.lat - 12.970) > 1e-9 or abs(v_row.lng - 77.595) > 1e-9 then
    raise exception 'FAIL: A was shown % / %, not the cell centre', v_row.lat, v_row.lng;
  end if;
  if v_row.lat = 12.97163 or v_row.lng = 77.59461 then
    raise exception 'FAIL: the exact coordinates reached another person';
  end if;
  if v_row.jobs <> 2 or v_row.display_name <> 'Pmap B' or v_row.spot_at is null or v_row.km is null or v_row.km > 2 then
    raise exception 'FAIL: B''s row is wrong: %', v_row;
  end if;

  -- a spot sent from far off the grid is snapped the same way (negative longitude, south latitude)
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.9999, 77.5999);        -- 12.9999/0.005 = 2599.98 -> 2600 -> 13.000; 77.5999 -> 15520 -> 77.600
  perform pg_temp.as_owner();
  update public.map_spots set updated_at = now() - interval '2 minutes' where user_id = v_b;  -- past the throttle
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.9999, 77.5999);
  perform pg_temp.as_owner();
  select * into v_row from public.map_spots where user_id = v_b;
  if abs(v_row.cell_lat - 13.000) > 1e-9 or abs(v_row.cell_lng - 77.600) > 1e-9 then
    raise exception 'FAIL: a second spot snapped wrongly, got % / %', v_row.cell_lat, v_row.cell_lng;
  end if;
  -- put B back where the later checks expect
  update public.map_spots set cell_lat = 12.970, cell_lng = 77.595 where user_id = v_b;

  -- C is a stranger to A and to B; G has only an unfinished task with A. Both share, neither shows.
  perform pg_temp.as_owner();
  insert into public.map_sharing (user_id, share_live, notice_version, consented_at)
  values (v_c, true, 'v1', now()), (v_g, true, 'v1', now()) on conflict (user_id) do update set share_live = true;
  insert into public.map_spots (user_id, cell_lat, cell_lng, expires_at)
  values (v_c, 12.970, 77.595, now() + interval '10 minutes'), (v_g, 12.975, 77.595, now() + interval '10 minutes')
  on conflict (user_id) do update set expires_at = excluded.expires_at;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_c) <> 0 then raise exception 'FAIL: A saw a stranger''s spot'; end if;
  if pg_temp.seen(v_g) <> 0 then raise exception 'FAIL: A saw the spot of someone whose task is not finished'; end if;
  if pg_temp.seen() <> 1 then raise exception 'FAIL: A should see exactly B, saw %', pg_temp.seen(); end if;
  perform pg_temp.become(v_c);
  if pg_temp.seen() <> 0 then raise exception 'FAIL: a stranger saw a spot (C sees nobody; B and A are not C''s people)'; end if;
  perform pg_temp.become(v_g);
  if pg_temp.seen() <> 0 then raise exception 'FAIL: a person with only an unfinished task saw a spot'; end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 10. the other side of a task, radius and range -------------------------------------------------
do $$
declare
  v_a uuid := (select v::uuid from fx where k = 'a');
  v_b uuid := (select v::uuid from fx where k = 'b');
  v_e uuid := (select v::uuid from fx where k = 'e');
begin
  -- E posted a task A was hired for: E shares, and A (the worker) sees E; E (the poster) sees A once A shares
  perform pg_temp.as_owner();
  insert into public.map_sharing (user_id, share_live, notice_version, consented_at) values (v_e, true, 'v1', now())
  on conflict (user_id) do update set share_live = true;
  insert into public.map_spots (user_id, cell_lat, cell_lng, expires_at) values (v_e, 12.980, 77.600, now() + interval '10 minutes')
  on conflict (user_id) do update set expires_at = excluded.expires_at;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_e) <> 1 then raise exception 'FAIL: the hired worker cannot see the poster'; end if;
  if pg_temp.seen() <> 2 then raise exception 'FAIL: A should see B and E, saw %', pg_temp.seen(); end if;
  if (select array_agg(m.id order by m.km) from public.map_my_people(12.97, 77.595, 10) m) <> array[v_b, v_e] then
    raise exception 'FAIL: people are not nearest first (B is about 0 km out, E about 1.5 km)';
  end if;

  -- A shares: the poster E sees A (the worker side of the same task)
  perform public.map_sharing_set(true, 'v1');
  perform public.map_spot_beat(12.9601, 77.5801);
  perform pg_temp.become(v_e);
  if pg_temp.seen(v_a) <> 1 then raise exception 'FAIL: the poster cannot see the hired worker'; end if;
  perform pg_temp.become(v_a);
  perform public.map_sharing_set(false, 'v1');

  -- radius: nothing within 0.5 km of a far-off centre, and a radius outside 0..50 returns nothing
  if pg_temp.seen(null, 13.5, 78.2, 5) <> 0 then raise exception 'FAIL: a far-off centre returned people'; end if;
  if pg_temp.seen(null, 12.97, 77.59, 0.2) <> 0 then raise exception 'FAIL: a 0.2 km radius returned people about 0.5 km or more away'; end if;
  if pg_temp.seen(null, 12.97, 77.59, 51) <> 0 then raise exception 'FAIL: a radius over 50 km was served'; end if;
  if pg_temp.seen(null, 12.97, 77.59, -1) <> 0 then raise exception 'FAIL: a negative radius was served'; end if;
  if pg_temp.seen(null, 95, 77.59, 10) <> 0 then raise exception 'FAIL: an impossible latitude was served'; end if;
  if pg_temp.seen(null, 12.97, 77.59, 50) <> 2 then raise exception 'FAIL: a 50 km radius should still see both people'; end if;

  -- a beat with an impossible number changes nothing
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(91, 10);
  perform public.map_spot_beat(10, 181);
  perform pg_temp.as_owner();
  if (select cell_lat from public.map_spots where user_id = v_b) <> 12.970 then
    raise exception 'FAIL: an impossible coordinate changed B''s spot';
  end if;
end;
$$;

-- ---- 3. a block, either way, hides the spot -----------------------------------------------------------
do $$
declare
  v_a uuid := (select v::uuid from fx where k = 'a');
  v_b uuid := (select v::uuid from fx where k = 'b');
begin
  perform pg_temp.as_owner();
  insert into public.blocks (blocker_id, blocked_id) values (v_a, v_b);
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 0 then raise exception 'FAIL: A still sees B after blocking B'; end if;
  perform pg_temp.as_owner();
  delete from public.blocks where blocker_id = v_a and blocked_id = v_b;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 1 then raise exception 'FAIL: B did not come back after the block was lifted'; end if;

  perform pg_temp.as_owner();
  insert into public.blocks (blocker_id, blocked_id) values (v_b, v_a);
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 0 then raise exception 'FAIL: A still sees B after B blocked A'; end if;
  perform pg_temp.as_owner();
  delete from public.blocks where blocker_id = v_b and blocked_id = v_a;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 1 then raise exception 'FAIL: B did not come back after B lifted the block'; end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 4. an expired spot is hidden; the next beat brings it back ----------------------------------------
do $$
declare
  v_a uuid := (select v::uuid from fx where k = 'a');
  v_b uuid := (select v::uuid from fx where k = 'b');
begin
  perform pg_temp.as_owner();
  update public.map_spots set expires_at = now() - interval '1 minute', updated_at = now() - interval '16 minutes'
   where user_id = v_b;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 0 then raise exception 'FAIL: an expired spot is still shown'; end if;

  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.97163, 77.59461);
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 1 then raise exception 'FAIL: a fresh beat did not bring B back'; end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 9. the beat throttle -----------------------------------------------------------------------------
do $$
declare
  v_b      uuid := (select v::uuid from fx where k = 'b');
  v_stamp  timestamptz;
  v_expiry timestamptz;
  v_row    record;
begin
  -- 30 seconds since the last beat, same cell: nothing changes
  perform pg_temp.as_owner();
  update public.map_spots set updated_at = now() - interval '30 seconds', expires_at = now() + interval '5 minutes'
   where user_id = v_b;
  select updated_at, expires_at into v_stamp, v_expiry from public.map_spots where user_id = v_b;
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.97163, 77.59461);
  perform public.map_spot_beat(12.9712, 77.5944);            -- same cell, a slightly different spot
  perform pg_temp.as_owner();
  select * into v_row from public.map_spots where user_id = v_b;
  if v_row.updated_at is distinct from v_stamp or v_row.expires_at is distinct from v_expiry then
    raise exception 'FAIL: a repeat beat from the same cell inside 50 seconds changed the row (%, %)', v_row.updated_at, v_row.expires_at;
  end if;

  -- 30 seconds since the last beat but a new cell: it moves at once
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.99, 77.62);                 -- cell 12.990 / 77.620
  perform pg_temp.as_owner();
  select * into v_row from public.map_spots where user_id = v_b;
  if abs(v_row.cell_lat - 12.990) > 1e-9 or abs(v_row.cell_lng - 77.620) > 1e-9 then
    raise exception 'FAIL: moving to a new cell inside the throttle window was ignored, got % / %', v_row.cell_lat, v_row.cell_lng;
  end if;

  -- 60 seconds since the last beat, same cell: the spot is refreshed
  update public.map_spots set updated_at = now() - interval '60 seconds', expires_at = now() + interval '5 minutes'
   where user_id = v_b;
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.99, 77.62);
  perform pg_temp.as_owner();
  select * into v_row from public.map_spots where user_id = v_b;
  if v_row.updated_at < now() - interval '1 second' or v_row.expires_at < now() + interval '14 minutes' then
    raise exception 'FAIL: a beat after the throttle window did not refresh the spot (%, %)', v_row.updated_at, v_row.expires_at;
  end if;
  if (select count(*) from public.map_spots where user_id = v_b) <> 1 then
    raise exception 'FAIL: more than one spot row for one person';
  end if;
  -- back to the cell the later checks expect
  update public.map_spots set cell_lat = 12.970, cell_lng = 77.595 where user_id = v_b;
end;
$$;

-- ---- 5. turning off, and "Hide me now", delete the spot ------------------------------------------------
do $$
declare
  v_a   uuid := (select v::uuid from fx where k = 'a');
  v_b   uuid := (select v::uuid from fx where k = 'b');
  v_row record;
begin
  -- Hide me now: the spot goes, the choice stays on
  perform pg_temp.become(v_b);
  perform public.map_spot_clear();
  perform pg_temp.as_owner();
  if exists (select 1 from public.map_spots where user_id = v_b) then
    raise exception 'FAIL: map_spot_clear left the spot behind';
  end if;
  if not (select share_live from public.map_sharing where user_id = v_b) then
    raise exception 'FAIL: map_spot_clear turned sharing off; it should only remove the spot';
  end if;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 0 then raise exception 'FAIL: A still sees B after B cleared the spot'; end if;

  -- sharing back on and a beat, then off: the row is deleted at once and a later beat stores nothing
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.97163, 77.59461);
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 1 then raise exception 'FAIL: B did not return on the next beat'; end if;
  perform pg_temp.become(v_b);
  perform public.map_sharing_set(false, 'v1');
  perform pg_temp.as_owner();
  if exists (select 1 from public.map_spots where user_id = v_b) then
    raise exception 'FAIL: turning sharing off did not delete the spot';
  end if;
  select * into v_row from public.map_sharing where user_id = v_b;
  if v_row.share_live or v_row.withdrawn_at is null or v_row.consented_at is null then
    raise exception 'FAIL: the withdrawal was not recorded, got %', v_row;
  end if;
  perform pg_temp.become(v_b);
  perform public.map_spot_beat(12.97163, 77.59461);
  perform pg_temp.as_owner();
  if exists (select 1 from public.map_spots where user_id = v_b) then
    raise exception 'FAIL: a beat after switching off stored a spot';
  end if;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_b) <> 0 then raise exception 'FAIL: A still sees B after B switched sharing off'; end if;

  -- switching on again clears the withdrawal
  perform pg_temp.become(v_b);
  perform public.map_sharing_set(true, 'v1');
  perform pg_temp.as_owner();
  select * into v_row from public.map_sharing where user_id = v_b;
  if not v_row.share_live or v_row.withdrawn_at is not null then
    raise exception 'FAIL: switching on again left the old withdrawal in place, got %', v_row;
  end if;
end;
$$;

-- ---- 8. closing an account removes the spot and ends sharing -----------------------------------------------
do $$
declare
  v_a   uuid := (select v::uuid from fx where k = 'a');
  v_e   uuid := (select v::uuid from fx where k = 'e');
  v_err text;
begin
  perform pg_temp.as_owner();
  update public.map_spots set expires_at = now() + interval '10 minutes' where user_id = v_e;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_e) <> 1 then raise exception 'FAIL: E should be visible before the account is closed'; end if;

  perform pg_temp.as_owner();
  update public.profiles set deleted_at = now() where id = v_e;
  if exists (select 1 from public.map_spots where user_id = v_e) then
    raise exception 'FAIL: closing the account left the spot behind';
  end if;
  if (select share_live from public.map_sharing where user_id = v_e) then
    raise exception 'FAIL: closing the account left sharing on';
  end if;
  if (select withdrawn_at from public.map_sharing where user_id = v_e) is null then
    raise exception 'FAIL: closing the account did not record the withdrawal';
  end if;
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_e) <> 0 then raise exception 'FAIL: A still sees a closed account'; end if;

  -- even with the rows forced back, a closed account is not shown, cannot switch on, and its beats are ignored
  perform pg_temp.as_owner();
  update public.map_sharing set share_live = true where user_id = v_e;
  insert into public.map_spots (user_id, cell_lat, cell_lng, expires_at) values (v_e, 12.980, 77.600, now() + interval '10 minutes');
  perform pg_temp.become(v_a);
  if pg_temp.seen(v_e) <> 0 then raise exception 'FAIL: a closed account is shown on the map'; end if;
  perform pg_temp.as_owner();
  delete from public.map_spots where user_id = v_e;
  update public.map_sharing set share_live = false where user_id = v_e;
  perform pg_temp.become(v_e);
  v_err := pg_temp.try('select public.map_sharing_set(true, ''v1'')');
  if v_err is null then raise exception 'FAIL: a closed account switched sharing on'; end if;
  perform pg_temp.as_owner();
end;
$$;

-- Exactly one closing-account trigger (the migration drops and re-creates it, so a re-run adds no second one).
do $$
declare
  v_n integer;
begin
  select count(*) into v_n from pg_trigger
   where tgrelid = 'public.profiles'::regclass and tgname = 'map_forget_closed' and not tgisinternal;
  if v_n <> 1 then
    raise exception 'FAIL: expected one map_forget_closed trigger on profiles, found %', v_n;
  end if;
  raise notice 'people_map ok';
end;
$$;

rollback;
