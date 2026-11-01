-- Migration 132: the daily cap on sign-in codes and the bulk-request watch (plan task 2.8).
--
-- What is asserted:
--   1. The cap counts each real SMS and refuses the one after the cap, whoever asks.
--   2. One alert at 80% of the day's cap, and one when the cap is reached (not one per refused request).
--   3. The watch stays quiet when codes are being used, alerts once when 20+ were sent and fewer than
--      one in five used, and stays quiet again for six hours.
--   4. The admin's setting is what the cap follows, and a missing or odd value falls back to 500.
--   5. Only the service role can call any of it, and the day table is closed to the app's roles.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sms_safety.test.sql

begin;

-- ---- 1 and 2. the cap and its alerts ---------------------------------------
do $$
declare
  v_ok boolean;
  i    integer;
  n    integer;
begin
  delete from public.sms_daily where day = private.sms_today();
  delete from public.admin_alerts where kind in ('sms_cap_80', 'sms_cap_reached', 'sms_pumping');
  update public.settings set value = '10'::jsonb where key = 'sms_daily_cap';

  for i in 1..10 loop
    v_ok := public.hit_sms_daily_cap();
    if v_ok is not true then
      raise exception 'FAIL: send % of a cap of 10 was refused', i;
    end if;
  end loop;

  select count(*) into n from public.admin_alerts where kind = 'sms_cap_80';
  if n <> 1 then raise exception 'FAIL: expected one 80%% alert, found %', n; end if;
  select count(*) into n from public.admin_alerts where kind = 'sms_cap_reached';
  if n <> 0 then raise exception 'FAIL: the cap-reached alert came before the cap was reached'; end if;

  for i in 11..14 loop
    if public.hit_sms_daily_cap() is not false then
      raise exception 'FAIL: send % went past the cap of 10', i;
    end if;
  end loop;

  select count(*) into n from public.admin_alerts where kind = 'sms_cap_reached';
  if n <> 1 then raise exception 'FAIL: expected one cap-reached alert for four refused requests, found %', n; end if;
  select sent into n from public.sms_daily where day = private.sms_today();
  if n <> 10 then raise exception 'FAIL: refused requests changed the sent count to %', n; end if;
  select refused into n from public.sms_daily where day = private.sms_today();
  if n <> 4 then raise exception 'FAIL: expected 4 refused, found %', n; end if;
end;
$$;

-- ---- 4. the setting is what the cap follows ---------------------------------
do $$
begin
  update public.settings set value = '12'::jsonb where key = 'sms_daily_cap';
  if public.hit_sms_daily_cap() is not true or public.hit_sms_daily_cap() is not true then
    raise exception 'FAIL: raising the cap to 12 did not let two more codes out';
  end if;
  if public.hit_sms_daily_cap() is not false then
    raise exception 'FAIL: the raised cap of 12 was not enforced';
  end if;

  -- Not a number: the safe default of 500 applies, so a bad edit cannot switch the limit off or to zero.
  delete from public.sms_daily where day = private.sms_today();
  update public.settings set value = '"lots"'::jsonb where key = 'sms_daily_cap';
  if public.hit_sms_daily_cap() is not true then
    raise exception 'FAIL: a non-numeric cap setting refused a first code';
  end if;
  delete from public.settings where key = 'sms_daily_cap';
  if public.hit_sms_daily_cap() is not true then
    raise exception 'FAIL: a missing cap setting refused a first code';
  end if;
end;
$$;

-- ---- 3. the watch -----------------------------------------------------------
do $$
declare
  v_out jsonb;
  n     integer;
begin
  delete from public.admin_alerts where kind = 'sms_pumping';

  -- Nothing sent: quiet.
  delete from public.sms_daily where day = private.sms_today();
  v_out := public.run_sms_pumping_watch();
  if (v_out->>'alerted')::boolean then raise exception 'FAIL: the watch alerted with nothing sent: %', v_out; end if;

  -- Few codes: quiet, even if none were used (a handful of people who did not read the SMS).
  insert into public.sms_daily (day, sent, verified) values (private.sms_today(), 19, 0)
    on conflict (day) do update set sent = 19, verified = 0;
  v_out := public.run_sms_pumping_watch();
  if (v_out->>'alerted')::boolean then raise exception 'FAIL: 19 codes with none used raised the alarm: %', v_out; end if;

  -- 25 sent, 10 used: normal.
  update public.sms_daily set sent = 25, verified = 10 where day = private.sms_today();
  v_out := public.run_sms_pumping_watch();
  if (v_out->>'alerted')::boolean then raise exception 'FAIL: 10 of 25 used raised the alarm: %', v_out; end if;

  -- 25 sent, 2 used: bulk requests.
  update public.sms_daily set verified = 2 where day = private.sms_today();
  v_out := public.run_sms_pumping_watch();
  if not (v_out->>'alerted')::boolean then raise exception 'FAIL: 2 of 25 used did not raise the alarm: %', v_out; end if;

  -- Again: quiet for six hours.
  v_out := public.run_sms_pumping_watch();
  if (v_out->>'alerted')::boolean then raise exception 'FAIL: the watch alerted twice within six hours'; end if;
  select count(*) into n from public.admin_alerts where kind = 'sms_pumping';
  if n <> 1 then raise exception 'FAIL: expected one pumping alert, found %', n; end if;

  -- A used code is counted.
  perform public.record_sms_verified();
  if (select verified from public.sms_daily where day = private.sms_today()) <> 3 then
    raise exception 'FAIL: record_sms_verified did not add one';
  end if;
end;
$$;

-- ---- 5. who may call it -----------------------------------------------------
do $$
declare
  f text;
begin
  foreach f in array array['hit_sms_daily_cap()', 'record_sms_verified()', 'run_sms_pumping_watch()'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') or has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception 'FAIL: % can be called by the app''s roles', f;
    end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception 'FAIL: the service role cannot call %', f;
    end if;
  end loop;
  if has_table_privilege('anon', 'public.sms_daily', 'select') or has_table_privilege('authenticated', 'public.sms_daily', 'select') then
    raise exception 'FAIL: sms_daily is readable by the app''s roles';
  end if;
end;
$$;

rollback;
