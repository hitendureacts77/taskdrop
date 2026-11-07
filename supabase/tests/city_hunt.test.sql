-- City Hunt (migration 158): money and access.
--
--   * a Hunt is posted with the database's own end time, and refuses the options it cannot go with;
--   * normal offers on a Hunt are refused; finds after the end are refused; at most 3 finds each;
--   * the poster cannot see the photo, the place, the pin or the note before accepting; a third person sees nothing;
--   * a short wallet refuses the accept and changes nothing; accepting pays the finder exactly as
--     confirm_release would (commission, clearing), charges the poster the reward plus the service fee,
--     closes the other finds and tells their finders;
--   * declining keeps the reason and keeps the find locked; asking for a part tells the finder.
--
-- Uses the seed people Asha (poster), Ravi and Meera (finders) and one made-up stranger.
-- One transaction, rolled back, so no rows are left behind.
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/city_hunt.test.sql

begin;

-- psql runs as postgres, which private.is_admin() treats as staff (migration 040); use the rule app callers get.
create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as
$$ select coalesce(private.has_role(auth.uid(), 'admin'), false) $$;

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

-- A Hunt posted by p_poster, the way the api posts one. Returns the task id.
create or replace function pg_temp.post_hunt(p_poster uuid, p_title text, p_price bigint, p_needs text[]) returns uuid
language plpgsql as $$
declare v_task uuid;
begin
  perform pg_temp.become(p_poster);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng, hunt_window, hunt_needs)
  values (p_poster, 'local_intel', p_title, p_price, 120, 17.448312, 78.391544, '2h', p_needs)
  returning id into v_task;
  perform pg_temp.as_owner();
  return v_task;
end;
$$;

-- A finished private picture that p_owner uploaded for proof. Returns its "media:<id>" reference.
create or replace function pg_temp.photo(p_owner uuid) returns text
language plpgsql as $$
declare v_id uuid;
begin
  insert into public.media (owner, provider, path, purpose, kind, status, attached_at)
  values (p_owner, 'imagekit', '/hunt-test/' || gen_random_uuid() || '.jpg', 'proof', 'image', 'attached', now())
  returning id into v_id;
  return 'media:' || v_id;
end;
$$;

do $$
declare
  v_asha   constant uuid := '5eed0000-0000-4000-8000-000000000001';
  v_ravi   constant uuid := '5eed0000-0000-4000-8000-000000000002';
  v_meera  constant uuid := '5eed0000-0000-4000-8000-000000000003';
  v_kiran  uuid := gen_random_uuid();
  v_fee    numeric := private.setting_num('poster_service_fee_pct', 0.03);
  v_cut    numeric := private.setting_num('worker_commission_pct', 0.20);
  v_price  constant bigint := 30000;
  v_task   uuid;
  v_task2  uuid;
  v_task3  uuid;
  v_find1  uuid;
  v_find2  uuid;
  v_find3  uuid;
  v_err    text;
  v_detail text;
  v_row    record;
  v_n      integer;
  v_bal    bigint;
  v_clear  bigint;
  v_photo  text;
