-- Migration 153: daily caps for sign-in codes (finding H40) and Google place search (finding H39).
--
-- What is asserted:
--   1. One number is held to sms_phone_daily_cap codes a day; another number is not affected.
--   2. The reserve: numbers with no account stop at (cap - reserve share) of the day's total, numbers with an
--      account can still use the rest, and the day's total is never passed.
--   3. A refusal counts nothing against the number or the day (only the refused tally), and releasing a send that
--      never happened takes one back, never below zero.
--   4. Only a 64-character hash is accepted as the number key; a plain phone number is refused and nothing is stored.
--   5. A missing or non-numeric setting falls back to the default; a changed setting is what the cap follows.
--   6. Places: a per-person daily cap, a daily total, a person refused for their own cap does not use the total,
--      and a person refused for the total gets their own count back.
--   7. Alerts: one per kind per day, not one per refused request.
--   8. Only the service role can call any of it; the counter tables are closed to the app's roles.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/sms_places_caps.test.sql

begin;

create or replace function pg_temp.hkey(p text) returns text
language sql as $$ select encode(sha256(convert_to('test-key:' || p, 'utf8')), 'hex') $$;

create or replace function pg_temp.make_user() returns uuid
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'test+' || v_user || '@taskdrop.test', '', now(), now(), now());
  return v_user;
end;
$$;

-- ---- 1. one number, one day --------------------------------------------------
do $$
declare
  a text := pg_temp.hkey('a');
  b text := pg_temp.hkey('b');
  r text;
  n integer;
  i integer;
begin
  delete from public.sms_daily where day = private.sms_today();
  delete from private.sms_phone_daily;
  delete from public.admin_alerts where kind in ('sms_cap_80', 'sms_cap_reached', 'sms_new_number_cap');
  update public.settings set value = '500'::jsonb where key = 'sms_daily_cap';
  update public.settings set value = '3'::jsonb where key = 'sms_phone_daily_cap';

  for i in 1..3 loop
    r := public.take_sms_send(a, true);
    if r <> 'ok' then raise exception 'FAIL: code % of a cap of 3 to one number was refused (%)', i, r; end if;
  end loop;
  r := public.take_sms_send(a, true);
  if r <> 'phone_cap' then raise exception 'FAIL: the 4th code to one number was not refused (%)', r; end if;
  r := public.take_sms_send(a, false);
  if r <> 'phone_cap' then raise exception 'FAIL: the cap on one number did not apply to a number with no account (%)', r; end if;

  -- Nothing was counted for the refusals; another number is untouched.
  select sent into n from private.sms_phone_daily where day = private.sms_today() and phone_key = a;
  if n <> 3 then raise exception 'FAIL: refused codes changed the number''s count to %', n; end if;
  select sent into n from public.sms_daily where day = private.sms_today();
  if n <> 3 then raise exception 'FAIL: the day''s sent count should be 3 (real sends only), found %', n; end if;
  select refused into n from public.sms_daily where day = private.sms_today();
  if n <> 2 then raise exception 'FAIL: expected 2 refused, found %', n; end if;
  if public.take_sms_send(b, true) <> 'ok' then raise exception 'FAIL: another number was held back by the first number''s cap'; end if;
end;
$$;

-- ---- 2. the reserve for numbers with an account -------------------------------
do $$
declare
  r        text;
  n        integer;
  i        integer;
  k        text;
