-- Column-level write lock-down, private locations, scoped media reads.
--
-- Audit findings F-01 .. F-06 (docs/audit/SECURITY_FINDINGS.md). These
-- assertions FAIL against migrations <= 072 and PASS against 073 .. 075.
--
-- Everything runs inside one transaction that is rolled back, so the test
-- leaves no rows behind.
--
-- NOTE ON is_admin(): it returns true for any session whose session_user is
-- postgres/supabase_admin (the "operator" rule from migration 040). psql and the
-- SQL editor are exactly such sessions, so without the override below every
-- "ordinary user" in this file would silently be an admin. The override only
-- lives inside this transaction.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/column_lockdown.test.sql

begin;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as
$$ select coalesce(private.has_role(auth.uid(), 'admin'), false) $$;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_anon() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
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

-- true when the statement is refused (permission denied, RLS, or a guard).
create or replace function pg_temp.refused(p_sql text) returns boolean
language plpgsql as $$
declare n bigint;
begin
  execute p_sql;
  get diagnostics n = row_count;
  return n = 0;            -- an UPDATE that matches no row under RLS is also a refusal
exception when others then
  return true;
end;
$$;

-- ---- 1. the anonymous role holds nothing -----------------------------------
do $$
declare n integer;
begin
  select count(*) into n from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  if n > 0 then
    raise exception 'FAIL: anon still holds % table privileges in public', n;
  end if;
end;
$$;

-- ---- 2. fixtures -----------------------------------------------------------
create temp table fx (k text primary key, v text);
grant all on fx to public;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_task   uuid;
  v_locked uuid;
  v_bid    uuid;
  v_review uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'test+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_other)) as u(id);

  insert into public.profiles (id, display_name) values
    (v_poster, 'Poster'), (v_worker, 'Worker'), (v_other, 'Other')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_other) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role)
  select u.id, r.role from (values (v_poster), (v_worker), (v_other)) u(id),
         (values ('poster'::public.app_role), ('worker'::public.app_role)) r(role)
  on conflict do nothing;

  -- an OPEN task with media and an exact location (the trigger rounds it)
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng, media_path)
  values (v_poster, 'services', 'Lockdown open', 100000, 240, 12.971599, 77.594566, v_poster || '/open.png')
  returning id into v_task;
  -- a task that is not open, with its own media
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, media_path, status)
  values (v_poster, 'services', 'Lockdown locked', 100000, 240, v_poster || '/locked.png', 'LOCKED')
  returning id into v_locked;

  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 90000, 240) returning id into v_bid;

  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_locked, v_worker, 'Finished the job exactly as agreed', jsonb_build_array(jsonb_build_object('path', v_worker || '/proof.png', 'kind', 'image', 'name', 'proof')));

  update public.profiles set avatar_url = v_poster || '/avatar.png' where id = v_poster;

  insert into storage.objects (bucket_id, name) values
    ('task-media', v_poster || '/open.png'),
    ('task-media', v_poster || '/locked.png'),
    ('task-media', v_poster || '/private.png'),
    ('task-media', v_poster || '/avatar.png'),
    ('task-media', v_worker || '/proof.png');

  insert into fx values ('poster', v_poster::text), ('worker', v_worker::text), ('other', v_other::text),
                        ('task', v_task::text), ('locked', v_locked::text), ('bid', v_bid::text);
end;
$$;

-- ---- 3. F-01: payment and progress columns are not client-writable ----------
do $$
declare
  v_poster uuid := (select v::uuid from fx where k = 'poster');
  v_task   uuid := (select v::uuid from fx where k = 'task');
  v_other  uuid := (select v::uuid from fx where k = 'other');
  col text;