begin
  -- ---- people ---------------------------------------------------------------------------------
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'hunt158+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_asha), (v_ravi), (v_meera), (v_kiran)) as u(id)
  on conflict (id) do nothing;
  insert into public.profiles (id, display_name)
  values (v_asha, 'Asha'), (v_ravi, 'Ravi'), (v_meera, 'Meera'), (v_kiran, 'Kiran')
  on conflict (id) do nothing;
  update public.profiles set onboarded_at = coalesce(onboarded_at, now()), deleted_at = null
   where id in (v_asha, v_ravi, v_meera, v_kiran);
  insert into public.age_checks (user_id, birth_date, passed, min_age)
  select u.id, date '1990-01-01', true, 18 from (values (v_asha), (v_ravi), (v_meera), (v_kiran)) as u(id)
  on conflict (user_id) do update set passed = true;
  insert into public.wallets (user_id) values (v_asha), (v_ravi), (v_meera), (v_kiran) on conflict (user_id) do nothing;
  delete from public.blocks
   where blocker_id in (v_asha, v_ravi, v_meera, v_kiran) and blocked_id in (v_asha, v_ravi, v_meera, v_kiran);
  update public.wallets set balance_minor = 100 where user_id = v_asha;

  -- ---- posting ---------------------------------------------------------------------------------
  v_task := pg_temp.post_hunt(v_asha, 'Find Lantus insulin pens in stock near Kondapur', v_price, array['photo', 'place', 'pin']);
  select * into v_row from public.tasks where id = v_task;
  if v_row.hunt_until is null or v_row.hunt_until < now() + interval '119 minutes' or v_row.hunt_until > now() + interval '121 minutes' then
    raise exception 'FAIL: a 2-hour Hunt must end two hours from the database clock, got %', v_row.hunt_until;
  end if;
  if v_row.due_at is distinct from v_row.hunt_until then
    raise exception 'FAIL: the Hunt''s deadline must be its end, so the lists drop it then';
  end if;
  if v_row.funded_at is not null or (select balance_minor from public.wallets where user_id = v_asha) <> 100 then
    raise exception 'FAIL: nothing may be taken when a Hunt is posted';
  end if;

  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, assignment_mode, hunt_window, hunt_needs)'
    || ' values (%L, ''services'', ''hunt auto'', 30000, 60, ''auto'', ''2h'', array[''photo''])', v_asha));
  if v_err is null or v_err not like '%cannot be combined%' then
    raise exception 'FAIL: a Hunt with Auto-hire must be refused, got %', v_err;
  end if;
  v_err := pg_temp.try(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, repeat_every, hunt_window, hunt_needs)'
    || ' values (%L, ''services'', ''hunt repeat'', 30000, 60, ''week'', ''today'', array[''photo''])', v_asha));
  if v_err is null or v_err not like '%cannot be combined%' then
    raise exception 'FAIL: a Hunt that repeats must be refused, got %', v_err;
  end if;
  v_err := pg_temp.try(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, hunt_window, hunt_needs)'
    || ' values (%L, ''services'', ''hunt nothing'', 30000, 60, ''2h'', array[]::text[])', v_asha));
  if v_err is null then raise exception 'FAIL: a Hunt that asks for nothing must be refused'; end if;
  v_err := pg_temp.try(format('update public.tasks set benchmark_minor = 2000 where id = %L', v_task));
  if v_err is null and (select benchmark_minor from public.tasks where id = v_task) <> v_price then
    raise exception 'FAIL: a Hunt''s reward was lowered after posting';
  end if;

  -- ---- offers are refused; finders take part -------------------------------------------------------
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format(
    'insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes) values (%L, %L, 30000, 60)', v_task, v_ravi));
  if v_err is null or v_err not like '%send a find instead%' then
    raise exception 'FAIL: a normal offer on a Hunt must be refused, got %', v_err;
  end if;
  perform public.hunt_look(v_task);
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format('select public.hunt_look(%L)', v_task));
  if v_err is null then raise exception 'FAIL: the poster cannot look on their own Hunt'; end if;

  -- A find without the photo the Hunt asks for is refused.
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format('select public.hunt_send_find(%L, null, ''Apollo'', 17.45, 78.39, null, null)', v_task));
  if v_err is null or v_err not like '%needs a photo%' then raise exception 'FAIL: a find with no photo was taken, got %', v_err; end if;
  -- Someone else's picture is refused.
  perform pg_temp.as_owner();
  v_photo := pg_temp.photo(v_meera);
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format('select public.hunt_send_find(%L, %L, ''Apollo'', 17.45, 78.39, null, null)', v_task, v_photo));
  if v_err is null then raise exception 'FAIL: a find with another person''s photo was taken'; end if;

  perform pg_temp.as_owner();
  v_photo := pg_temp.photo(v_ravi);
  perform pg_temp.become(v_ravi);
  select id into v_find1 from public.hunt_send_find(v_task, v_photo, 'Apollo Pharmacy, Kondapur X Road', 17.4521, 78.3622, '₹1,230 a pen', 'Two boxes left');
  perform pg_temp.as_owner();
  v_photo := pg_temp.photo(v_ravi);
  perform pg_temp.become(v_ravi);
  perform public.hunt_send_find(v_task, v_photo, 'MedPlus', null, null, null, null);
  perform pg_temp.as_owner();
  v_photo := pg_temp.photo(v_ravi);
  perform pg_temp.become(v_ravi);
  perform public.hunt_send_find(v_task, v_photo, 'Wellness Forever', null, null, null, null);
  perform pg_temp.as_owner();
  v_photo := pg_temp.photo(v_ravi);
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format('select public.hunt_send_find(%L, %L, ''Fourth'', null, null, null, null)', v_task, v_photo));
  if v_err is null or v_err not like '%up to 3 finds%' then raise exception 'FAIL: a fourth find was taken, got %', v_err; end if;

  perform pg_temp.as_owner();
  v_photo := pg_temp.photo(v_meera);
  perform pg_temp.become(v_meera);
  select id into v_find2 from public.hunt_send_find(v_task, v_photo, null, 17.43, 78.40, null, null);

  -- ---- who sees what before accepting -------------------------------------------------------------
  perform pg_temp.become(v_asha);
  select count(*) into v_n from public.hunt_finds;
  if v_n <> 0 then raise exception 'FAIL: the poster read % find rows straight from the table', v_n; end if;
  select count(*) into v_n from public.hunt_finds_for_task(v_task);
  if v_n <> 4 then raise exception 'FAIL: the poster should see 4 finds, got %', v_n; end if;
  select * into v_row from public.hunt_finds_for_task(v_task) f where f.id = v_find1;
  if v_row.photo_path is not null or v_row.place_name is not null or v_row.lat is not null or v_row.lng is not null
     or v_row.price_note is not null or v_row.note is not null or v_row.unlocked then
    raise exception 'FAIL: the poster saw a locked find''s photo, place, pin, price or note: %', row_to_json(v_row);
  end if;
  if not (v_row.has_photo and v_row.has_place and v_row.has_pin and v_row.has_price) or v_row.distance_km is null
     or v_row.finder_name is distinct from 'Ravi' then
    raise exception 'FAIL: the poster should see who sent it, how far, and which proof it carries: %', row_to_json(v_row);
  end if;
  if v_row.distance_km <> round(v_row.distance_km, 1) then raise exception 'FAIL: distance must be rounded to 0.1 km'; end if;
  -- The photo cannot be signed for the poster before accepting.
  if private.can_read_task_media((select photo_path from public.hunt_finds where id = v_find1), v_asha) then
    raise exception 'FAIL: the poster could open a locked find''s photo';
  end if;

  perform pg_temp.become(v_kiran);
  select count(*) into v_n from public.hunt_finds_for_task(v_task);
  if v_n <> 0 then raise exception 'FAIL: a third person saw % finds', v_n; end if;
  select count(*) into v_n from public.hunt_finds;
  if v_n <> 0 then raise exception 'FAIL: a third person read % find rows', v_n; end if;

  perform pg_temp.become(v_meera);
  select count(*) into v_n from public.hunt_finds_for_task(v_task);
  if v_n <> 1 then raise exception 'FAIL: a finder should see only their own find, got %', v_n; end if;
  v_err := pg_temp.try(format('select public.hunt_accept_find(%L)', v_find1));
  if v_err is null then raise exception 'FAIL: a finder accepted a find on someone else''s Hunt'; end if;

  -- ---- asking for a part --------------------------------------------------------------------------
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format('select public.hunt_ask_part(%L, ''photo'')', v_find2));
  if v_err is null or v_err not like '%already has it%' then raise exception 'FAIL: asking for a part the find has, got %', v_err; end if;
  perform public.hunt_ask_part(v_find2, 'place');
  perform pg_temp.as_owner();
  if (select asked_part from public.hunt_finds where id = v_find2) is distinct from 'place'
     or not exists (select 1 from public.notifications where user_id = v_meera and task_id = v_task and kind = 'hunt_ask') then
    raise exception 'FAIL: asking for the place name was not kept or the finder was not told';
  end if;

  -- ---- a short wallet changes nothing ---------------------------------------------------------------
  perform pg_temp.become(v_asha);
  begin
    perform public.hunt_accept_find(v_find1);
    raise exception 'FAIL: a find was accepted with Rs 1 in the wallet';
  exception when others then
    get stacked diagnostics v_err = message_text, v_detail = pg_exception_detail;
    if v_err like 'FAIL:%' then raise; end if;
    if v_err <> 'Not enough money in your wallet' then raise exception 'FAIL: short wallet refused for the wrong reason: %', v_err; end if;
    if v_detail::bigint <> round(v_price * (1 + v_fee))::bigint - 100 then
      raise exception 'FAIL: the shortfall in DETAIL should be %, got %', round(v_price * (1 + v_fee))::bigint - 100, v_detail;
    end if;
  end;
  perform pg_temp.as_owner();
  if (select balance_minor from public.wallets where user_id = v_asha) <> 100
     or (select status::text from public.tasks where id = v_task) <> 'OPEN'
     or (select status from public.hunt_finds where id = v_find1) <> 'pending'
     or exists (select 1 from public.bids where task_id = v_task)
     or exists (select 1 from public.assignments where task_id = v_task) then
    raise exception 'FAIL: a refused accept still changed the wallet, the task, the find, the bids or the assignments';
  end if;

  -- ---- accepting pays the finder like any job -------------------------------------------------------
  update public.wallets set balance_minor = 1000000 where user_id = v_asha;
  v_bal := 1000000;
  v_clear := coalesce((select clearing_minor from public.wallets where user_id = v_ravi), 0);
  delete from public.notifications where task_id = v_task;

  perform pg_temp.become(v_asha);
  perform public.hunt_accept_find(v_find1);
  perform pg_temp.as_owner();

  if (select status::text from public.tasks where id = v_task) <> 'COMPLETED' then
    raise exception 'FAIL: an accepted find should complete the job, got %', (select status from public.tasks where id = v_task);
  end if;
  if (select balance_minor from public.wallets where user_id = v_asha) <> v_bal - round(v_price * (1 + v_fee))::bigint then
    raise exception 'FAIL: the poster should pay the reward plus the service fee';
  end if;
  if (select clearing_minor from public.wallets where user_id = v_ravi) <> v_clear + round(v_price * (1 - v_cut))::bigint then
    raise exception 'FAIL: the finder should be credited exactly as confirm_release would: % expected, got %',
      v_clear + round(v_price * (1 - v_cut))::bigint, (select clearing_minor from public.wallets where user_id = v_ravi);
  end if;
  select * into v_row from public.tasks where id = v_task;
  if v_row.funded_via is distinct from 'wallet' or v_row.locked_minor <> v_price or v_row.clear_at is null
     or v_row.started_at is null or v_row.work_done_at is null then
    raise exception 'FAIL: the job did not go through the normal steps: %', row_to_json(v_row);
  end if;
  if (select status::text from public.assignments where task_id = v_task and worker_id = v_ravi) <> 'released'
     or (select count(*) from public.bids where task_id = v_task) <> 1
     or not exists (select 1 from public.task_proofs where task_id = v_task and worker_id = v_ravi) then
    raise exception 'FAIL: the accepted find should leave one bid, a released assignment and a proof of work';
  end if;
  if (select status from public.hunt_finds where id = v_find1) <> 'accepted'
     or exists (select 1 from public.hunt_finds where task_id = v_task and status = 'pending') then
    raise exception 'FAIL: the accepted find is not marked, or other finds are still pending';
  end if;
  if not exists (select 1 from public.notifications where user_id = v_meera and task_id = v_task and kind = 'hunt_closed')
     or not exists (select 1 from public.notifications where user_id = v_ravi and task_id = v_task and kind = 'hunt_accepted') then
    raise exception 'FAIL: the finders were not told';
  end if;
  if exists (select 1 from public.notifications where task_id = v_task and kind in ('quote', 'picked', 'funded', 'started', 'submitted', 'released')) then
    raise exception 'FAIL: the accept sent the normal job notifications as well';
  end if;
  if exists (select 1 from public.notifications where user_id = v_ravi and task_id = v_task and kind = 'hunt_closed') then
    raise exception 'FAIL: the winning finder was told someone else found it';
  end if;

  -- After accepting, the accepted find is open to the poster, and its photo can be signed for them.
  perform pg_temp.become(v_asha);
  select * into v_row from public.hunt_finds_for_task(v_task) f where f.id = v_find1;
  if not v_row.unlocked or v_row.place_name is distinct from 'Apollo Pharmacy, Kondapur X Road' or v_row.lat is null or v_row.photo_path is null then
    raise exception 'FAIL: the accepted find should be open to the poster: %', row_to_json(v_row);
  end if;
  select * into v_row from public.hunt_finds_for_task(v_task) f where f.id = v_find2;
  if v_row.lat is not null or v_row.unlocked then raise exception 'FAIL: a closed find opened for the poster'; end if;
  perform pg_temp.as_owner();
  if not private.can_read_task_media((select photo_path from public.hunt_finds where id = v_find1), v_asha) then
    raise exception 'FAIL: the poster cannot open the accepted find''s photo';
  end if;
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format('select public.hunt_accept_find(%L)', v_find2));
  if v_err is null then raise exception 'FAIL: a second find was accepted on a closed Hunt'; end if;

  -- ---- declining keeps the reason, and the find stays locked ---------------------------------------
  v_task2 := pg_temp.post_hunt(v_asha, 'Find a size 9 Bata school shoe', 20000, array['place']);
  perform pg_temp.become(v_meera);
  select id into v_find3 from public.hunt_send_find(v_task2, null, 'Bata, Ameerpet', null, null, '₹899', null);
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format('select public.hunt_decline_find(%L, ''rude'')', v_find3));
  if v_err is null then raise exception 'FAIL: a decline reason off the list was taken'; end if;
  perform public.hunt_decline_find(v_find3, 'gone');
  select * into v_row from public.hunt_finds_for_task(v_task2) f where f.id = v_find3;
  if v_row.status <> 'declined' or v_row.decline_reason <> 'gone' or v_row.place_name is not null or v_row.unlocked then
    raise exception 'FAIL: a declined find must keep its reason and stay locked: %', row_to_json(v_row);
  end if;
  perform pg_temp.as_owner();
  if (select decided_at from public.hunt_finds where id = v_find3) is null
     or not exists (select 1 from public.notifications where user_id = v_meera and task_id = v_task2 and kind = 'hunt_declined') then
    raise exception 'FAIL: the decline time was not kept or the finder was not told';
  end if;
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format('select public.hunt_accept_find(%L)', v_find3));
  if v_err is null then raise exception 'FAIL: a declined find was accepted'; end if;

  -- ---- after the end: no more finds, accepting still open for a day ----------------------------------
  v_task3 := pg_temp.post_hunt(v_asha, 'Find a 2016 Activa mirror', 25000, array['photo']);
  perform pg_temp.as_owner();
  v_photo := pg_temp.photo(v_meera);
  perform pg_temp.become(v_meera);
  select id into v_find3 from public.hunt_send_find(v_task3, v_photo, null, null, null, null, null);
  perform pg_temp.as_owner();
  update public.tasks set hunt_until = now() - interval '1 minute' where id = v_task3;
  v_photo := pg_temp.photo(v_ravi);
  perform pg_temp.become(v_ravi);
  v_err := pg_temp.try(format('select public.hunt_send_find(%L, %L, null, null, null, null, null)', v_task3, v_photo));
  if v_err is null or v_err not like '%ended%' then raise exception 'FAIL: a find after the end was taken, got %', v_err; end if;
  v_err := pg_temp.try(format('select public.hunt_look(%L)', v_task3));
  if v_err is null then raise exception 'FAIL: looking on an ended Hunt was taken'; end if;
  perform pg_temp.become(v_asha);
  perform public.hunt_accept_find(v_find3);
  perform pg_temp.as_owner();
  if (select status::text from public.tasks where id = v_task3) <> 'COMPLETED' then
    raise exception 'FAIL: the poster should still be able to accept a find for a day after the end';
  end if;
  update public.tasks set hunt_until = now() - interval '25 hours' where id = v_task2;
  perform pg_temp.become(v_asha);
  v_err := pg_temp.try(format('update public.hunt_finds set status = ''accepted'' where task_id = %L', v_task2));
  if v_err is null and exists (select 1 from public.hunt_finds where task_id = v_task2 and status = 'accepted') then
    raise exception 'FAIL: a poster changed a find straight in the table';
  end if;

  -- ---- grants -------------------------------------------------------------------------------------
  perform pg_temp.as_owner();
  if has_function_privilege('anon', 'public.hunt_accept_find(uuid)', 'EXECUTE')
     or has_function_privilege('anon', 'public.hunt_finds_for_task(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.hunt_send_find(uuid, text, text, double precision, double precision, text, text)', 'EXECUTE')
     or has_table_privilege('authenticated', 'public.hunt_finds', 'INSERT')
     or has_table_privilege('authenticated', 'public.hunt_finds', 'UPDATE')
     or has_table_privilege('anon', 'public.hunt_finds', 'SELECT') then
    raise exception 'FAIL: the Hunt functions or tables have the wrong grants';
  end if;
end;
$$;

rollback;
