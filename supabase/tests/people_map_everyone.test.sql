-- People map, "everyone nearby" audience (migration 160, owner decision 35b).
--
-- A sharer may choose that other signed-in adults nearby can see them too. Nothing is wider by default, and a
-- stranger sees less than a person you worked with. Asserted against the real grants, functions and rows:
--   1. who may call the new functions; the default audience is 'people'
--   2. map_audience_set: needs sharing on, a known audience, and the v2 notice for 'everyone'
--   3. an 'everyone' sharer reaches a stranger as kind 'nearby': first name only, no photo, no job count,
--      a 0.02-degree cell, never the finer one
--   4. a 'people'-only sharer stays invisible to strangers; people I worked with are still kind 'mine', once
--   5. blocks (either direction), closed accounts and expired spots hide a stranger
--   6. a viewer under 18 (or with no age check) sees no strangers
--   7. switching sharing off puts the audience back to 'people'; switching on again does not re-share widely
--   8. strangers are limited to 25 km and 30 people; the signed-out role sees nothing
--
-- One transaction, rolled back: the test leaves no rows behind.
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/people_map_everyone.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

create or replace function pg_temp.job(p_poster uuid, p_worker uuid, p_status text) returns uuid
language plpgsql as $$
declare
  v_task uuid;
  v_bid  uuid;
begin
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (p_poster, 'services', 'people map everyone fixture', 100000, 240) returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, p_worker, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status)
  values (v_task, v_bid, p_worker,
          103000, case when p_status in ('COMPLETED', 'AUTO_COMPLETED') then 'released' else 'started' end::public.assignment_status);
  update public.tasks set status = p_status::public.task_status where id = v_task;
  return v_task;
end;
$$;

-- Rows of the new read for the caller, optionally only one person. Centre: Bengaluru.
create or replace function pg_temp.around(p_who uuid default null, p_lat double precision default 12.97,
                                          p_lng double precision default 77.59, p_km double precision default 10)
returns table (
  id uuid, display_name text, avatar_url text, last_seen_at timestamptz,
  lat double precision, lng double precision, km double precision, jobs integer, spot_at timestamptz, kind text
) language sql as $$
  -- A stranger comes back under an alias id (a hash of viewer + person), so match either the real id or the alias.
  select * from public.map_people_around(p_lat, p_lng, p_km) m
   where p_who is null
      or m.id = p_who
      or m.id = md5((nullif(current_setting('request.jwt.claims', true), '')::json ->> 'sub') || ':' || p_who::text)::uuid
$$;

-- Switch a person's sharing on, choose an audience and drop a spot. Runs as that person.
create or replace function pg_temp.share(p_who uuid, p_audience text, p_lat double precision, p_lng double precision)
returns void language plpgsql as $$
begin
  perform pg_temp.become(p_who);
  perform public.map_sharing_set(true, 'v1');
  if p_audience = 'everyone' then
    perform public.map_audience_set('everyone', 'v2');
  end if;
  perform public.map_spot_beat(p_lat, p_lng);
end;
$$;

create temp table fx (k text primary key, v text);
grant all on fx to public;

