-- 132: SMS safety (plan task 2.8, hole H10): a daily cap on sign-in codes, and a watch for bulk requests.
--
-- Bots can ask for a sign-in code for thousands of numbers, and every real SMS costs money ("SMS pumping").
-- phone-auth already limits sends per network address (30 an hour), per number (5 an hour, 60 seconds apart),
-- and, from this change, per install of the app and to Indian mobile numbers only. This adds the ceiling that
-- holds even when an attacker has many addresses and many numbers:
--
--   settings.sms_daily_cap        how many real SMS may go out per day (India time). Default 500; the admin
--                                 changes it under Settings ("Sign-in codes a day"). Staging sends no real SMS,
--                                 so nothing is counted there.
--   hit_sms_daily_cap()           called by phone-auth before each real SMS: counts it and answers false once the
--                                 day's cap is used up. One alert at 80% and one when the cap is reached.
--   record_sms_verified()         called when a code is used.
--   run_sms_pumping_watch()       every 15 minutes (Inngest): 20 or more codes sent today and fewer than one in
--                                 five used is how bulk requests look. One admin alert, then quiet for six hours.
--
-- Additive: one table, one setting row, three functions. All three functions are for the service role only.

insert into public.settings (key, value)
values ('sms_daily_cap', '500'::jsonb)
on conflict (key) do nothing;

create table if not exists public.sms_daily (
  day      date primary key,
  sent     integer not null default 0,
  verified integer not null default 0,
  refused  integer not null default 0
);
alter table public.sms_daily enable row level security;
revoke all on table public.sms_daily from public, anon, authenticated;

comment on table public.sms_daily is 'Real sign-in SMS sent, used and refused per day (India time). Service role only (migration 132).';

-- India's calendar day, so "per day" means the owner's day.
create or replace function private.sms_today() returns date
language sql stable
set search_path = ''
as $$ select (now() at time zone 'Asia/Kolkata')::date $$;
revoke all on function private.sms_today() from public, anon, authenticated;

create or replace function public.hit_sms_daily_cap()
returns boolean
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_cap     integer;
  v_today   date := private.sms_today();
  v_sent    integer;
begin
  perform private.assert_service_caller();

  select case when jsonb_typeof(value) = 'number' then floor((value #>> '{}')::numeric)::integer end
    into v_cap
    from public.settings where key = 'sms_daily_cap';
  v_cap := greatest(coalesce(v_cap, 500), 1);

  -- Counted and checked in one statement: two requests at the cap cannot both get in.
  insert into public.sms_daily as d (day, sent) values (v_today, 1)
  on conflict (day) do update set sent = d.sent + 1
   where d.sent < v_cap
  returning d.sent into v_sent;

  if v_sent is null then
    update public.sms_daily set refused = refused + 1 where day = v_today;
    if not exists (select 1 from public.admin_alerts
                    where kind = 'sms_cap_reached' and created_at >= v_today::timestamp at time zone 'Asia/Kolkata') then
      perform public.record_admin_alert(
        'sms_cap_reached',
        'Today''s sign-in code limit was reached',
        'No more sign-in codes will be sent today (the limit is ' || v_cap || '). If this is real demand, raise "Sign-in codes a day" in Settings. '
          || 'If not, someone is requesting codes in bulk: people can still sign in with Google.',
        jsonb_build_object('cap', v_cap));
    end if;
    return false;
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
  return true;
end;
$$;

create or replace function public.record_sms_verified()
returns void
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
begin
  perform private.assert_service_caller();
  insert into public.sms_daily as d (day, verified) values (private.sms_today(), 1)
  on conflict (day) do update set verified = d.verified + 1;
end;
$$;

create or replace function public.run_sms_pumping_watch()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_sent     integer;
  v_verified integer;
  v_alerted  boolean := false;
begin
  perform private.assert_service_caller();

  select coalesce(sent, 0), coalesce(verified, 0) into v_sent, v_verified
    from public.sms_daily where day = private.sms_today();
  v_sent := coalesce(v_sent, 0);
  v_verified := coalesce(v_verified, 0);

  if v_sent >= 20 and v_verified * 5 < v_sent
     and not exists (select 1 from public.admin_alerts
                      where kind = 'sms_pumping' and created_at > now() - interval '6 hours') then
    perform public.record_admin_alert(
      'sms_pumping',
      'Many sign-in codes sent, few used',
      v_sent || ' codes were sent today and only ' || v_verified || ' were used. This is how bulk requests (SMS pumping) look. '
        || 'Check Sentry for "per-IP code budget used up", and lower "Sign-in codes a day" in Settings if it continues.',
      jsonb_build_object('sent', v_sent, 'verified', v_verified));
    v_alerted := true;
  end if;

  return jsonb_build_object('sent', v_sent, 'verified', v_verified, 'alerted', v_alerted);
end;
$$;

revoke all on function public.hit_sms_daily_cap(), public.record_sms_verified(), public.run_sms_pumping_watch()
  from public, anon, authenticated;
grant execute on function public.hit_sms_daily_cap(), public.record_sms_verified(), public.run_sms_pumping_watch()
  to service_role;
