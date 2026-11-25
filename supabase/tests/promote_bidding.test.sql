-- Migration 203: Promote with bidding (plan task 1.19 row C).
--
-- What is asserted:
--   1. Budget: any whole-rupee daily budget from Rs 20 to Rs 1,000 times an offered length; anything else
--      is refused. Asking again while paying returns the same campaign.
--   2. Auction: the higher score wins place 1; the winner pays the second price (next score / own match),
--      never more than its bid; the last winner pays the floor. Never the viewer's own promotion.
--   3. Repeats: the same top place within repeat_minutes is not charged again; with repeats off a viewer
--      counts at most viewer_top_per_day top shows a day per promotion, then others get the place.
--   4. Budget limits: a promotion without enough money left cannot win; only posts in the viewer's list
--      (p_task_ids) can win; services are a separate auction.
--   5. Views: record_promo_view is free, never a top place, counted once per 10 minutes.
--   6. Results: the payer sees spend, top shows, average price, saw / on top / opened; nobody else can.
--   7. No stop, no refund: a paid campaign cannot be cancelled; an unpaid one can. A quiet day's leftover
--      raises the next day's budget. Past its end with money left it runs on; after the run-on days it
--      settles with the whole amount as company revenue and nothing back. A closed post ends it the same.
--      The payer is told when it goes live and when it ends.
--   8. Alert: earners nearby, never the poster or someone who turned alerts off; none in quiet hours.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/promote_bidding.test.sql

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

-- Switch a pending promotion on the way a settled payment would, starting at the start of today (India)
-- so today's budget is exactly the daily budget whatever the time of day the test runs.
create or replace function pg_temp.go_live(p_promo uuid) returns void
language plpgsql as $$
declare v_pay uuid; v public.task_promotions;
begin
  select * into v from public.task_promotions where id = p_promo;
  insert into public.payments (user_id, task_id, purpose, amount_minor, provider_ref, status, paid_at)
  values (v.user_id, v.task_id, 'promotion', v.amount_minor, 'plink_' || p_promo, 'paid', now()) returning id into v_pay;
  update public.task_promotions
     set status = 'active', payment_id = v_pay, starts_at = private.promo_day_start(),
         ends_at = private.promo_day_start() + make_interval(days => v.days)
   where id = p_promo;
end;
$$;

do $$
declare
  -- Indiranagar, Bengaluru.
  c_lat constant double precision := 12.9719;
  c_lng constant double precision := 77.6412;
  a uuid; b uuid; c uuid; d uuid; v1 uuid; v2 uuid; v3 uuid; earner uuid; quiet uuid;
  ta uuid; tb uuid; tc uuid; tsvc uuid; tremote uuid;
  pa public.task_promotions; pb public.task_promotions; pc public.task_promotions; ps public.task_promotions;
  px public.task_promotions;
  v_failed boolean;
  v_q jsonb;
  v_n integer;
  v_price_a bigint; v_price_b bigint;
  v_spent bigint;
  v_bal bigint;
  v_allow bigint;
  v_hour integer := extract(hour from now() at time zone 'Asia/Kolkata')::integer;