-- ---- fixture ---------------------------------------------------------------------------------------
--   A  the viewer, an adult.          B  stranger, shares to everyone, display name "Pmapx Bee".
--   C  stranger, shares to people only.    G  finished a task with A, shares to people only.
--   H  finished a task with A, shares to everyone (must show once, as mine).
--   K  stranger who shares to everyone, but A blocked K.   L  stranger who shares to everyone and blocked A.
--   M  minor (cannot share, cannot see strangers).         N  stranger, shares to everyone, 30 km away.
--   Q  stranger, shares to everyone, expired spot.
do $$
declare
  v_a uuid := gen_random_uuid();
  v_b uuid := gen_random_uuid();
  v_c uuid := gen_random_uuid();
  v_g uuid := gen_random_uuid();
  v_h uuid := gen_random_uuid();
  v_k uuid := gen_random_uuid();
  v_l uuid := gen_random_uuid();
  v_m uuid := gen_random_uuid();
  v_n uuid := gen_random_uuid();
  v_q uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'pmape+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_a), (v_b), (v_c), (v_g), (v_h), (v_k), (v_l), (v_m), (v_n), (v_q)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_a, 'Pmapx Ay'), (v_b, 'Pmapx Bee'), (v_c, 'Pmapx Cee'), (v_g, 'Pmapx Gee'), (v_h, 'Pmapx Aitch'),
         (v_k, 'Pmapx Kay'), (v_l, 'Pmapx El'), (v_m, 'Pmapx Em'), (v_n, 'Pmapx En'), (v_q, 'Pmapx Queue')
  on conflict (id) do update set display_name = excluded.display_name;
  insert into public.wallets (user_id)
  select u.id from (values (v_a), (v_b), (v_c), (v_g), (v_h), (v_k), (v_l), (v_m), (v_n), (v_q)) as u(id)
  on conflict (user_id) do nothing;

  insert into public.age_checks (user_id, birth_date, passed, min_age)
  select u.id, date '1990-01-01', true, 18
    from (values (v_a), (v_b), (v_c), (v_g), (v_h), (v_k), (v_l), (v_n), (v_q)) as u(id)
  on conflict (user_id) do update set passed = true;
  insert into public.age_checks (user_id, birth_date, passed, min_age)
  values (v_m, (current_date - interval '15 years')::date, false, 18)
  on conflict (user_id) do update set passed = false;
  update public.profiles set onboarded_at = coalesce(onboarded_at, now()), deleted_at = null
   where id in (v_a, v_b, v_c, v_g, v_h, v_k, v_l, v_n, v_q, v_m);

  perform pg_temp.job(v_a, v_g, 'COMPLETED');
  perform pg_temp.job(v_h, v_a, 'COMPLETED');
  perform pg_temp.job(v_a, v_h, 'AUTO_COMPLETED');

  insert into public.blocks (blocker_id, blocked_id) values (v_a, v_k), (v_l, v_a);

  insert into fx values ('a', v_a::text), ('b', v_b::text), ('c', v_c::text), ('g', v_g::text), ('h', v_h::text),
                        ('k', v_k::text), ('l', v_l::text), ('m', v_m::text), ('n', v_n::text), ('q', v_q::text);
end;
$$;

-- ---- 1. grants, and nothing is wider by default ----------------------------------------------------
do $$
declare
  v_a   uuid := (select v::uuid from fx where k = 'a');
  v_fns text[] := array['map_audience_set(text,text)', 'map_people_around(double precision,double precision,double precision)'];
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
  if has_function_privilege('authenticated', 'private.snap_cell(double precision,double precision)'::regprocedure, 'execute') then
    raise exception 'FAIL: signed-in people can execute private.snap_cell(value, step)';
  end if;

  perform pg_temp.become_anon();
  v_err := pg_temp.try('select * from public.map_people_around(12.97, 77.59, 10)');
  if v_err is null or v_err not ilike '%permission denied%' then
    raise exception 'FAIL: the signed-out role called map_people_around, got %', v_err;
  end if;
  v_err := pg_temp.try('select public.map_audience_set(''everyone'', ''v2'')');
  if v_err is null or v_err not ilike '%permission denied%' then
    raise exception 'FAIL: the signed-out role called map_audience_set, got %', v_err;
  end if;

  -- signed in, but no session user id: nothing comes back
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  if (select count(*) from public.map_people_around(12.97, 77.59, 10)) <> 0 then
    raise exception 'FAIL: a call with no user id saw people';
  end if;

  -- the default audience is 'people' for a person who agrees under notice v1
  perform pg_temp.become(v_a);
  perform public.map_sharing_set(true, 'v1');
  perform pg_temp.as_owner();
  if (select audience from public.map_sharing where user_id = v_a) <> 'people' then
    raise exception 'FAIL: the default audience is not people';
  end if;
  perform pg_temp.become(v_a);
  perform public.map_sharing_set(false, 'v1');
  perform pg_temp.as_owner();
end;
$$;

-- ---- 2. choosing the audience ----------------------------------------------------------------------
do $$
declare
  v_b   uuid := (select v::uuid from fx where k = 'b');
  v_m   uuid := (select v::uuid from fx where k = 'm');
  v_err text;
