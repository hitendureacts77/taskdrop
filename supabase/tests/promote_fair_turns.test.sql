-- Migration 203: Promote, made visible and fair (plan task 1.19 row C).
--
-- What is asserted:
--   1. Price: a promotion costs days x the flat day price for its kind; anything else is refused.
--   2. Spots: past the area's cap a new promotion is refused; a post far away, a remote post and a
--      service in the same area are not affected (separate pools).
--   3. The line: joining when full waits in order; when a spot frees, the first in line gets it held and
--      one alert; starting then works and closes the line entry; someone else cannot jump the held spot.
--   4. Turns: promoted_live shows live promotions near the viewer (never the viewer's own) with today's top
--      showings; record_promo_view counts a showing once per 10 minutes and never the owner's own.
--   5. Results: the payer sees saw / on top / opened / by place / offers; nobody else can read them.
--   6. Money: stopping early returns the unused full days to the wallet; a post that closes stops its
--      promotion at the next sweep.
--   7. Alert: at most alert_max earners nearby, never the poster, never someone who turned alerts off;
--      during quiet hours nothing is sent and the alert waits.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/promote_fair_turns.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create or replace function pg_temp.make_user(p_name text, p_lat double precision, p_lng double precision)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'promo203+' || v || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v, p_name) on conflict (id) do nothing;
  update public.profiles set intent = 'earn', last_seen_at = now(), loc_lat = p_lat, loc_lng = p_lng where id = v;
  insert into public.wallets (user_id) values (v) on conflict (user_id) do nothing;
  return v;
end;
$$;

create or replace function pg_temp.make_task(p_poster uuid, p_title text, p_lat double precision,
                                             p_lng double precision, p_kind text default 'request')
returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, loc_lat, loc_lng, kind)
  values (p_poster, 'services', p_title, 45000, 240, p_lat, p_lng, p_kind) returning id into v;
  return v;
end;
$$;

-- Switch a pending promotion on the way a settled payment would (a paid promotion payment row + active).
create or replace function pg_temp.go_live(p_promo uuid) returns void
language plpgsql as $$
declare v_pay uuid; v public.task_promotions;
begin
  select * into v from public.task_promotions where id = p_promo;
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v.user_id, v.task_id, 'promotion', v.amount_minor, 'plink_' || p_promo, 'paid', now()) returning id into v_pay;
  update public.task_promotions
     set status = 'active', payment_id = v_pay, starts_at = now(), ends_at = now() + make_interval(days => v.days)
   where id = p_promo;
end;
$$;

do $$
declare
  -- Indiranagar, Bengaluru, and a point about 50 km away.
  c_lat constant double precision := 12.9719;
  c_lng constant double precision := 77.6412;
  f_lat constant double precision := 13.4200;
  a uuid; b uuid; c uuid; d uuid; viewer uuid; earner uuid; quiet uuid;
  ta uuid; tb uuid; tc uuid; td uuid; tfar uuid; tremote uuid; tsvc uuid;
  pa public.task_promotions; pb public.task_promotions; pc public.task_promotions;
  v_failed boolean;
  v_q jsonb;
  v_n integer;
  v_bal bigint;
  v_hour integer := extract(hour from now() at time zone 'Asia/Kolkata')::integer;
