-- Follow-ups to the guest hardening review (migration 157).
--
--   * private.guest_area_label: digits of any script are digits, and a label with
--     three or fewer comma parts shows its last part only;
--   * public.api_guest_spend (seven arguments): a per-network budget checked before
--     the shared row, and a request refused by the network or as busy leaves no count
--     behind on the address or network rows;
--   * only the service role may call the new limiter.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/guest_review_followups.test.sql

begin;

do $$
declare
  v_fn   text;
  v_got  text;
  v_hits integer;
  v_k1   uuid := gen_random_uuid();
  v_k2   uuid := gen_random_uuid();
  v_k3   uuid := gen_random_uuid();
  v_n1   uuid := gen_random_uuid();
  v_n2   uuid := gen_random_uuid();
begin
  -- ---- privileges ---------------------------------------------------------------------
  v_fn := 'public.api_guest_spend(uuid,uuid,integer,integer,integer,integer,integer)';
  if has_function_privilege('anon', v_fn, 'EXECUTE') or has_function_privilege('authenticated', v_fn, 'EXECUTE') then
    raise exception 'FAIL: % must not be callable with the public key or a sign-in', v_fn;
  end if;
  if not has_function_privilege('service_role', v_fn, 'EXECUTE') then
    raise exception 'FAIL: the api (service role) must be able to call %', v_fn;
  end if;

  -- ---- area label: digits of any script ------------------------------------------------
  -- Devanagari digits in a ward and in a part of their own, Telugu digits, Tamil digits.
  v_got := private.guest_area_label('Ward ' || chr(2407) || chr(2406) || chr(2410) || ' Kondapur');
  if v_got is distinct from 'Kondapur' then raise exception 'FAIL: a Devanagari ward number must go, got %', v_got; end if;
  v_got := private.guest_area_label('Sai Nagar ' || chr(3175) || chr(3176) || ', Madhapur, Hyderabad, India');
  if v_got is distinct from 'Madhapur, Hyderabad' then raise exception 'FAIL: a Telugu number must drop its part, got %', v_got; end if;
  v_got := private.guest_area_label('Gali ' || chr(2407) || chr(2408) || ', Block B, Sector 4, Ameerpet, Hyderabad');
  if v_got is distinct from 'Ameerpet, Hyderabad' then raise exception 'FAIL: a Devanagari number must drop its part, got %', v_got; end if;
  v_got := private.guest_area_label('Anna Nagar ' || chr(3047) || chr(3048) || ', Chennai, Tamil Nadu, India');
  if v_got is distinct from 'Chennai, Tamil Nadu' then raise exception 'FAIL: a Tamil number must drop its part, got %', v_got; end if;
  -- Letters of those scripts are not digits.
  v_got := private.guest_area_label(chr(2350) || chr(2366) || chr(2343) || chr(2366) || chr(2346) || chr(2369) || chr(2352));
  if v_got is null then raise exception 'FAIL: a Devanagari area name must be kept'; end if;

  -- ---- area label: three parts or fewer show the last part only ------------------------------
  v_got := private.guest_area_label('Lotus Park, Hyderabad');
  if v_got is distinct from 'Hyderabad' then raise exception 'FAIL: a two-part label shows its last part only, got %', v_got; end if;
  v_got := private.guest_area_label('Raj Palace, Ameerpet, Hyderabad');
  if v_got is distinct from 'Hyderabad' then raise exception 'FAIL: a three-part label shows its last part only, got %', v_got; end if;
  v_got := private.guest_area_label('Flat 5, Raj Palace, Ameerpet, Hyderabad');
  if v_got is distinct from 'Ameerpet, Hyderabad' then raise exception 'FAIL: four parts keep the last two kept parts, got %', v_got; end if;
  if private.guest_area_label('Kondapur') is distinct from 'Kondapur' or private.guest_area_label('Remote') is distinct from 'Remote' then
    raise exception 'FAIL: a single plain area and "Remote" are kept';
  end if;
  if private.guest_area_label(null) is not null or private.guest_area_label(' , ') is not null then
    raise exception 'FAIL: nothing gives no label';
  end if;

  -- ---- limiter: the network budget ------------------------------------------------------------
  -- Address limit 100, network limit 10, huge soft and hard: two 5s pass on one network, then another
  -- address of the same network is refused and is not left counted.
  if public.api_guest_spend(v_k1, v_n1, 5, 100, 10, 1000000, 2000000) <> 'ok'
     or public.api_guest_spend(v_k2, v_n1, 5, 100, 10, 1000000, 2000000) <> 'ok' then
    raise exception 'FAIL: requests within the network limit should go ahead';
  end if;
  v_got := public.api_guest_spend(v_k3, v_n1, 1, 100, 10, 1000000, 2000000);
  if v_got <> 'limited' then raise exception 'FAIL: a third address over the network limit should be refused, got %', v_got; end if;
  select coalesce(sum(r.hits), 0) into v_hits from private.api_rate r
   where r.user_id = v_k3 and r.bucket = 'guest' and r.window_start > now() - interval '2 minutes';
  if v_hits <> 0 then raise exception 'FAIL: a request refused by the network limit must not stay counted on its address, got %', v_hits; end if;
  select r.hits into v_hits from private.api_rate r
   where r.user_id = v_n1 and r.bucket = 'guest_net' and r.window_start > now() - interval '2 minutes';
  if v_hits <> 10 then raise exception 'FAIL: the network counter should stand at 10, got %', v_hits; end if;
  -- Another network is not affected.
  if public.api_guest_spend(v_k3, v_n2, 1, 100, 10, 1000000, 2000000) <> 'ok' then
    raise exception 'FAIL: one network being over must not refuse another';
  end if;
  -- The address limit still holds.
  if public.api_guest_spend(v_k1, v_n2, 200, 100, 1000, 1000000, 2000000) <> 'limited' then
    raise exception 'FAIL: over the address limit should be refused';
  end if;

  -- ---- limiter: busy leaves no count on the address or the network ------------------------------
  update private.api_rate set hits = 1000
   where user_id = '00000000-0000-0000-0000-000000000000' and bucket = 'guest_all'
     and window_start > now() - interval '2 minutes';
  if public.api_guest_spend(v_k2, v_n2, 1, 100, 10, 1000, 1005) <> 'heavy_off' then
    raise exception 'FAIL: over the soft ceiling only light reads go ahead';
  end if;
  select r.hits into v_hits from private.api_rate r
   where r.user_id = v_k2 and r.bucket = 'guest' and r.window_start > now() - interval '2 minutes';
  declare
    v_addr_before integer := v_hits;
    v_net_before  integer;
    v_addr_after  integer;
    v_net_after   integer;
  begin
    select r.hits into v_net_before from private.api_rate r
     where r.user_id = v_n2 and r.bucket = 'guest_net' and r.window_start > now() - interval '2 minutes';
    v_got := public.api_guest_spend(v_k2, v_n2, 5, 100, 10, 1000, 1005);
    if v_got <> 'busy' then raise exception 'FAIL: over the hard ceiling nothing goes ahead, got %', v_got; end if;
    select r.hits into v_addr_after from private.api_rate r
     where r.user_id = v_k2 and r.bucket = 'guest' and r.window_start > now() - interval '2 minutes';
    select r.hits into v_net_after from private.api_rate r
     where r.user_id = v_n2 and r.bucket = 'guest_net' and r.window_start > now() - interval '2 minutes';
    if v_addr_after is distinct from v_addr_before then
      raise exception 'FAIL: a request refused as busy must not stay counted on its address (% -> %)', v_addr_before, v_addr_after;
    end if;
    if v_net_after is distinct from v_net_before then
      raise exception 'FAIL: a request refused as busy must not stay counted on its network (% -> %)', v_net_before, v_net_after;
    end if;
  end;
  if public.api_guest_spend(null, v_n1, 1, 100, 10, 1000, 1005) <> 'limited'
     or public.api_guest_spend(v_k1, null, 1, 100, 10, 1000, 1005) <> 'limited'
     or public.api_guest_spend(v_k1, '00000000-0000-0000-0000-000000000000', 1, 100, 10, 1000, 1005) <> 'limited'
     or public.api_guest_spend('00000000-0000-0000-0000-000000000000', v_n1, 1, 100, 10, 1000, 1005) <> 'limited' then
    raise exception 'FAIL: no key, or the shared key, must never pass as an address or a network';
  end if;

  raise notice 'guest review follow-ups ok';
end;
$$;

rollback;