begin
  perform pg_temp.as_operator();
  update public.settings set value = '{"min_day_minor": 2000, "max_day_minor": 100000, "floor_minor": 20,
      "target_shows_day": 100, "top_slots": 2, "viewer_top_per_day": 3, "repeat_minutes": 10, "run_on_days": 2,
      "area_km": 10, "alert_max": 30, "alert_radius_km": 10, "alert_per_person_day": 3,
      "views_per_viewer_day": 20}'::jsonb
   where key = 'promotion_bidding';
  update public.settings set value = '[1, 3, 7]'::jsonb where key = 'promotion_durations_days';

  a      := pg_temp.make_user('Promo A', c_lat, c_lng);
  b      := pg_temp.make_user('Promo B', c_lat + 0.01, c_lng);
  c      := pg_temp.make_user('Promo C', c_lat, c_lng + 0.01);
  d      := pg_temp.make_user('Promo D', c_lat - 0.01, c_lng);
  v1     := pg_temp.make_user('Promo Viewer 1', c_lat, c_lng);
  v2     := pg_temp.make_user('Promo Viewer 2', c_lat, c_lng);
  v3     := pg_temp.make_user('Promo Viewer 3', c_lat, c_lng);
  earner := pg_temp.make_user('Promo Earner', c_lat + 0.02, c_lng);
  quiet  := pg_temp.make_user('Promo Quiet', c_lat, c_lng + 0.02);
  insert into public.promo_alert_optout (user_id) values (quiet);

  ta      := pg_temp.make_task(a, 'promo a', c_lat, c_lng);              -- 0 km from the viewers
  tb      := pg_temp.make_task(b, 'promo b', c_lat + 0.01, c_lng);       -- about 1.1 km
  tc      := pg_temp.make_task(c, 'promo c', c_lat, c_lng + 0.01);       -- about 1.1 km
  tsvc    := pg_temp.make_task(d, 'promo service', c_lat, c_lng, 'service');
  tremote := pg_temp.make_task(d, 'promo remote', null, null);

  -- ---- 1. budget --------------------------------------------------------------------------------------
  perform pg_temp.become(a);
  v_failed := false;
  begin perform public.start_promotion(ta, 3, 12345);
  exception when others then v_failed := true; end;
  assert v_failed, '1: an amount that is not days x a whole daily budget must be refused';
  v_failed := false;
  begin perform public.start_promotion(ta, 3, 4500);           -- Rs 15 a day
  exception when others then v_failed := true; end;
  assert v_failed, '1: a daily budget under Rs 20 must be refused';
  v_failed := false;
  begin perform public.start_promotion(ta, 1, 100100);         -- Rs 1,001 a day
  exception when others then v_failed := true; end;
  assert v_failed, '1: a daily budget over Rs 1,000 must be refused';
  v_failed := false;
  begin perform public.start_promotion(ta, 5, 40000);
  exception when others then v_failed := true; end;
  assert v_failed, '1: a length that is not offered must be refused';
  pa := public.start_promotion(ta, 3, 24000);                  -- Rs 80 a day
  assert pa.day_budget_minor = 8000, '1: the daily budget is stored';
  assert (public.start_promotion(ta, 3, 24000)).id = pa.id, '1: asking again while paying returns the same campaign';

  perform pg_temp.become(b);
  pb := public.start_promotion(tb, 3, 90000);                  -- Rs 300 a day
  perform pg_temp.become(c);
  pc := public.start_promotion(tc, 1, 2000);                   -- Rs 20 for one day
  perform pg_temp.as_operator();
  perform pg_temp.go_live(pa.id);
  perform pg_temp.go_live(pb.id);
  perform pg_temp.go_live(pc.id);
  assert exists (select 1 from public.notifications where user_id = a and kind = 'promotion_live' and task_id = ta),
    '1: the payer is told the promotion is live';

  -- ---- 2. auction -------------------------------------------------------------------------------------
  -- Bids: b ~Rs 3.00, a ~Rs 0.80, c Rs 0.20 (floor). Match: a is nearest (1.0), b and c ~0.73.
  -- Scores: b ~219, a ~80, c ~15 -> b first, a second.
  perform pg_temp.become(v1);
  select count(*) into v_n from public.promoted_live('request', c_lat, c_lng, 10);
  assert v_n = 3, '2: the viewer gets all three live promotions near them, got ' || v_n;
  assert (select place from public.promoted_live('request', c_lat, c_lng, 10) where task_id = tb) = 1,
    '2: the highest score is place 1';
  perform pg_temp.as_operator();
  select spent_minor into v_price_b from public.task_promotions where id = pb.id;
  select spent_minor into v_price_a from public.task_promotions where id = pa.id;
  assert (select spent_minor from public.task_promotions where id = pc.id) = 0, '2: the loser pays nothing';
  assert v_price_a = 20, '2: the last winner pays the floor, got ' || v_price_a;
  assert v_price_b between 100 and 120,
    '2: the winner pays just enough to beat the next (about 80 / 0.73), not its own bid (300), got ' || v_price_b;
  assert (select count(*) from public.ad_events where promotion_id = pb.id and top and viewer_id = v1) = 1,
    '2: one top show is written for the winner';

  perform pg_temp.become(v2);
  assert (select count(*) from public.promoted_live('request', c_lat, c_lng, 10, 'map') where top) = 0,
    '2: the map lists promoted posts without an auction';
  perform pg_temp.as_operator();
  assert not exists (select 1 from public.ad_events where viewer_id = v2), '2: and charges nothing';
  perform pg_temp.become(a);
  select count(*) into v_n from public.promoted_live('request', c_lat, c_lng, 10) where task_id = ta;
  assert v_n = 0, '2: nobody is shown their own promotion';

  -- ---- 3. repeats and the per-viewer cap --------------------------------------------------------------
  perform pg_temp.become(v1);
  perform public.promoted_live('request', c_lat, c_lng, 10);   -- (the second call above was free too)
  perform pg_temp.as_operator();
  assert (select spent_minor from public.task_promotions where id = pb.id) = v_price_b,
    '3: the same top place within a few minutes is not charged again';

  update public.settings set value = jsonb_set(value, '{repeat_minutes}', '0') where key = 'promotion_bidding';
  perform pg_temp.become(v1);
  perform public.promoted_live('request', c_lat, c_lng, 10);   -- b's 2nd counted top show for v1
  perform public.promoted_live('request', c_lat, c_lng, 10);   -- b's 3rd
  assert (select top from public.promoted_live('request', c_lat, c_lng, 10) where task_id = tb) = false,
    '3: after 3 top shows today this viewer sees other promotions on top';
  assert (select top from public.promoted_live('request', c_lat, c_lng, 10) where task_id = tc) = true,
    '3: the next one gets the place';
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = pb.id and top and viewer_id = v1) = 3,
    '3: three counted top shows for b, no more';
  update public.settings set value = jsonb_set(value, '{repeat_minutes}', '10') where key = 'promotion_bidding';

  -- ---- 4. budget limits, the viewer's list, services ---------------------------------------------------
  update public.task_promotions set spent_minor = amount_minor - 10 where id = pc.id;   -- 10 paise left
  perform pg_temp.become(v2);
  assert (select count(*) from public.promoted_live('request', c_lat, c_lng, 10) where task_id = tc) = 0,
    '4: a promotion without money for one more show is not offered';
  perform pg_temp.become(v3);
  select count(*) into v_n from public.promoted_live('request', c_lat, c_lng, 10, 'list', array[ta]);
  assert v_n = 1, '4: only posts in the viewer''s list can be shown, got ' || v_n;
  assert (select count(*) from public.promoted_live('service', c_lat, c_lng, 10)) = 0,
    '4: services are a separate auction (none live yet)';
  perform pg_temp.become(d);
  ps := public.start_promotion(tsvc, 7, 35000);                -- Rs 50 a day
  perform pg_temp.as_operator();
  perform pg_temp.go_live(ps.id);
  perform pg_temp.become(v3);
  assert (select place from public.promoted_live('service', c_lat, c_lng, 10, 'list') where task_id = tsvc) = 1,
    '4: a live service wins the service auction';
  assert (select count(*) from public.promoted_live('request', c_lat, c_lng, 10, 'list', array[ta]) where task_id = tsvc) = 0,
    '4: and never shows in the task auction';

  -- ---- 5. views -----------------------------------------------------------------------------------------
  perform pg_temp.become(v2);
  perform public.record_promo_view(ta, 'map', true);
  perform public.record_promo_view(ta, 'map', true);
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = pa.id and viewer_id = v2 and surface = 'map') = 1,
    '5: one map view, counted once';
  assert not (select top from public.ad_events where promotion_id = pa.id and viewer_id = v2 and surface = 'map'),
    '5: a view the app reports is never a top place';
  assert (select cost_minor from public.ad_events where promotion_id = pa.id and viewer_id = v2 and surface = 'map') = 0,
    '5: views are free';
  insert into public.ad_events (promotion_id, task_id, viewer_id, kind) values (pb.id, tb, v1, 'click');

  -- ---- 6. results -------------------------------------------------------------------------------------
  perform pg_temp.become(b);
  v_q := public.promotion_results(pb.id);
  select spent_minor into v_spent from public.task_promotions where id = pb.id;
  assert (v_q->>'spentMinor')::bigint = v_spent and (v_q->>'topShows')::int = 4,
    '6: spend and top shows: ' || v_q::text;
  assert (v_q->>'onTop')::int = 2 and (v_q->>'opened')::int = 1 and (v_q->>'dayBudgetMinor')::bigint = 30000,
    '6: on top / opened / daily budget: ' || v_q::text;
  assert (v_q->>'avgPriceMinor')::bigint = round(v_spent / 4.0), '6: average price per top show';
  perform pg_temp.become(v1);
  v_failed := false;
  begin perform public.promotion_results(pb.id);
  exception when others then v_failed := true; end;
  assert v_failed, '6: someone else cannot read the results';
  perform pg_temp.become(c);
  v_q := public.promotion_quote(tc);
  assert (v_q->>'others')::int = 2 and (v_q->>'minDayMinor')::int = 2000, '6: the quote sees two others: ' || v_q::text;
  assert (v_q->>'areaPriceMinor') is not null, '6: and the price of a top show in the area';

  -- ---- 7. no stop, no refund ---------------------------------------------------------------------------
  perform pg_temp.become(a);
  v_failed := false;
  begin perform public.cancel_promotion(pa.id);
  exception when others then v_failed := true; end;
  assert v_failed, '7: a paid promotion cannot be stopped';
  perform pg_temp.become(d);
  px := public.start_promotion(tremote, 1, 5000);
  px := public.cancel_promotion(px.id);
  assert px.status = 'cancelled', '7: an unpaid campaign (payment page left) can be cancelled';

  -- A quiet first day: started yesterday, nothing spent before today -> today's budget is what is left
  -- spread over the 2 days left, more than the Rs 80 daily budget.
  perform pg_temp.as_operator();
  update public.task_promotions
     set starts_at = private.promo_day_start() - interval '1 day',
         ends_at = private.promo_day_start() + interval '2 days',
         spent_minor = (select coalesce(sum(cost_minor), 0) from public.ad_events
                         where promotion_id = pa.id and top and created_at >= private.promo_day_start())
   where id = pa.id returning * into pa;
  select o_allow into v_allow from private.promo_today(pa);
  assert v_allow = 12000, '7: a quiet day''s leftover moves to the next days, got ' || v_allow;

  select balance_minor into v_bal from public.wallets where user_id = a;
  update public.task_promotions set ends_at = now() - interval '1 hour' where id = pa.id;
  perform public.settle_finished_campaigns();
  assert (select status from public.task_promotions where id = pa.id) = 'active',
    '7: past its end with money left it runs on';
  perform pg_temp.become(v2);
  assert (select count(*) from public.promoted_live('request', c_lat, c_lng, 10) where task_id = ta) = 1,
    '7: and is still shown';
  perform pg_temp.as_operator();
  update public.task_promotions set ends_at = now() - interval '3 days' where id = pa.id;
  perform public.settle_finished_campaigns();
  assert (select status from public.task_promotions where id = pa.id) = 'expired'
     and (select settled_at from public.task_promotions where id = pa.id) is not null,
    '7: after the run-on days it finishes';
  assert (select amount_minor from public.platform_ledger where task_id = ta and kind = 'ad_revenue') = 24000,
    '7: the whole paid amount is the company''s';
  assert (select balance_minor from public.wallets where user_id = a) = v_bal, '7: nothing is refunded';
  assert exists (select 1 from public.notifications where user_id = a and kind = 'promotion_ended' and task_id = ta),
    '7: the payer is told it ended';

  update public.tasks set status = 'CANCELLED' where id = tb;
  perform public.settle_finished_campaigns();
  assert (select status from public.task_promotions where id = pb.id) = 'cancelled'
     and (select settled_at from public.task_promotions where id = pb.id) is not null,
    '7: a closed post ends its promotion at the next sweep';
  assert (select amount_minor from public.platform_ledger where task_id = tb and kind = 'ad_revenue') = 90000,
    '7: with no refund either';

  -- ---- 8. alert (pc went live above) -------------------------------------------------------------------
  if v_hour >= 8 and v_hour < 21 then
    assert exists (select 1 from public.notifications where user_id = earner and kind = 'promoted_task' and task_id = tc),
      '8: an earner nearby gets the alert';
    assert not exists (select 1 from public.notifications where user_id = quiet and kind = 'promoted_task'),
      '8: someone who turned alerts off gets none';
    assert not exists (select 1 from public.notifications where user_id = c and kind = 'promoted_task' and task_id = tc),
      '8: the poster gets none';
    assert (select alerted_at from public.task_promotions where id = pc.id) is not null, '8: sent once';
  else
    assert not exists (select 1 from public.notifications where kind = 'promoted_task' and task_id = tc),
      '8: nothing is sent in quiet hours';
    assert (select alerted_at from public.task_promotions where id = pc.id) is null, '8: the alert waits';
  end if;

  raise notice 'promote_bidding: all assertions passed';
end $$;

rollback;