begin
  delete from public.sms_daily where day = private.sms_today();
  delete from private.sms_phone_daily;
  delete from public.admin_alerts where kind in ('sms_cap_80', 'sms_cap_reached', 'sms_new_number_cap');
  update public.settings set value = '10'::jsonb where key = 'sms_daily_cap';
  update public.settings set value = '0.2'::jsonb where key = 'sms_account_reserve_pct';
  update public.settings set value = '10'::jsonb where key = 'sms_phone_daily_cap';

  -- New numbers may use 8 of 10.
  for i in 1..8 loop
    r := public.take_sms_send(pg_temp.hkey('new' || i), false);
    if r <> 'ok' then raise exception 'FAIL: new number % of 8 was refused (%)', i, r; end if;
  end loop;
  k := pg_temp.hkey('new9');
  r := public.take_sms_send(k, false);
  if r <> 'day_cap' then raise exception 'FAIL: the 9th new number got a code (%) although 2 of 10 are held for accounts', r; end if;
  select sent into n from private.sms_phone_daily where day = private.sms_today() and phone_key = k;
  if coalesce(n, 0) <> 0 then raise exception 'FAIL: a refused new number was counted (%)', n; end if;
  select count(*) into n from public.admin_alerts where kind = 'sms_new_number_cap';
  if n <> 1 then raise exception 'FAIL: expected one new-number alert, found %', n; end if;
  select count(*) into n from public.admin_alerts where kind = 'sms_cap_reached';
  if n <> 0 then raise exception 'FAIL: the day-cap alert fired while the reserve was still free'; end if;

  -- More refused new numbers: still one alert.
  perform public.take_sms_send(pg_temp.hkey('new10'), false);
  select count(*) into n from public.admin_alerts where kind = 'sms_new_number_cap';
  if n <> 1 then raise exception 'FAIL: expected still one new-number alert, found %', n; end if;

  -- Numbers with an account use the reserve, and no more.
  if public.take_sms_send(pg_temp.hkey('acct1'), true) <> 'ok' then raise exception 'FAIL: account number 1 refused'; end if;
  if public.take_sms_send(pg_temp.hkey('acct2'), true) <> 'ok' then raise exception 'FAIL: account number 2 refused'; end if;
  r := public.take_sms_send(pg_temp.hkey('acct3'), true);
  if r <> 'day_cap' then raise exception 'FAIL: the day''s total of 10 was passed (%)', r; end if;
  select sent into n from public.sms_daily where day = private.sms_today();
  if n <> 10 then raise exception 'FAIL: the day''s total should stop at 10, found %', n; end if;
  select count(*) into n from public.admin_alerts where kind = 'sms_cap_reached';
  if n <> 1 then raise exception 'FAIL: expected one cap-reached alert, found %', n; end if;
  select count(*) into n from public.admin_alerts where kind = 'sms_cap_80';
  if n <> 1 then raise exception 'FAIL: expected one 80%% alert, found %', n; end if;

  -- A reserve of 0 gives everyone the whole allowance; 0.9 is the most that can be held back.
  delete from public.sms_daily where day = private.sms_today();
  delete from private.sms_phone_daily;
  update public.settings set value = '0'::jsonb where key = 'sms_account_reserve_pct';
  for i in 1..10 loop
    if public.take_sms_send(pg_temp.hkey('z' || i), false) <> 'ok' then raise exception 'FAIL: a reserve of 0 held a send back'; end if;
  end loop;
  delete from public.sms_daily where day = private.sms_today();
  delete from private.sms_phone_daily;
  update public.settings set value = '5'::jsonb where key = 'sms_account_reserve_pct';
  if public.take_sms_send(pg_temp.hkey('y1'), false) <> 'ok' then raise exception 'FAIL: a silly reserve closed the door for good'; end if;
  update public.settings set value = '0.2'::jsonb where key = 'sms_account_reserve_pct';
end;
$$;

-- ---- 3. a send that never happened is taken back --------------------------------
do $$
declare
  k text := pg_temp.hkey('release');
  n integer;
  d integer;
begin
  delete from public.sms_daily where day = private.sms_today();
  delete from private.sms_phone_daily;
  update public.settings set value = '500'::jsonb where key = 'sms_daily_cap';

  perform public.take_sms_send(k, true);
  perform public.take_sms_send(k, true);
  perform public.release_sms_send(k);
  select sent into n from private.sms_phone_daily where day = private.sms_today() and phone_key = k;
  select sent into d from public.sms_daily where day = private.sms_today();
  if n <> 1 or d <> 1 then raise exception 'FAIL: release should leave 1 and 1, found % and %', n, d; end if;

  perform public.release_sms_send(k);
  perform public.release_sms_send(k);   -- nothing left to take back
  select sent into n from private.sms_phone_daily where day = private.sms_today() and phone_key = k;
  select sent into d from public.sms_daily where day = private.sms_today();
  if n <> 0 or d <> 0 then raise exception 'FAIL: release went below zero or missed (% and %)', n, d; end if;