begin
  perform pg_temp.become(v_b);
  -- sharing is off: refused
  v_err := pg_temp.try('select public.map_audience_set(''everyone'', ''v2'')');
  if v_err is null or v_err not ilike '%sharing on first%' then
    raise exception 'FAIL: chose an audience with sharing off, got %', v_err;
  end if;
  perform public.map_sharing_set(true, 'v1');
  v_err := pg_temp.try('select public.map_audience_set(''everyone'', ''v1'')');
  if v_err is null or v_err not ilike '%new notice%' then
    raise exception 'FAIL: "everyone" was accepted on the old notice, got %', v_err;
  end if;
  v_err := pg_temp.try('select public.map_audience_set(''the whole world'', ''v2'')');
  if v_err is null or v_err not ilike '%unknown audience%' then
    raise exception 'FAIL: an unknown audience was accepted, got %', v_err;
  end if;
  v_err := pg_temp.try('select public.map_audience_set(''everyone'', ''v2; drop'')');
  if v_err is null or v_err not ilike '%unknown notice%' then
    raise exception 'FAIL: a bad notice was accepted, got %', v_err;
  end if;
  perform public.map_audience_set('everyone', 'v2');
  perform pg_temp.as_owner();
  if (select audience from public.map_sharing where user_id = v_b) <> 'everyone'
     or (select audience_at from public.map_sharing where user_id = v_b) is null then
    raise exception 'FAIL: the audience was not saved';
  end if;
  perform pg_temp.become(v_b);
  perform public.map_audience_set('people', 'v2');
  perform pg_temp.as_owner();
  if (select audience from public.map_sharing where user_id = v_b) <> 'people' then
    raise exception 'FAIL: could not go back to people';
  end if;
  perform pg_temp.become(v_b);
  perform public.map_sharing_set(false, 'v2');
  perform pg_temp.as_owner();

  -- a minor cannot switch sharing on, so cannot choose an audience either
  perform pg_temp.become(v_m);
  v_err := pg_temp.try('select public.map_audience_set(''everyone'', ''v2'')');
  if v_err is null then
    raise exception 'FAIL: a minor chose an audience';
  end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 3-5. what a stranger sees ---------------------------------------------------------------------
do $$
declare
  v_a uuid := (select v::uuid from fx where k = 'a');
  v_b uuid := (select v::uuid from fx where k = 'b');
  v_c uuid := (select v::uuid from fx where k = 'c');
  v_g uuid := (select v::uuid from fx where k = 'g');
  v_h uuid := (select v::uuid from fx where k = 'h');
  v_k uuid := (select v::uuid from fx where k = 'k');
  v_l uuid := (select v::uuid from fx where k = 'l');
  v_n uuid := (select v::uuid from fx where k = 'n');
  v_q uuid := (select v::uuid from fx where k = 'q');
  r     record;
