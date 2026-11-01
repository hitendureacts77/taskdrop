-- The poster's options (migration 134): Flash Drop, Live answer, Crew, Repeat,
-- Regulars, photos, and the helper's streaks.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/poster_options.test.sql

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
  v_worker uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_task   uuid;
  v_bid    uuid;
  v_next   public.tasks;
  v_row    public.tasks;
  v_crew   uuid := gen_random_uuid();
  v_err    text;
  v_streak jsonb;
  v_slots  integer;
begin
  -- Grants: set when posting, only Repeat can be changed afterwards.
  if not has_column_privilege('authenticated', 'public.tasks', 'flash_until', 'INSERT')
     or not has_column_privilege('authenticated', 'public.tasks', 'crew_id', 'INSERT')
     or not has_column_privilege('authenticated', 'public.tasks', 'preferred_worker_id', 'INSERT') then
    raise exception 'FAIL: a poster must be able to set the options when posting';
  end if;
  if has_column_privilege('authenticated', 'public.tasks', 'flash_until', 'UPDATE')
     or has_column_privilege('authenticated', 'public.tasks', 'preferred_until', 'UPDATE')
     or has_column_privilege('authenticated', 'public.tasks', 'repeated_from', 'INSERT') then
    raise exception 'FAIL: time windows and repeated_from belong to the database';
  end if;
  if not has_column_privilege('authenticated', 'public.tasks', 'repeat_every', 'UPDATE') then
    raise exception 'FAIL: a poster must be able to stop a repeat';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'test+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker), (v_other)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'Options Poster'), (v_worker, 'Options Worker'), (v_other, 'Other Worker')
  on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker), (v_other)
  on conflict (user_id) do nothing;
  update public.wallets set balance_minor = 1000000 where user_id = v_poster;

  -- Flash Drop needs Auto-hire, and its window is set here, not by the app.
  begin
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, flash_until)
    values (v_poster, 'services', 'Flash without auto', 20000, 60, now() + interval '5 days');
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: Flash Drop without Auto-hire should be refused';
  end if;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, assignment_mode, flash_until)
  values (v_poster, 'services', 'Flash with auto', 20000, 60, 'auto', now() + interval '5 days')
  returning * into v_row;
  if v_row.flash_until > now() + interval '31 minutes' or v_row.flag <> 'urgent' then
    raise exception 'FAIL: Flash Drop should last 30 minutes and be marked urgent';
  end if;

  -- Live answer is a local-intel task, never a crew.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, live_answer)
  values (v_poster, 'services', 'Is the queue long?', 3000, 60, true)
  returning * into v_row;
  if v_row.pillar <> 'local_intel' then
    raise exception 'FAIL: a Live answer should be filed as local intel';
  end if;

  -- A crew is 2 to 10 people, and cannot repeat.
  begin
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, crew_id, crew_size, crew_slot)
    values (v_poster, 'services', 'Too big a crew', 20000, 60, v_crew, 11, 1);
    v_err := null;
  exception when check_violation then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: a crew of 11 should be refused';
  end if;
  begin
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, crew_id, crew_size, crew_slot, repeat_every)
    values (v_poster, 'services', 'Repeating crew', 20000, 60, v_crew, 2, 1, 'week');
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: a repeating crew should be refused';
  end if;

  -- Regulars: only someone hired before.
  begin
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, preferred_worker_id)
    values (v_poster, 'services', 'Offer to a stranger', 20000, 60, v_worker);
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: offering first to someone never hired should be refused';
  end if;

  -- A repeating job, driven to COMPLETED through the real functions.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, due_at, repeat_every, want_photos, photos_public)
  values (v_poster, 'services', 'Bring water cans', 20000, 240, now() + interval '1 day', 'week', true, true)
  returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 20000, 240) returning id into v_bid;

  perform pg_temp.become(v_poster);
  perform public.lock_bid(v_bid);
  perform pg_temp.become(v_worker);
  perform public.start_task(v_task);
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task, v_worker, 'Brought all four cans upstairs',
          jsonb_build_array(jsonb_build_object('path', v_worker || '/after.jpg', 'label', 'after'),
                            jsonb_build_object('path', v_worker || '/invoice.pdf')));
  -- Repeat can be switched while the job is under way (migration 135).
  perform pg_temp.become(v_poster);
  if public.set_task_repeat(v_task, 'month') <> 'month' then
    raise exception 'FAIL: set_task_repeat should work on a started job';
  end if;
  perform public.set_task_repeat(v_task, 'week');
  perform pg_temp.become(v_worker);
  perform public.mark_work_done(v_task);
  perform pg_temp.become(v_poster);
  perform public.confirm_release(v_task);
  perform pg_temp.as_admin();

  select * into v_next from public.tasks where repeated_from = v_task;
  if v_next.id is null then
    raise exception 'FAIL: finishing a repeating job should post the next one';
  end if;
  if v_next.status <> 'OPEN' or v_next.preferred_worker_id is distinct from v_worker
     or v_next.preferred_until is null or v_next.due_at < now() + interval '6 days' then
    raise exception 'FAIL: the next one should be open, a week later, offered first to the same person';
  end if;

  -- During those 10 minutes only the regular may send an offer.
  begin
    insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
    values (v_next.id, v_other, 20000, 240);
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: someone else should wait while the regular has the first 10 minutes';
  end if;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_next.id, v_worker, 20000, 240);

  -- Shared photos: anyone signed in sees them once the job is done.
  perform pg_temp.become(v_other);
  if not private.can_read_task_media(v_worker || '/after.jpg', v_other) then
    raise exception 'FAIL: a shared proof photo of a finished job should be readable';
  end if;
  if (select count(*) from public.worker_proof_photos(v_worker)) <> 1 then
    raise exception 'FAIL: worker_proof_photos should list the shared job';
  end if;
  -- Only the labelled photos are shared, never the rest of the proof (migration 135).
  -- (can_read_task_media cannot be asked here: this connection's session_user is postgres,
  -- which private.is_admin() treats as the owner, so every file reads as allowed.)
  if (select jsonb_array_length(files) from public.worker_proof_photos(v_worker)) <> 1 then
    raise exception 'FAIL: worker_proof_photos should return only the labelled photos';
  end if;

  -- Streaks for the helper.
  perform pg_temp.become(v_worker);
  v_streak := public.my_streaks();
  if (v_streak ->> 'jobsDone')::int <> 1 or (v_streak ->> 'onTimeStreak')::int <> 1
     or (v_streak ->> 'photoJobs')::int <> 1 then
    raise exception 'FAIL: my_streaks gave %', v_streak;
  end if;

  -- Crew: anyone may see the open slots, names only for the crew.
  perform pg_temp.as_admin();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, crew_id, crew_size, crew_slot)
  values (v_poster, 'services', 'Shift a flat', 120000, 300, v_crew, 2, 1),
         (v_poster, 'services', 'Shift a flat', 120000, 300, v_crew, 2, 2);
  perform pg_temp.become(v_other);
  select count(*) into v_slots from public.crew_overview(v_crew);
  if v_slots <> 2 then
    raise exception 'FAIL: crew_overview should show both slots, got %', v_slots;
  end if;
  begin
    insert into public.crew_messages (crew_id, sender_id, body) values (v_crew, v_other, 'hello');
    v_err := null;
  exception when insufficient_privilege then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: someone outside the crew should not be able to write in its chat';
  end if;
  perform pg_temp.become(v_poster);
  insert into public.crew_messages (crew_id, sender_id, body) values (v_crew, v_poster, 'Be there at 9');

  -- Nobody can join a crew by posting a task with its id (migration 135).
  perform pg_temp.as_admin();
  begin
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, crew_id, crew_size, crew_slot)
    values (v_other, 'services', 'Borrowed crew', 20000, 60, v_crew, 2, 1);
    v_err := null;
  exception when raise_exception then v_err := sqlerrm;
  end;
  if v_err is null then
    raise exception 'FAIL: a crew id used by another poster should be refused';
  end if;

  perform pg_temp.as_admin();
  raise notice 'poster_options: ok';
end;
$$;

rollback;
