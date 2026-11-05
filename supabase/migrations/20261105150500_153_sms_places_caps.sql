-- 153: cost caps for sign-in codes and place search (plan task 2.14, hunt-round-2 findings H40 and H39).
--
-- H40 (SMS). Before: 5 codes an hour to one number (so up to 120 a day to one victim), and one shared day total
-- (hit_sms_daily_cap, migration 132) that phone-auth counted BEFORE it checked anything else. Lookups that ended in
-- "no account", requests that hit the 60-second wait, and sends the provider then refused all used up the allowance,
-- and a bot with a few addresses could burn all 500 and lock real people out of SMS sign-in.
-- Now phone-auth calls take_sms_send() at the last moment before a real SMS goes out, and it:
--   * caps one number at sms_phone_daily_cap codes a day (default 10, India time);
--   * keeps a share of the day's total (sms_account_reserve_pct, default 0.2 = 20%) for numbers that ALREADY have an
--     account, so a bot spreading codes over brand-new numbers stops before the allowance does;
--   * counts nothing when it refuses, and release_sms_send() takes one back when the code was never sent
--     (the provider failed), so only real sends are counted.
-- The number is never given to the database: phone-auth sends a keyed one-way hash (64 hex characters), and the
-- tables hold nothing else. hit_sms_daily_cap() stays in place (the 132 test and old callers still use it) but
-- phone-auth no longer calls it.
--
-- H39 (place search). Google Places is billed per call. Before: 60 searches per 10 minutes per person and nothing else.
-- Now places-search calls take_places_daily() right before each billed Google call: places_user_daily_cap a day per
-- person (default 150) and places_daily_cap a day across everyone (default 3000), India time. Past either cap the
-- function answers from OpenStreetMap, which the app already accepts, so nothing breaks and nothing is billed.
--
-- Settings (all read with private.setting_num, defaults seeded here, changeable by the owner):
--   sms_phone_daily_cap 10, sms_account_reserve_pct 0.2, places_user_daily_cap 150, places_daily_cap 3000.
--
-- Additive: four settings rows, three tables, three service-role functions, one private helper.

insert into public.settings (key, value) values
  ('sms_phone_daily_cap',     '10'::jsonb),
  ('sms_account_reserve_pct', '0.2'::jsonb),
  ('places_user_daily_cap',   '150'::jsonb),
  ('places_daily_cap',        '3000'::jsonb)
on conflict (key) do nothing;

-- A number setting through private.setting_num, or its default when the row is missing or is not a number
-- (setting_num would raise on a text value, and a bad edit must not switch a limit off or take sign-in down).
create or replace function private.cap_setting(p_key text, p_default numeric)
returns numeric
language sql stable
set search_path = public, private, pg_temp
as $$
  select case
           when exists (select 1 from public.settings where key = p_key and jsonb_typeof(value) = 'number')
           then private.setting_num(p_key, p_default)
           else p_default
         end
$$;
revoke all on function private.cap_setting(text, numeric) from public, anon, authenticated;

-- ---- SMS: real codes sent to one number today -------------------------------
create table if not exists private.sms_phone_daily (
  day       date    not null,
  phone_key text    not null,
  sent      integer not null default 0,
  primary key (day, phone_key)
);
alter table private.sms_phone_daily enable row level security;
revoke all on table private.sms_phone_daily from public, anon, authenticated;
comment on table private.sms_phone_daily is 'Real sign-in SMS sent per number per day (India time). phone_key is a keyed one-way hash, never the number. Migration 153.';

-- Counts one real SMS and answers 'ok', 'phone_cap' (this number has had enough today) or 'day_cap' (the day's
-- allowance is used up; for a number with no account, the part of it that is not held in reserve).
-- Called after every other check has passed, immediately before the provider is called.
create or replace function public.take_sms_send(p_phone_key text, p_has_account boolean)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_today     date := private.sms_today();
  v_phone_cap integer := greatest(floor(private.cap_setting('sms_phone_daily_cap', 10))::integer, 1);
  v_cap       integer := greatest(floor(private.cap_setting('sms_daily_cap', 500))::integer, 1);
  v_pct       numeric := least(greatest(private.cap_setting('sms_account_reserve_pct', 0.2), 0), 0.9);
  v_limit     integer;
  v_phone_n   integer;
  v_sent      integer;