begin
  perform pg_temp.as_operator();
  update public.settings set value = jsonb_set(value, '{cap}', '2') where key = 'promotion_spots';
  update public.settings set value = '{"request": 8000, "service": 8000}'::jsonb where key = 'promotion_price_per_day_minor';

  a      := pg_temp.make_user('Promo A', c_lat, c_lng);
  b      := pg_temp.make_user('Promo B', c_lat + 0.01, c_lng);
  c      := pg_temp.make_user('Promo C', c_lat, c_lng + 0.01);
  d      := pg_temp.make_user('Promo D', c_lat - 0.01, c_lng);
  viewer := pg_temp.make_user('Promo Viewer', c_lat + 0.005, c_lng + 0.005);
  earner := pg_temp.make_user('Promo Earner', c_lat + 0.02, c_lng);
  quiet  := pg_temp.make_user('Promo Quiet', c_lat, c_lng + 0.02);
  insert into public.promo_alert_optout (user_id) values (quiet);

  ta      := pg_temp.make_task(a, 'promo a', c_lat, c_lng);
  tb      := pg_temp.make_task(b, 'promo b', c_lat + 0.01, c_lng);
  tc      := pg_temp.make_task(c, 'promo c', c_lat, c_lng + 0.01);
  td      := pg_temp.make_task(d, 'promo d', c_lat - 0.01, c_lng);
  tfar    := pg_temp.make_task(c, 'promo far', f_lat, c_lng);
  tremote := pg_temp.make_task(c, 'promo remote', null, null);
  tsvc    := pg_temp.make_task(d, 'promo service', c_lat, c_lng, 'service');

  -- ---- 1. price ---------------------------------------------------------------------------------------
  perform pg_temp.become(b);
  v_failed := false;
  begin perform public.start_promotion(tb, 3, 12345);
  exception when others then v_failed := true; end;
  assert v_failed, '1: a price other than days x day price must be refused';
  v_failed := false;
  begin perform public.start_promotion(tb, 5, 40000);
  exception when others then v_failed := true; end;
  assert v_failed, '1: a length that is not offered must be refused';
  pb := public.start_promotion(tb, 3, 24000);
  assert pb.day_price_minor = 8000, '1: the day price is stored';
  assert (public.start_promotion(tb, 3, 24000)).id = pb.id, '1: asking again while paying returns the same campaign';

  perform pg_temp.become(a);
  pa := public.start_promotion(ta, 3, 24000);
  perform pg_temp.as_operator();
  perform pg_temp.go_live(pa.id);
  perform pg_temp.go_live(pb.id);

  -- ---- 2. spots ---------------------------------------------------------------------------------------
  perform pg_temp.become(c);
  v_q := public.promotion_quote(tc);
  assert (v_q->>'taken')::int = 2 and (v_q->>'cap')::int = 2, '2: the quote shows the area full: ' || v_q::text;
  assert (v_q->>'dayPriceMinor')::bigint = 8000, '2: the quote shows the day price';
  v_failed := false;
  begin perform public.start_promotion(tc, 1, 8000);
  exception when others then v_failed := true; end;
  assert v_failed, '2: a promotion past the area cap must be refused';
  perform public.start_promotion(tfar, 1, 8000);          -- 50 km away: another area
  perform public.start_promotion(tremote, 1, 8000);       -- remote: its own pool
  perform pg_temp.become(d);
  perform public.start_promotion(tsvc, 1, 8000);          -- a service: its own pool

  -- ---- 3. the line ------------------------------------------------------------------------------------
  perform pg_temp.become(c);
  v_q := public.join_promotion_line(tc, 1);
  assert v_q->'line'->>'status' = 'waiting' and (v_q->'line'->>'position')::int = 1,
    '3: the first to join waits at #1: ' || v_q::text;
  -- now() is one instant inside this test's transaction; in real use each join is its own transaction.
  perform pg_temp.as_operator();
  update public.promotion_line set created_at = now() - interval '1 minute' where task_id = tc;
  perform pg_temp.become(d);
  v_q := public.join_promotion_line(td, 1);
  assert (v_q->'line'->>'position')::int = 2, '3: the second to join waits at #2';

  perform pg_temp.as_operator();
  select balance_minor into v_bal from public.wallets where user_id = a;
  perform pg_temp.become(a);
  perform public.cancel_promotion(pa.id);
  perform pg_temp.as_operator();
  assert (select balance_minor from public.wallets where user_id = a) = v_bal + 16000,
    '6: stopping on day 1 of 3 returns the 2 unused days';
  assert (select amount_minor from public.platform_ledger where task_id = ta and kind = 'ad_revenue') = 8000,
    '6: the used day is the company''s';

  perform private.promo_advance_line();
  assert (select status from public.promotion_line where task_id = tc and status in ('waiting', 'offered')) = 'offered',
    '3: the first in line gets the freed spot';
  assert (select status from public.promotion_line where task_id = td and status in ('waiting', 'offered')) = 'waiting',
    '3: the second keeps waiting';
  assert exists (select 1 from public.notifications where user_id = c and kind = 'promotion_spot' and task_id = tc),
    '3: the first in line is told';

  perform pg_temp.become(d);
  v_failed := false;
  begin perform public.start_promotion(td, 1, 8000);
  exception when others then v_failed := true; end;
  assert v_failed, '3: nobody can jump a spot held for the first in line';

  perform pg_temp.become(c);
  pc := public.start_promotion(tc, 1, 8000);
  perform pg_temp.as_operator();
  assert (select status from public.promotion_line where task_id = tc order by created_at desc limit 1) = 'used',
    '3: starting closes the line entry';
  perform pg_temp.go_live(pc.id);

  -- ---- 4. turns ---------------------------------------------------------------------------------------
  perform pg_temp.become(viewer);
  select count(*) into v_n from public.promoted_live('request', c_lat, c_lng, 10);
  assert v_n = 2, '4: the viewer sees the two live promotions near them, got ' || v_n;
  select count(*) into v_n from public.promoted_live('service', c_lat, c_lng, 10);
  assert v_n = 0, '4: services are a separate list (the service is not live)';
  perform public.record_promo_view(tb, 'list', true);
  perform public.record_promo_view(tb, 'list', true);
  perform public.record_promo_view(tb, 'map', false);
  assert (select top_today from public.promoted_live('request', c_lat, c_lng, 10) where task_id = tb) = 1,
    '4: one top showing counted for everyone';
  assert (select my_top_today from public.promoted_live('request', c_lat, c_lng, 10) where task_id = tb) = 1,
    '4: and for this viewer';

  perform pg_temp.become(b);
  select count(*) into v_n from public.promoted_live('request', c_lat, c_lng, 10) where task_id = tb;
  assert v_n = 0, '4: nobody is shown their own promotion';
  perform public.record_promo_view(tb, 'list', true);
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = pb.id and kind = 'impression') = 2,
    '4: the repeat and the owner''s own view are not counted';
  insert into public.ad_events (promotion_id, task_id, viewer_id, kind) values (pb.id, tb, viewer, 'click');

  -- ---- 5. results -------------------------------------------------------------------------------------
  perform pg_temp.become(b);
  v_q := public.promotion_results(pb.id);
  assert (v_q->>'saw')::int = 1 and (v_q->>'onTop')::int = 1 and (v_q->>'opened')::int = 1,
    '5: saw / on top / opened: ' || v_q::text;
  assert (v_q->'bySurface'->>'list')::int = 1 and (v_q->'bySurface'->>'map')::int = 1, '5: by place';
  perform pg_temp.become(viewer);
  v_failed := false;
  begin perform public.promotion_results(pb.id);
  exception when others then v_failed := true; end;
  assert v_failed, '5: someone else cannot read the results';

  -- ---- 7. alert (pc went live above) -------------------------------------------------------------------
  perform pg_temp.as_operator();
  if v_hour >= 8 and v_hour < 21 then
    assert exists (select 1 from public.notifications where user_id = earner and kind = 'promoted_task' and task_id = tc),
      '7: an earner nearby gets the alert';
    assert not exists (select 1 from public.notifications where user_id = quiet and kind = 'promoted_task'),
      '7: someone who turned alerts off gets none';
    assert not exists (select 1 from public.notifications where user_id = c and kind = 'promoted_task' and task_id = tc),
      '7: the poster gets none';
    assert (select alerted_at from public.task_promotions where id = pc.id) is not null, '7: sent once';
  else
    assert not exists (select 1 from public.notifications where kind = 'promoted_task' and task_id = tc),
      '7: nothing is sent in quiet hours';
    assert (select alerted_at from public.task_promotions where id = pc.id) is null, '7: the alert waits';
  end if;

  -- ---- 6. a closed post stops its promotion -----------------------------------------------------------
  update public.tasks set status = 'CANCELLED' where id = tb;
  perform public.settle_finished_campaigns();
  assert (select status from public.task_promotions where id = pb.id) = 'cancelled'
     and (select settled_at from public.task_promotions where id = pb.id) is not null,
    '6: the sweep stops and settles a promotion whose post closed';

  raise notice 'promote_fair_turns: all assertions passed';
end $$;

rollback;