begin
  -- B (everyone), C (people only), G (mine, people only), H (mine, everyone), K and L (blocked), Q (will expire)
  perform pg_temp.share(v_b, 'everyone', 12.981, 77.601);
  perform pg_temp.share(v_c, 'people',   12.972, 77.592);
  perform pg_temp.share(v_g, 'people',   12.973, 77.593);
  perform pg_temp.share(v_h, 'everyone', 12.974, 77.594);
  perform pg_temp.share(v_k, 'everyone', 12.975, 77.595);
  perform pg_temp.share(v_l, 'everyone', 12.976, 77.596);
  perform pg_temp.share(v_q, 'everyone', 12.977, 77.597);
  -- N shares to everyone from about 30 km away
  perform pg_temp.share(v_n, 'everyone', 13.24, 77.59);
  perform pg_temp.as_owner();
  update public.map_spots set expires_at = now() - interval '1 minute' where user_id = v_q;

  perform pg_temp.become(v_a);

  -- B: a stranger. Name, photo, jobs and cell are all reduced.
  select * into r from pg_temp.around(v_b);
  if not found then
    raise exception 'FAIL: A cannot see B, who shares with everyone';
  end if;
  if r.kind <> 'nearby' then raise exception 'FAIL: B is not kind nearby, got %', r.kind; end if;
  if r.id = v_b then raise exception 'FAIL: a stranger came back under the real user id'; end if;
  if r.id <> md5(v_a::text || ':' || v_b::text)::uuid then raise exception 'FAIL: a stranger''s alias id is not the viewer-specific one'; end if;
  -- no stranger row anywhere carries a real user id of a sharer
  if exists (select 1 from public.map_people_around(12.97, 77.59, 10) m
              where m.kind = 'nearby' and m.id in (select user_id from public.map_sharing)) then
    raise exception 'FAIL: a real user id was handed out for a stranger';
  end if;
  -- a different viewer gets a different alias for the same person
  perform pg_temp.become(v_h);
  if exists (select 1 from public.map_people_around(12.97, 77.59, 10) m where m.id = r.id) then
    raise exception 'FAIL: two viewers share one alias for the same person';
  end if;
  perform pg_temp.become(v_a);
  if r.display_name is distinct from 'Pmapx' then raise exception 'FAIL: a stranger must show a first name only, got %', r.display_name; end if;
  if r.avatar_url is not null then raise exception 'FAIL: a stranger came back with a photo'; end if;
  if r.jobs <> 0 then raise exception 'FAIL: a stranger came back with a job count'; end if;
  if (round(r.lat * 1000)::bigint % 20) <> 0 or (round(r.lng * 1000)::bigint % 20) <> 0 then
    raise exception 'FAIL: a stranger''s cell is finer than 0.02 degrees: % %', r.lat, r.lng;
  end if;
  if r.lat <> 12.98 or r.lng <> 77.6 then
    raise exception 'FAIL: B''s coarse cell is wrong: % %', r.lat, r.lng;
  end if;

  -- C shares to people only: invisible to a stranger
  if exists (select 1 from pg_temp.around(v_c)) then
    raise exception 'FAIL: a people-only sharer was visible to a stranger';
  end if;

  -- G: someone A worked with, people only: kind mine, jobs 1, the finer 0.005 cell
  select * into r from pg_temp.around(v_g);
  if not found then raise exception 'FAIL: A cannot see G, who finished a task with A'; end if;
  if r.kind <> 'mine' or r.jobs <> 1 then raise exception 'FAIL: G should be mine with 1 job, got % / %', r.kind, r.jobs; end if;
  if r.lat <> 12.975 or r.lng <> 77.595 then raise exception 'FAIL: G''s cell should be the 0.005 one, got % %', r.lat, r.lng; end if;
  if r.display_name is distinct from 'Pmapx Gee' then raise exception 'FAIL: mine keeps the full name, got %', r.display_name; end if;

  -- H: mine AND everyone: shown once, as mine, with two jobs
  if (select count(*) from pg_temp.around(v_h)) <> 1 then
    raise exception 'FAIL: H (mine and everyone) is not listed exactly once';
  end if;
  select * into r from pg_temp.around(v_h);
  if r.kind <> 'mine' or r.jobs <> 2 then raise exception 'FAIL: H should be mine with 2 jobs, got % / %', r.kind, r.jobs; end if;

  -- blocks in both directions, an expired spot, and 30 km away with the radius at 50: none shown
  if exists (select 1 from pg_temp.around(v_k, 12.97, 77.59, 50)) then raise exception 'FAIL: a person I blocked is on my map'; end if;
  if exists (select 1 from pg_temp.around(v_l, 12.97, 77.59, 50)) then raise exception 'FAIL: a person who blocked me is on my map'; end if;
  if exists (select 1 from pg_temp.around(v_q, 12.97, 77.59, 50)) then raise exception 'FAIL: an expired spot is on the map'; end if;
  if exists (select 1 from pg_temp.around(v_n, 12.97, 77.59, 50)) then
    raise exception 'FAIL: a stranger more than 25 km away was returned';
  end if;

  -- the person is not shown to themselves
  perform pg_temp.become(v_b);
  if exists (select 1 from pg_temp.around(v_b)) then raise exception 'FAIL: B sees themselves on the map'; end if;

  -- a closed account disappears from the map and ends sharing
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = now() where id = v_b;
  perform pg_temp.become(v_a);
  if exists (select 1 from pg_temp.around(v_b)) then raise exception 'FAIL: a closed account is still on the map'; end if;
  perform pg_temp.as_owner();
  if (select share_live from public.map_sharing where user_id = v_b) then
    raise exception 'FAIL: closing the account did not end sharing';
  end if;
  update public.profiles set deleted_at = null where id = v_b;

  -- a viewer with a closed account sees nobody new
  perform pg_temp.share(v_b, 'everyone', 12.981, 77.601);
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = now() where id = v_a;
  perform pg_temp.become(v_a);
  if exists (select 1 from pg_temp.around(v_b)) then raise exception 'FAIL: a closed viewer saw a stranger'; end if;
  perform pg_temp.as_owner();
  update public.profiles set deleted_at = null where id = v_a;
end;
$$;

-- ---- 6. who may see strangers ----------------------------------------------------------------------
do $$
declare
  v_a uuid := (select v::uuid from fx where k = 'a');
  v_b uuid := (select v::uuid from fx where k = 'b');
  v_m uuid := (select v::uuid from fx where k = 'm');