begin
  perform pg_temp.become(v_poster);

  foreach col in array array['funded_at = now()', 'funded_minor = 1', 'funded_via = ''wallet''',
                             'funding_payment_id = gen_random_uuid()', 'funded_credits_minor = 5',
                             'status = ''COMPLETED''', 'locked_minor = 1', 'clear_at = now()',
                             'cleared_at = now()', 'completed_at = now()', 'poster_id = ''' || v_other || '''']
  loop
    if not pg_temp.refused(format('update public.tasks set %s where id = %L', col, v_task)) then
      raise exception 'FAIL F-01: a poster can set tasks.%', col;
    end if;
  end loop;

  if not pg_temp.refused(format(
       'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, funded_at, funded_minor, funded_via)
        values (%L, ''services'', ''x'', 100, 60, now(), 100, ''wallet'')', v_poster)) then
    raise exception 'FAIL F-01: a poster can create a task that is already marked funded';
  end if;

  -- positive controls: editing the description of the job still works
  update public.tasks set title = 'Lockdown open (edited)', description = 'd' where id = v_task;
  if not found then raise exception 'FAIL: a poster can no longer edit their own open task'; end if;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'ok', 100, 60);
end;
$$;

-- The second layer: even if someone later grants the column, the guard refuses.
do $$
declare
  v_poster uuid := (select v::uuid from fx where k = 'poster');
  v_task   uuid := (select v::uuid from fx where k = 'task');
  v_msg    text;
begin
  perform pg_temp.as_owner();
  grant update (funded_at) on public.tasks to authenticated;   -- rolled back with the transaction
  perform pg_temp.become(v_poster);
  begin
    update public.tasks set funded_at = now() where id = v_task;
    raise exception 'FAIL F-01: the guard trigger let a poster set funded_at';
  exception when insufficient_privilege then
    get stacked diagnostics v_msg = message_text;
    if v_msg not like '%set by TaskDrop%' then
      raise exception 'FAIL F-01: refused, but not by the guard trigger (%)', v_msg;
    end if;
  end;
end;
$$;

-- remove_listing is the only way to take a service listing down
do $$
declare
  v_poster uuid := (select v::uuid from fx where k = 'poster');
  v_other  uuid := (select v::uuid from fx where k = 'other');
  v_svc    uuid;
  v_failed boolean := false;
begin
  perform pg_temp.become(v_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, kind)
  values (v_poster, 'services', 'svc', 100, 60, 'service') returning id into v_svc;
  if not pg_temp.refused(format('update public.tasks set status = ''CANCELLED'' where id = %L', v_svc)) then
    raise exception 'FAIL: a client can still set tasks.status directly';
  end if;
  perform pg_temp.become(v_other);
  begin perform public.remove_listing(v_svc); exception when others then v_failed := true; end;
  if not v_failed then raise exception 'FAIL: someone else removed a poster''s listing'; end if;
  perform pg_temp.become(v_poster);
  perform public.remove_listing(v_svc);
  if (select status from public.tasks where id = v_svc) <> 'CANCELLED' then
    raise exception 'FAIL: remove_listing did not cancel the listing';
  end if;
end;
$$;

-- ---- 4. F-05: bids, reviews, destinations, notifications, profiles ----------
do $$
declare
  v_worker uuid := (select v::uuid from fx where k = 'worker');
  v_task   uuid := (select v::uuid from fx where k = 'task');
  v_locked uuid := (select v::uuid from fx where k = 'locked');
  v_bid    uuid := (select v::uuid from fx where k = 'bid');
begin
  perform pg_temp.become(v_worker);
  if not pg_temp.refused(format('update public.bids set is_locked = true where id = %L', v_bid)) then
    raise exception 'FAIL F-05: a bidder can set bids.is_locked';
  end if;
  if not pg_temp.refused(format('update public.bids set task_id = %L where id = %L', v_locked, v_bid)) then
    raise exception 'FAIL F-05: a bidder can move a bid to another task';
  end if;
  update public.bids set price_minor = 85000, message = 'new' where id = v_bid and is_locked = false;
  if not found then raise exception 'FAIL: a bidder can no longer edit their own bid'; end if;

  if not pg_temp.refused(format(
       'insert into public.reviews (task_id, author_id, subject_id, about_role, rating) values (%L, %L, %L, ''worker'', 5)',
       v_task, v_worker, v_worker)) then
    raise exception 'FAIL F-05: a user can insert a review directly, bypassing submit_review';
  end if;

  if not pg_temp.refused(format(
       'insert into public.payout_destinations (user_id, kind, label, upi_id, rzp_fund_account_id) values (%L, ''upi'', ''x'', ''workertest@okaxis'', ''fa_x'')',
       v_worker)) then
    raise exception 'FAIL F-05: a user can set payout_destinations.rzp_fund_account_id';
  end if;
  insert into public.payout_destinations (user_id, kind, label, upi_id) values (v_worker, 'upi', 'x', 'workertest@okaxis');

  if not pg_temp.refused(format('update public.profiles set worker_rating_avg = 5, payout_upi = ''a@b'' where id = %L', v_worker)) then
    raise exception 'FAIL F-05: a user can write ratings or payout_upi on their profile';
  end if;
  update public.profiles set display_name = 'Worker 2', last_seen_at = now() where id = v_worker;
  if not found then raise exception 'FAIL: a user can no longer edit their own profile'; end if;
end;
$$;

-- ---- 5. F-02 / F-04: locations -------------------------------------------------
do $$
declare
  v_poster uuid := (select v::uuid from fx where k = 'poster');
  v_other  uuid := (select v::uuid from fx where k = 'other');
  v_task   uuid := (select v::uuid from fx where k = 'task');
  x double precision; y double precision; px double precision; n bigint;
begin
  perform pg_temp.become(v_poster);
  select loc_lat, loc_lng into x, y from public.tasks where id = v_task;
  if x <> 12.97 or y <> 77.59 then
    raise exception 'FAIL F-04: public task coordinates are (%, %), expected the rounded (12.97, 77.59)', x, y;
  end if;
  select loc_lat into px from public.task_private where task_id = v_task;
  if px is distinct from 12.971599 then
    raise exception 'FAIL F-04: the poster cannot read the exact coordinate (got %)', px;
  end if;

  -- saving the rounded value back must not overwrite the exact one
  update public.tasks set loc_lat = x, loc_lng = y where id = v_task;
  select loc_lat into px from public.task_private where task_id = v_task;
  if px is distinct from 12.971599 then
    raise exception 'FAIL F-04: re-saving the rounded value overwrote the exact coordinate (%)', px;
  end if;

  -- a profile location: exact is private, public is rounded
  update public.profiles set loc_lat = 19.076090, loc_lng = 72.877426, loc_label = 'Mumbai' where id = v_poster;
  select loc_lat into x from public.profiles where id = v_poster;
  select loc_lat into px from public.profile_private where user_id = v_poster;
  if x <> 19.08 or px is distinct from 19.07609 then
    raise exception 'FAIL F-02: profile public=% exact=%', x, px;
  end if;

  perform pg_temp.become(v_other);
  select count(*) into n from public.task_private;
  if n <> 0 then raise exception 'FAIL F-04: an unrelated user can read % exact task coordinates', n; end if;
  select count(*) into n from public.profile_private;
  if n <> 0 then raise exception 'FAIL F-02: an unrelated user can read % exact profile coordinates', n; end if;
  select loc_lat into x from public.profiles where id = v_poster;
  if x <> 19.08 then raise exception 'FAIL F-02: an unrelated user sees an unrounded profile coordinate (%)', x; end if;

  perform pg_temp.as_anon();
  if not pg_temp.refused('select count(*) from public.profiles') then
    raise exception 'FAIL F-02: the anonymous role can read profiles';
  end if;
  if not pg_temp.refused('select count(*) from public.tasks') then
    raise exception 'FAIL F-04: the anonymous role can read tasks';
  end if;
end;
$$;

-- ---- 6. F-03: media reads are scoped -------------------------------------------
do $$
declare
  v_poster uuid := (select v::uuid from fx where k = 'poster');
  v_worker uuid := (select v::uuid from fx where k = 'worker');
  v_other  uuid := (select v::uuid from fx where k = 'other');
  function_names text[];
  seen text[];
begin
  -- the other user: avatars and open-task media only
  perform pg_temp.become(v_other);
  select coalesce(array_agg(name order by name), '{}') into seen from storage.objects
   where bucket_id = 'task-media' and name like v_poster || '/%' or name = v_worker || '/proof.png';
  if not (v_poster || '/open.png'   = any(seen)) then raise exception 'FAIL F-03: open-task media is not readable by a bidder-to-be'; end if;
  if not (v_poster || '/avatar.png' = any(seen)) then raise exception 'FAIL F-03: an avatar is not readable'; end if;
  if (v_poster || '/locked.png')  = any(seen) then raise exception 'FAIL F-03: media of a locked task is readable by a stranger'; end if;
  if (v_poster || '/private.png') = any(seen) then raise exception 'FAIL F-03: an unreferenced private object is readable by a stranger'; end if;
  if (v_worker || '/proof.png')   = any(seen) then raise exception 'FAIL F-03: a proof file is readable by a stranger'; end if;

  -- the poster reads the proof on their own task; the worker reads their own upload
  perform pg_temp.become(v_poster);
  select coalesce(array_agg(name), '{}') into seen from storage.objects where bucket_id = 'task-media';
  if not (v_worker || '/proof.png') = any(seen) then raise exception 'FAIL F-03: the poster cannot read the proof on their own task'; end if;
  if not (v_poster || '/private.png') = any(seen) then raise exception 'FAIL F-03: an owner cannot read their own upload'; end if;

  perform pg_temp.become(v_worker);
  select coalesce(array_agg(name), '{}') into seen from storage.objects where bucket_id = 'task-media';
  if not (v_worker || '/proof.png') = any(seen) then raise exception 'FAIL F-03: a worker cannot read their own proof'; end if;
  if (v_poster || '/private.png') = any(seen) then raise exception 'FAIL F-03: a worker reads the poster''s unreferenced private object'; end if;
end;
$$;

rollback;
