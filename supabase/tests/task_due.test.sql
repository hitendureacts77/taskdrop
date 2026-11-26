-- Changing the date on an open post, or dropping it (migration 216, plan 1.19 J and K), and
-- the switch to no fixed date in run_task_reminders when a date passes with nobody picked.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/task_due.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_admin() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_poster uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_task   uuid;
  v_old    uuid;
  v_closed uuid;
  v_crew   uuid := gen_random_uuid();
  v_c1     uuid;
  v_c2     uuid;
  v_err    text;
  v_out    jsonb;
  v_soon   timestamptz := now() + interval '2 days';
  v_lock   uuid;
  v_bid    uuid;
  v_finish timestamptz := date_trunc('minute', now() + interval '5 days');
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'test+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Due Poster'), (v_other, 'Due Other')
  on conflict (id) do nothing;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, due_at)
  values (v_poster, 'services', 'Due test task', 20000, 60, now() + interval '1 day')
  returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, due_at)
  values (v_poster, 'services', 'Due test old task', 20000, 60, now() + interval '1 day')
  returning id into v_old;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, due_at, crew_id)
  values (v_poster, 'services', 'Due crew a', 20000, 60, now() + interval '1 day', v_crew)
  returning id into v_c1;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, due_at, crew_id)
  values (v_poster, 'services', 'Due crew b', 20000, 60, now() + interval '1 day', v_crew)
  returning id into v_c2;

  -- The poster can set a new date, and drop it (an open task).
  perform pg_temp.become(v_poster);
  perform public.set_task_due(v_task, v_soon);
  perform public.set_task_due(v_task, null);
  perform pg_temp.as_admin();
  if (select due_at from public.tasks where id = v_task) is not null then
    raise exception 'FAIL: set_task_due(null) should leave the task with no date';
  end if;

  -- A crew's open posts move together.
  perform pg_temp.become(v_poster);
  perform public.set_task_due(v_c1, v_soon);
  perform pg_temp.as_admin();
  if (select count(*) from public.tasks where crew_id = v_crew and due_at = v_soon) <> 2 then
    raise exception 'FAIL: a crew''s open posts should get the same new date';
  end if;

  -- A date already past, or years away, is refused.
  perform pg_temp.become(v_poster);
  begin
    perform public.set_task_due(v_task, now() - interval '1 day');
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: a date in the past should be refused';
  end if;
  begin
    perform public.set_task_due(v_task, now() + interval '4 years');
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: a date years away should be refused';
  end if;

  -- Someone else's post cannot be changed.
  perform pg_temp.become(v_other);
  begin
    perform public.set_task_due(v_task, v_soon);
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: another person changed the date on someone else''s post';
  end if;

  -- Not an open post: refused.
  perform pg_temp.as_admin();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, due_at, status)
  values (v_poster, 'services', 'Due test closed task', 20000, 60, now() + interval '1 day', 'CANCELLED')
  returning id into v_closed;
  perform pg_temp.become(v_poster);
  begin
    perform public.set_task_due(v_closed, v_soon);
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: a closed post''s date should not change';
  end if;

  -- A passed date keeps the post visible (plan 1.19 J, owner 25 Nov): to a signed-in worker and to
  -- guests, in the time before it switches to no fixed date.
  perform pg_temp.as_admin();
  update public.tasks set due_at = now() - interval '2 days' where id = v_old;
  perform pg_temp.become(v_other);
  if not exists (select 1 from public.tasks where id = v_old) then
    raise exception 'FAIL: a worker cannot see an open post whose date has passed';
  end if;
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'anon', true);
  if not exists (select 1 from public.guest_open_posts(p_ids => array[v_old])) then
    raise exception 'FAIL: guests no longer see an open post whose date has passed';
  end if;
  if not exists (select 1 from public.guest_open_posts_near(p_ids => array[v_old])) then
    raise exception 'FAIL: the guest map no longer shows an open post whose date has passed';
  end if;

  -- An offer can carry the worker's own finish date: from now on, within 3 years.
  perform pg_temp.as_admin();
  insert into public.wallets (user_id) values (v_poster), (v_other) on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, due_at)
  values (v_poster, 'services', 'Due test lock task', 20000, 60, now() - interval '1 day')
  returning id into v_lock;
  perform pg_temp.become(v_other);
  begin
    insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, proposed_due_at)
    values (v_lock, v_other, 20000, 60, now() - interval '1 day');
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: an offer with a finish date in the past should be refused';
  end if;
  begin
    insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, proposed_due_at)
    values (v_lock, v_other, 20000, 60, now() + interval '4 years');
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: an offer with a finish date years away should be refused';
  end if;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, proposed_due_at)
  values (v_lock, v_other, 20000, 60, v_finish - interval '1 day')
  returning id into v_bid;
  update public.bids set proposed_due_at = v_finish where id = v_bid;

  perform pg_temp.as_admin();
  if not exists (select 1 from public.notifications
                  where user_id = v_poster and task_id = v_lock and kind = 'quote' and body like '%Can finish by %') then
    raise exception 'FAIL: the new-offer notification should give the worker''s finish date';
  end if;

  -- Accepting that offer moves the task to the worker's date, in the same step.
  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  perform pg_temp.as_admin();
  if (select due_at from public.tasks where id = v_lock) is distinct from v_finish then
    raise exception 'FAIL: accepting an offer with a finish date should set the task''s date to it';
  end if;
  if (select status::text from public.tasks where id = v_lock) <> 'LOCKED' then
    raise exception 'FAIL: the offer was not accepted';
  end if;

  -- A passed date with nobody picked switches the post to no fixed date (plan 1.19 J): the old date
  -- is kept in due_lapsed_at and the poster is told once; a crew switches together and is told once;
  -- a date long gone switches too but is not told about.
  perform pg_temp.as_admin();
  update public.tasks set due_at = now() - interval '10 days' where id = v_old;
  update public.tasks set due_at = now() - interval '1 hour' where id = v_task;
  update public.tasks set due_at = now() - interval '1 hour' where crew_id = v_crew;

  v_out := public.run_task_reminders();
  if (select due_at from public.tasks where id = v_task) is not null
     or (select due_lapsed_at from public.tasks where id = v_task) is null then
    raise exception 'FAIL: a passed date should switch the post to no fixed date and keep the old date: %', v_out;
  end if;
  if (select status::text from public.tasks where id = v_task) <> 'OPEN' then
    raise exception 'FAIL: the post should stay open after its date passes';
  end if;
  if not exists (select 1 from public.notifications where user_id = v_poster and task_id = v_task and kind = 'date_passed'
                  and body like '%now has no fixed date%') then
    raise exception 'FAIL: the poster was not told the post now has no fixed date: %', v_out;
  end if;
  if (select due_at from public.tasks where id = v_old) is not null then
    raise exception 'FAIL: a date long gone should switch to no fixed date too';
  end if;
  if exists (select 1 from public.notifications where task_id = v_old and kind = 'date_passed') then
    raise exception 'FAIL: a date that passed long ago should not message the poster';
  end if;
  if exists (select 1 from public.tasks where crew_id = v_crew and due_at is not null) then
    raise exception 'FAIL: a crew''s posts should switch to no fixed date together';
  end if;
  if (select count(*) from public.notifications where task_id in (v_c1, v_c2) and kind = 'date_passed') <> 1 then
    raise exception 'FAIL: a crew should be told once';
  end if;
  if (select due_at from public.tasks where id = v_lock) is distinct from v_finish then
    raise exception 'FAIL: a task with someone picked should keep its date';
  end if;

  v_out := public.run_task_reminders();
  if (v_out->>'date_passed')::int <> 0 then
    raise exception 'FAIL: a second run switched or told again: %', v_out;
  end if;

  -- A new date clears the kept date; if it passes again, it switches and tells again.
  perform pg_temp.become(v_poster);
  perform public.set_task_due(v_task, v_soon);
  perform pg_temp.as_admin();
  if (select due_lapsed_at from public.tasks where id = v_task) is not null then
    raise exception 'FAIL: a new date should clear the kept old date';
  end if;
  update public.tasks set due_at = now() - interval '30 minutes' where id = v_task;
  perform public.run_task_reminders();
  if (select count(*) from public.notifications where task_id = v_task and kind = 'date_passed') <> 2 then
    raise exception 'FAIL: a second passed date should switch and tell again';
  end if;
end;
$$;

rollback;