begin
  perform private.assert_service_caller();
  -- Only a hash may be stored here: a plain number, or anything else odd, is a bug in the caller.
  if p_phone_key is null or p_phone_key !~ '^[0-9a-f]{64}$' then
    raise exception 'take_sms_send needs the hashed number' using errcode = '22023';
  end if;

  -- A number with no account may use the day's allowance only up to the part that is not held in reserve.
  v_limit := case when p_has_account is true then v_cap else v_cap - floor(v_cap * v_pct)::integer end;

  -- This number first (counted and checked in one statement); the step below undoes it if the day's total refuses.
  insert into private.sms_phone_daily as p (day, phone_key, sent) values (v_today, p_phone_key, 1)
  on conflict (day, phone_key) do update set sent = p.sent + 1
   where p.sent < v_phone_cap
  returning p.sent into v_phone_n;

  if v_phone_n is null then
    insert into public.sms_daily as d (day, refused) values (v_today, 1)
    on conflict (day) do update set refused = d.refused + 1;
    return 'phone_cap';
  end if;

  -- The day's total, counted and checked in one statement: two requests at the limit cannot both get in.
  insert into public.sms_daily as d (day, sent) values (v_today, 1)
  on conflict (day) do update set sent = d.sent + 1
   where d.sent < v_limit
  returning d.sent into v_sent;

  if v_sent is null then
    update private.sms_phone_daily set sent = sent - 1 where day = v_today and phone_key = p_phone_key and sent > 0;
    update public.sms_daily set refused = refused + 1 where day = v_today;
    if p_has_account is true then
      if not exists (select 1 from public.admin_alerts
                      where kind = 'sms_cap_reached' and created_at >= v_today::timestamp at time zone 'Asia/Kolkata') then
        perform public.record_admin_alert(
          'sms_cap_reached',
          'Today''s sign-in code limit was reached',
          'No more sign-in codes will be sent today (the limit is ' || v_cap || '). If this is real demand, raise "Sign-in codes a day" in Settings. '
            || 'If not, someone is requesting codes in bulk: people can still sign in with Google.',
          jsonb_build_object('cap', v_cap));
      end if;
    elsif not exists (select 1 from public.admin_alerts
                       where kind = 'sms_new_number_cap' and created_at >= v_today::timestamp at time zone 'Asia/Kolkata') then
      perform public.record_admin_alert(
        'sms_new_number_cap',
        'Sign-in codes to new numbers stopped for today',
        'Codes to numbers with no account have used their share of today''s limit (' || v_limit || ' of ' || v_cap
          || '). The rest is kept for people who already have an account. If this is not real sign-up demand, someone is requesting codes in bulk.',
        jsonb_build_object('limit', v_limit, 'cap', v_cap));
    end if;
    return 'day_cap';
  end if;

  -- Old rows are no use: tidy once a day, on the first send.
  if v_sent = 1 then
    delete from private.sms_phone_daily where day < v_today - 1;
  end if;

  if v_sent = ceil(v_cap * 0.8)::integer
     and not exists (select 1 from public.admin_alerts
                      where kind = 'sms_cap_80' and created_at >= v_today::timestamp at time zone 'Asia/Kolkata') then
    perform public.record_admin_alert(
      'sms_cap_80',
      'Sign-in codes: 80% of today''s limit used',
      v_sent || ' of ' || v_cap || ' codes have been sent today.',
      jsonb_build_object('sent', v_sent, 'cap', v_cap));
  end if;
  return 'ok';
end;
$$;

