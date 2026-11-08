-- The guest door, hardened (migration 154; hunt round 2 H61, H62, H63).
--
--   * the place label a guest gets is the area only, never a flat or house
--     number, on task cards and person cards (H61);
--   * the guest task card is a fixed list of fields, and every column of
--     public.tasks has been decided: on the guest list or on the "never" list.
--     A new column on tasks fails this test until someone decides (H62);
--   * the guest limiter counts per address and for all guests together, and
--     refused requests are not counted (H63).
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/guest_hardening.test.sql

begin;

do $$
declare
  -- What a guest may see of a task. Adding a name here puts that column on the open internet.
  v_guest text[] := array[
    'id', 'poster_id', 'kind', 'pillar', 'category', 'skills', 'difficulty', 'title', 'description',
    'benchmark_minor', 'time_limit_minutes', 'flag', 'status', 'assignment_mode', 'due_at',
    'media_kind', 'media_path', 'media_seconds', 'loc_lat', 'loc_lng', 'loc_label',
    'milestones', 'topup_pct', 'flash_until', 'live_answer', 'crew_id', 'crew_size', 'crew_slot',
    'repeat_every', 'want_photos', 'photos_public', 'created_at', 'updated_at', 'hunt_until', 'hunt_window', 'hunt_needs'];
  -- Reviewed and never shown to a guest: money, hiring and the job's progress.
  v_never text[] := array[
    'funding_payment_id', 'funded_at', 'funded_via', 'funded_minor', 'funded_credits_minor', 'wallet_refunded_at',
    'locked_bid_id', 'locked_minor', 'payout_mode', 'preferred_worker_id', 'preferred_until', 'repeated_from',
    'started_at', 'work_done_at', 'auto_complete_at', 'completed_at', 'clear_at', 'cleared_at'];
  v_cols   text[];
  v_poster uuid := gen_random_uuid();
  v_task   uuid;
  v_card   jsonb;
  v_key    uuid := gen_random_uuid();
  v_other  uuid := gen_random_uuid();
  v_got    text;
  v_hits   integer;
  v_fn     text;