end;
$$;

-- ---- 4. only a hash is accepted ---------------------------------------------------
do $$
declare
  bad text;
  n   integer;
begin
  foreach bad in array array['9876543210', '', 'not a hash', repeat('A', 64), repeat('f', 63), repeat('f', 65)] loop
    begin
      perform public.take_sms_send(bad, true);
      raise exception 'FAIL: take_sms_send accepted "%"', bad;
    exception when sqlstate '22023' then
      null;
    end;
    begin
      perform public.release_sms_send(bad);
      raise exception 'FAIL: release_sms_send accepted "%"', bad;
    exception when sqlstate '22023' then
      null;
    end;
  end loop;
  begin
    perform public.take_sms_send(null, true);
    raise exception 'FAIL: take_sms_send accepted null';
  exception when sqlstate '22023' then
    null;
  end;
  select count(*) into n from private.sms_phone_daily where phone_key !~ '^[0-9a-f]{64}$';
  if n <> 0 then raise exception 'FAIL: a key that is not a hash was stored'; end if;
end;
$$;

-- ---- 5. settings ------------------------------------------------------------------
do $$
declare
  i integer;
  r text;
  k text := pg_temp.hkey('settings');
begin
  delete from public.sms_daily where day = private.sms_today();
  delete from private.sms_phone_daily;

  -- Not a number: the default (10 a number) applies, so a bad edit cannot switch the limit off or to zero.
  update public.settings set value = '"lots"'::jsonb where key = 'sms_phone_daily_cap';
  for i in 1..10 loop
    if public.take_sms_send(k, true) <> 'ok' then raise exception 'FAIL: a non-numeric setting refused code % (default is 10)', i; end if;
  end loop;
  if public.take_sms_send(k, true) <> 'phone_cap' then raise exception 'FAIL: the default of 10 a number was not enforced'; end if;

  -- Missing row: same default.
  delete from private.sms_phone_daily;
  delete from public.settings where key = 'sms_phone_daily_cap';
  for i in 1..10 loop
    if public.take_sms_send(k, true) <> 'ok' then raise exception 'FAIL: a missing setting refused code %', i; end if;
  end loop;
  if public.take_sms_send(k, true) <> 'phone_cap' then raise exception 'FAIL: a missing setting did not fall back to 10'; end if;

  -- Zero or negative never closes the door entirely: at least one a day.
  delete from private.sms_phone_daily;
  insert into public.settings (key, value) values ('sms_phone_daily_cap', '0'::jsonb)
    on conflict (key) do update set value = '0'::jsonb;
  if public.take_sms_send(k, true) <> 'ok' then raise exception 'FAIL: a cap of 0 refused the first code'; end if;
  if public.take_sms_send(k, true) <> 'phone_cap' then raise exception 'FAIL: a cap of 0 was not held at 1'; end if;
  update public.settings set value = '10'::jsonb where key = 'sms_phone_daily_cap';

  -- The seeded defaults exist.
  if (select value from public.settings where key = 'sms_account_reserve_pct') is null
     or (select value from public.settings where key = 'places_user_daily_cap') is null
     or (select value from public.settings where key = 'places_daily_cap') is null then
    raise exception 'FAIL: a seeded setting is missing';
  end if;
end;
$$;

-- ---- 6 and 7. place search ------------------------------------------------------------
do $$
declare
  u1 uuid := pg_temp.make_user();
  u2 uuid := pg_temp.make_user();
  r  text;
  n  integer;
  i  integer;