-- Takes back one count when the code was never sent (the store failed or the provider refused), so a failed send
-- is not counted. Never goes below zero.
create or replace function public.release_sms_send(p_phone_key text)
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_today date := private.sms_today();
begin
  perform private.assert_service_caller();
  if p_phone_key is null or p_phone_key !~ '^[0-9a-f]{64}$' then
    raise exception 'release_sms_send needs the hashed number' using errcode = '22023';
  end if;
  update private.sms_phone_daily set sent = sent - 1 where day = v_today and phone_key = p_phone_key and sent > 0;
  update public.sms_daily set sent = sent - 1 where day = v_today and sent > 0;
end;
$$;

-- ---- Places: billed Google calls today ---------------------------------------
create table if not exists private.places_daily (
  day   date    primary key,
  calls integer not null default 0
);
alter table private.places_daily enable row level security;
revoke all on table private.places_daily from public, anon, authenticated;

create table if not exists private.places_user_daily (
  day     date    not null,
  user_id uuid    not null references auth.users (id) on delete cascade,
  calls   integer not null default 0,
  primary key (day, user_id)
);
alter table private.places_user_daily enable row level security;
revoke all on table private.places_user_daily from public, anon, authenticated;

comment on table private.places_daily is 'Billed Google Places calls per day (India time). Migration 153.';
comment on table private.places_user_daily is 'Billed Google Places calls per person per day (India time). Migration 153.';

-- Counts one billed Google call and answers 'ok', 'user_cap' or 'total_cap'. Past a cap nothing stays counted
-- and the caller answers from OpenStreetMap instead.
create or replace function public.take_places_daily(p_user uuid)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_today    date := private.sms_today();
  v_user_cap integer := greatest(floor(private.cap_setting('places_user_daily_cap', 150))::integer, 1);
  v_cap      integer := greatest(floor(private.cap_setting('places_daily_cap', 3000))::integer, 1);
  v_user_n   integer;
  v_total_n  integer;
begin
  perform private.assert_service_caller();
  if p_user is null then
    raise exception 'take_places_daily needs a person' using errcode = '22023';
  end if;

  insert into private.places_user_daily as u (day, user_id, calls) values (v_today, p_user, 1)
  on conflict (day, user_id) do update set calls = u.calls + 1
   where u.calls < v_user_cap
  returning u.calls into v_user_n;
  if v_user_n is null then return 'user_cap'; end if;

  insert into private.places_daily as d (day, calls) values (v_today, 1)
  on conflict (day) do update set calls = d.calls + 1
   where d.calls < v_cap
  returning d.calls into v_total_n;

  if v_total_n is null then
    update private.places_user_daily set calls = calls - 1 where day = v_today and user_id = p_user and calls > 0;
    if not exists (select 1 from public.admin_alerts
                    where kind = 'places_cap_reached' and created_at >= v_today::timestamp at time zone 'Asia/Kolkata') then
      perform public.record_admin_alert(
        'places_cap_reached',
        'Today''s Google place-search limit was reached',
        'Place search has switched to OpenStreetMap for the rest of the day (the limit is ' || v_cap || ' Google searches). '
          || 'The app keeps working. If this is real demand, raise places_daily_cap; if not, someone is searching in bulk.',
        jsonb_build_object('cap', v_cap));
    end if;
    return 'total_cap';
  end if;

  -- Old rows are no use: tidy once a day, on the first call.
  if v_total_n = 1 then
    delete from private.places_user_daily where day < v_today - 1;
    delete from private.places_daily where day < v_today - 30;
  end if;
  return 'ok';
end;
$$;

-- Supabase hands EXECUTE on new public functions to anon and authenticated. Take it back, then give it to the service role alone.
revoke all on function public.take_sms_send(text, boolean), public.release_sms_send(text), public.take_places_daily(uuid)
  from public, anon, authenticated;
grant execute on function public.take_sms_send(text, boolean), public.release_sms_send(text), public.take_places_daily(uuid)
  to service_role;