begin
  -- the minor, and an adult whose check has not passed, see no strangers
  perform pg_temp.become(v_m);
  if exists (select 1 from pg_temp.around(v_b)) then raise exception 'FAIL: a minor saw a stranger'; end if;
  perform pg_temp.as_owner();
  update public.age_checks set passed = false where user_id = v_a;
  perform pg_temp.become(v_a);
  if exists (select 1 from pg_temp.around(v_b)) then raise exception 'FAIL: a viewer without a passed age check saw a stranger'; end if;
  perform pg_temp.as_owner();
  update public.age_checks set passed = true where user_id = v_a;
  perform pg_temp.become(v_a);
  if not exists (select 1 from pg_temp.around(v_b)) then raise exception 'FAIL: B did not come back once the age check passed'; end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 7. off puts the audience back --------------------------------------------------------------------
do $$
declare
  v_a uuid := (select v::uuid from fx where k = 'a');
  v_b uuid := (select v::uuid from fx where k = 'b');
begin
  perform pg_temp.become(v_b);
  perform public.map_sharing_set(false, 'v2');
  perform pg_temp.as_owner();
  if (select audience from public.map_sharing where user_id = v_b) <> 'people'
     or (select audience_at from public.map_sharing where user_id = v_b) is not null then
    raise exception 'FAIL: switching sharing off did not put the audience back to people';
  end if;
  if exists (select 1 from public.map_spots where user_id = v_b) then
    raise exception 'FAIL: the spot survived switching sharing off';
  end if;

  -- on again, no new choice: still people only, so a stranger sees nothing
  perform pg_temp.become(v_b);
  perform public.map_sharing_set(true, 'v2');
  perform public.map_spot_beat(12.971, 77.591);
  perform pg_temp.become(v_a);
  if exists (select 1 from pg_temp.around(v_b)) then
    raise exception 'FAIL: switching on again re-shared with everyone';
  end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 8. limits ---------------------------------------------------------------------------------------
do $$
declare
  v_a uuid := (select v::uuid from fx where k = 'a');
  v_n uuid := (select v::uuid from fx where k = 'n');
  v_b uuid := (select v::uuid from fx where k = 'b');
  v_i uuid;
  v_ids uuid[] := '{}';
begin
  -- N is about 30 km out: inside a 50 km search it is still not returned to a stranger (25 km cap)...
  perform pg_temp.become(v_a);
  if exists (select 1 from pg_temp.around(v_n, 12.97, 77.59, 50)) then
    raise exception 'FAIL: the 25 km cap on strangers does not hold';
  end if;

  -- ...and no more than 30 strangers come back, however many share
  perform pg_temp.as_owner();
  for i in 1..40 loop
    v_i := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values (v_i, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'pmape+' || v_i || '@taskdrop.test', '', now(), now(), now());
    insert into public.profiles (id, display_name, onboarded_at) values (v_i, 'Crowd ' || i, now())
      on conflict (id) do update set display_name = excluded.display_name, onboarded_at = coalesce(public.profiles.onboarded_at, now());
    insert into public.wallets (user_id) values (v_i) on conflict (user_id) do nothing;
    insert into public.age_checks (user_id, birth_date, passed, min_age) values (v_i, date '1990-01-01', true, 18)
      on conflict (user_id) do update set passed = true;
    insert into public.map_sharing (user_id, share_live, notice_version, consented_at, audience, audience_at)
      values (v_i, true, 'v2', now(), 'everyone', now());
    insert into public.map_spots (user_id, cell_lat, cell_lng, expires_at)
      values (v_i, 12.97, 77.59, now() + interval '10 minutes');
  end loop;
  perform pg_temp.become(v_a);
  if (select count(*) from pg_temp.around() m where m.kind = 'nearby') <> 30 then
    raise exception 'FAIL: expected exactly 30 strangers, got %', (select count(*) from pg_temp.around() m where m.kind = 'nearby');
  end if;

  -- a bad centre or radius returns nothing
  if exists (select 1 from public.map_people_around(95, 77.59, 10)) then raise exception 'FAIL: latitude 95 returned rows'; end if;
  if exists (select 1 from public.map_people_around(12.97, 77.59, 80)) then raise exception 'FAIL: radius 80 returned rows'; end if;
  if exists (select 1 from public.map_people_around(12.97, 77.59, null)) then raise exception 'FAIL: a null radius returned rows'; end if;
  perform pg_temp.as_owner();
end;
$$;

do $$ begin raise notice 'people_map_everyone: all checks passed'; end $$;

rollback;