begin
  delete from private.places_daily;
  delete from private.places_user_daily;
  delete from public.admin_alerts where kind = 'places_cap_reached';
  update public.settings set value = '3'::jsonb where key = 'places_user_daily_cap';
  update public.settings set value = '5'::jsonb where key = 'places_daily_cap';

  for i in 1..3 loop
    r := public.take_places_daily(u1);
    if r <> 'ok' then raise exception 'FAIL: search % of 3 for one person was refused (%)', i, r; end if;
  end loop;
  r := public.take_places_daily(u1);
  if r <> 'user_cap' then raise exception 'FAIL: the 4th search for one person was not refused (%)', r; end if;
  select calls into n from private.places_daily where day = private.sms_today();
  if n <> 3 then raise exception 'FAIL: a person''s refused search used the total (%)', n; end if;
  select calls into n from private.places_user_daily where day = private.sms_today() and user_id = u1;
  if n <> 3 then raise exception 'FAIL: a refused search changed the person''s count to %', n; end if;

  -- Another person has their own allowance, up to the day's total of 5.
  for i in 1..2 loop
    r := public.take_places_daily(u2);
    if r <> 'ok' then raise exception 'FAIL: the other person''s search % was refused (%)', i, r; end if;
  end loop;
  r := public.take_places_daily(u2);
  if r <> 'total_cap' then raise exception 'FAIL: the day''s total of 5 was passed (%)', r; end if;
  select calls into n from private.places_daily where day = private.sms_today();
  if n <> 5 then raise exception 'FAIL: the day''s total should stop at 5, found %', n; end if;
  select calls into n from private.places_user_daily where day = private.sms_today() and user_id = u2;
  if n <> 2 then raise exception 'FAIL: a search refused for the total kept the person''s count at %, expected 2', n; end if;

  perform public.take_places_daily(u2);
  select count(*) into n from public.admin_alerts where kind = 'places_cap_reached';
  if n <> 1 then raise exception 'FAIL: expected one places alert for repeated refusals, found %', n; end if;

  -- Raising the setting is what the cap follows; text falls back to the default (150 a person).
  update public.settings set value = '"many"'::jsonb where key = 'places_user_daily_cap';
  update public.settings set value = '3000'::jsonb where key = 'places_daily_cap';
  for i in 1..147 loop perform public.take_places_daily(u2); end loop;   -- 2 + 147 = 149
  if public.take_places_daily(u2) <> 'ok' then raise exception 'FAIL: the default of 150 a person was not used (150th)'; end if;
  if public.take_places_daily(u2) <> 'user_cap' then raise exception 'FAIL: 151st search was not refused by the default cap'; end if;

  begin
    perform public.take_places_daily(null);
    raise exception 'FAIL: take_places_daily accepted no person';
  exception when sqlstate '22023' then
    null;
  end;
end;
$$;

-- ---- 8. who may call it --------------------------------------------------------------
do $$
declare
  f text;
  t text;
begin
  foreach f in array array['take_sms_send(text, boolean)', 'release_sms_send(text)', 'take_places_daily(uuid)'] loop
    if has_function_privilege('anon', 'public.' || f, 'execute') or has_function_privilege('authenticated', 'public.' || f, 'execute') then
      raise exception 'FAIL: % can be called by the app''s roles', f;
    end if;
    if not has_function_privilege('service_role', 'public.' || f, 'execute') then
      raise exception 'FAIL: the service role cannot call %', f;
    end if;
  end loop;
  foreach t in array array['private.sms_phone_daily', 'private.places_daily', 'private.places_user_daily'] loop
    if has_table_privilege('anon', t, 'select') or has_table_privilege('authenticated', t, 'select') then
      raise exception 'FAIL: % is readable by the app''s roles', t;
    end if;
  end loop;
  if has_function_privilege('anon', 'private.cap_setting(text, numeric)', 'execute')
     or has_function_privilege('authenticated', 'private.cap_setting(text, numeric)', 'execute') then
    raise exception 'FAIL: cap_setting can be called by the app''s roles';
  end if;
end;
$$;

-- A signed-in person calling the functions directly is refused by the function itself too.
do $$
begin
  perform set_config('request.jwt.claims', json_build_object('role', 'authenticated', 'sub', gen_random_uuid())::text, true);
  begin
    perform public.take_sms_send(pg_temp.hkey('x'), true);
    raise exception 'FAIL: a signed-in role could count an SMS';
  exception when sqlstate '42501' then
    null;
  end;
  begin
    perform public.take_places_daily(gen_random_uuid());
    raise exception 'FAIL: a signed-in role could count a search';
  exception when sqlstate '42501' then
    null;
  end;
  perform set_config('request.jwt.claims', '', true);
end;
$$;

rollback;