begin
  -- ---- H62: every tasks column is decided ---------------------------------------
  select array_agg(c.column_name::text order by c.ordinal_position) into v_cols
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'tasks'
     and not (c.column_name::text = any(v_guest || v_never));
  if v_cols is not null then
    raise exception 'FAIL: public.tasks has columns nobody decided on for guests: %. Add each to the guest list in private.guest_task_json (migration 154 or later) and here, or to the "never" list here.', v_cols;
  end if;
  if v_guest && v_never then
    raise exception 'FAIL: a column is on both the guest and the never list';
  end if;

  -- ---- only the service role may call the new functions -------------------------
  foreach v_fn in array array['public.api_guest_spend(uuid,integer,integer,integer,integer)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'FAIL: % must not be callable with the public key or a sign-in', v_fn;
    end if;
    if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
      raise exception 'FAIL: the api (service role) must be able to call %', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['private.guest_area_label(text)', 'private.guest_task_json(public.tasks)', 'private.guest_person_json(public.profiles)'] loop
    if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
      raise exception 'FAIL: % must not be callable with the public key or a sign-in', v_fn;
    end if;
  end loop;

  -- ---- H61: the area only ----------------------------------------------------------
  if private.guest_area_label('Flat 302, Sai Residency, 5th Cross, Madhapur, Hyderabad') is distinct from 'Madhapur, Hyderabad' then
    raise exception 'FAIL: a door-level address must come down to its area, got %',
      private.guest_area_label('Flat 302, Sai Residency, 5th Cross, Madhapur, Hyderabad');
  end if;
  if private.guest_area_label('2222, Ward 104 Kondapur') is distinct from 'Kondapur' then
    raise exception 'FAIL: "2222, Ward 104 Kondapur" should be "Kondapur", got %', private.guest_area_label('2222, Ward 104 Kondapur');
  end if;
  if private.guest_area_label('Koramangala, Bengaluru, Karnataka 560034, India') is distinct from 'Koramangala, Bengaluru' then
    raise exception 'FAIL: PIN code and country must go, got %', private.guest_area_label('Koramangala, Bengaluru, Karnataka 560034, India');
  end if;
  -- (Four typed parts: since migration 157 a label of three or fewer parts shows its last part only.)
  if private.guest_area_label('Near Big Bazaar, SR Nagar, Ameerpet, Hyderabad') is distinct from 'Ameerpet, Hyderabad' then
    raise exception 'FAIL: a landmark must go, got %', private.guest_area_label('Near Big Bazaar, SR Nagar, Ameerpet, Hyderabad');
  end if;
  if private.guest_area_label('Remote') is distinct from 'Remote' or private.guest_area_label('Indiranagar') is distinct from 'Indiranagar' then
    raise exception 'FAIL: "Remote" and a plain area must be kept as they are';
  end if;
  if private.guest_area_label('Plot 12 Road 3') is not null or private.guest_area_label(null) is not null or private.guest_area_label('  ') is not null then
    raise exception 'FAIL: nothing but a door, or nothing at all, gives no label';
  end if;

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_poster, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'guesthard+' || v_poster || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_poster, 'Asha Rao') on conflict (id) do nothing;
  update public.profiles
     set loc_label = 'Flat 402, Sai Residency, Madhapur, Hyderabad', loc_lat = 17.448312, loc_lng = 78.391544
   where id = v_poster;
  insert into public.wallets (user_id) values (v_poster) on conflict (user_id) do nothing;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng, loc_label)
  values (v_poster, 'services', 'Fix a leaking tap', 50000, 60, 17.448312, 78.391544, 'House 9-1-23, 3rd Cross, Kondapur, Hyderabad')
  returning id into v_task;

  select x into v_card from public.guest_open_posts(null, 500, null, null, null, null, null, null, null, array[v_task]) x;
  if v_card is null then raise exception 'FAIL: the open post should show to a guest'; end if;
  if v_card->>'loc_label' is distinct from 'Kondapur, Hyderabad' or v_card->'poster'->>'loc_label' is distinct from 'Madhapur, Hyderabad' then
    raise exception 'FAIL: a guest must get the area only, got task % and poster %', v_card->>'loc_label', v_card->'poster'->>'loc_label';
  end if;
  if (v_card->>'loc_lat')::numeric <> 17.45 or (v_card->'poster'->>'loc_lng')::numeric <> 78.39 then
    raise exception 'FAIL: places stay rounded to two decimals, got %', v_card;
  end if;
  -- The stored label is untouched (computed when read).
  if (select loc_label from public.tasks where id = v_task) <> 'House 9-1-23, 3rd Cross, Kondapur, Hyderabad' then
    raise exception 'FAIL: the stored label must not change';
  end if;

  -- ---- H62: the card carries the guest list and nothing else ------------------------
  v_card := private.guest_task_json((select t from public.tasks t where t.id = v_task));
  select array_agg(k order by k) into v_cols from jsonb_object_keys(v_card) k where not (k = any(v_guest));
  if v_cols is not null then
    raise exception 'FAIL: the guest task card carries fields not on the guest list: %', v_cols;
  end if;
  if (select count(*) from jsonb_object_keys(v_card)) <> cardinality(v_guest) then
    raise exception 'FAIL: the guest task card should carry all % guest fields, got %', cardinality(v_guest), v_card;
  end if;

  -- ---- H63: the limiter ---------------------------------------------------------------
  -- Address limit 10, soft 1000, hard 2000 for all guests: two 5s pass, the next is refused and not counted.
  if public.api_guest_spend(v_key, 5, 10, 1000000, 2000000) <> 'ok' or public.api_guest_spend(v_key, 5, 10, 1000000, 2000000) <> 'ok' then
    raise exception 'FAIL: requests within the address limit should go ahead';
  end if;
  if public.api_guest_spend(v_key, 1, 10, 1000000, 2000000) <> 'limited' then
    raise exception 'FAIL: over the address limit should be refused';
  end if;
  select r.hits into v_hits from private.api_rate r
   where r.user_id = v_key and r.bucket = 'guest' and r.window_start > now() - interval '2 minutes';
  if v_hits <> 10 then raise exception 'FAIL: a refused request must not be counted, got % hits', v_hits; end if;
  -- Another address is not affected.
  if public.api_guest_spend(v_other, 1, 10, 1000000, 2000000) <> 'ok' then
    raise exception 'FAIL: one address being over must not refuse another';
  end if;
  -- All guests together: set the shared counter near the ceilings.
  update private.api_rate set hits = 1000
   where user_id = '00000000-0000-0000-0000-000000000000' and bucket = 'guest_all'
     and window_start > now() - interval '2 minutes';
  v_got := public.api_guest_spend(gen_random_uuid(), 1, 10, 1000, 1005);
  if v_got <> 'heavy_off' then raise exception 'FAIL: over the soft ceiling only light reads go ahead, got %', v_got; end if;
  v_got := public.api_guest_spend(gen_random_uuid(), 5, 10, 1000, 1005);
  if v_got <> 'busy' then raise exception 'FAIL: over the hard ceiling nothing goes ahead, got %', v_got; end if;
  if public.api_guest_spend(null, 1, 10, 1000, 1005) <> 'limited'
     or public.api_guest_spend('00000000-0000-0000-0000-000000000000', 1, 10, 1000, 1005) <> 'limited' then
    raise exception 'FAIL: no key, or the shared key, must never pass as an address';
  end if;

  raise notice 'guest hardening ok';
end;
$$;

rollback;
