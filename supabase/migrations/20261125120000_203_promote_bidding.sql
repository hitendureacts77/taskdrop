-- 203 -- Promote with bidding, made visible (plan task 1.19 row C, owner 25 Nov).
--
-- Before: a paid promotion only moved the post up on Home, was charged per view at about a paisa, and
-- the payer never saw a result. Owner: "I can't see where other people actually see my promoted task".
-- Then: "use meta kind of money plan ... i dont want a fixed price", and "if it is paid, it is done.
-- That campaign should run": no stop button and no refund.
--
-- After (design https://claude.ai/artifact/2MyMdqTXiEUZA95mz9QQrP, Version 2):
--   * The payer picks a daily budget (Rs 20 to Rs 1,000) and a length (1, 3 or 7 days) and pays the
--     total upfront. A paid promotion always runs to the end: it cannot be stopped and is never refunded.
--   * Every time someone opens a list, promoted_live() runs an auction for the top 2 places among the
--     live promotions that match them (same kind, nearby, in the list they are looking at, budget left
--     today). Two separate auctions: tasks (kind 'request', shown to workers) and services (kind
--     'service', shown to customers).
--   * Score = bid x match. The bid is automatic from today's budget (about today's budget / 100 shows,
--     halved when spending runs ahead of the clock). Match = nearness x open rate.
--   * Second price: a winner pays just enough to beat the next score (next score / own match), never more
--     than its own bid and never less than the floor (Rs 0.20). Ties: fewest top shows today, then nearer.
--   * Pacing: today's budget = what is left, spread over the time left, so a quiet day's leftover moves
--     to the next days. If money is still left when the length ends, the promotion runs on (at most
--     run_on_days more) until it is used. Whatever is still unused after that is kept, like the rest.
--   * Fair to the viewer and the payer: one viewer counts at most 3 top shows a day per promotion, and the
--     same top place shown again within 10 minutes is not charged again.
--   * One free alert when a task promotion starts (workers within 10 km, at most 3 a day each, never at
--     night). promotion_results() shows the payer what they got. The payer is told when it goes live, when
--     today's budget is used up (once a day) and when it ends.
--
-- Adds only: new settings, columns, table and functions; start_promotion, cancel_promotion,
-- settle_campaign and settle_finished_campaigns keep their names, arguments and grants. The old
-- ad_auction()/record_ad_impression() stay for an app that has not updated yet; their events do not count
-- towards the new spend (spent_minor).
-- Undo: supabase/undo/203_promote_bidding.down.sql.

-- ---- settings ----------------------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('promotion_bidding', '{"min_day_minor": 2000, "max_day_minor": 100000, "floor_minor": 20,
                          "target_shows_day": 100, "top_slots": 2, "viewer_top_per_day": 3,
                          "repeat_minutes": 10, "run_on_days": 2, "area_km": 10,
                          "alert_max": 30, "alert_radius_km": 10, "alert_per_person_day": 3,
                          "views_per_viewer_day": 20}'::jsonb)
on conflict (key) do nothing;

-- One number from promotion_bidding; a missing, non-number or negative value falls back.
create or replace function private.promo_cfg(p_key text, p_fallback numeric)
returns numeric
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce((
    select case when jsonb_typeof(s.value -> p_key) = 'number' and (s.value ->> p_key)::numeric >= 0
                then (s.value ->> p_key)::numeric end
      from public.settings s where s.key = 'promotion_bidding'), p_fallback);
$fn$;
revoke all on function private.promo_cfg(text, numeric) from public, anon, authenticated;

-- The lengths on offer (migration 114's setting), checked the same way start_promotion always did.
create or replace function private.promo_lengths()
returns integer[]
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v jsonb := (select value from public.settings where key = 'promotion_durations_days');
begin
  if v is null or jsonb_typeof(v) <> 'array'
     or exists (select 1 from jsonb_array_elements_text(v) e where e !~ '^[0-9]{1,2}$' or e::int not between 1 and 30) then
    return array[1, 3, 7];
  end if;
  return array(select e::int from jsonb_array_elements_text(v) e order by 1);
end;
$fn$;
revoke all on function private.promo_lengths() from public, anon, authenticated;

-- Start of today in India.
create or replace function private.promo_day_start()
returns timestamptz
language sql stable
set search_path to 'public', 'pg_temp'
as $fn$
  select date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
$fn$;
revoke all on function private.promo_day_start() from public, anon, authenticated;

-- ---- columns -----------------------------------------------------------------------------------------
alter table public.task_promotions add column if not exists day_budget_minor bigint;
alter table public.task_promotions add column if not exists spent_minor bigint not null default 0;
alter table public.task_promotions add column if not exists alerted_at timestamptz;
alter table public.task_promotions add column if not exists alerted_count integer not null default 0;
alter table public.task_promotions add column if not exists paused_told_on date;
comment on column public.task_promotions.day_budget_minor is
  'The daily budget chosen (migration 203). amount_minor = day_budget_minor x days, paid upfront.';
comment on column public.task_promotions.spent_minor is
  'What the auction has charged so far for top shows (migration 203). Never more than amount_minor.';

alter table public.ad_events add column if not exists surface text not null default 'other';
alter table public.ad_events drop constraint if exists ad_events_surface_check;
alter table public.ad_events add constraint ad_events_surface_check
  check (surface in ('list', 'home', 'map', 'search', 'alert', 'detail', 'other'));
alter table public.ad_events add column if not exists top boolean not null default false;
create index if not exists ad_events_promo_top_idx on public.ad_events (promotion_id, created_at desc) where top;
create index if not exists ad_events_viewer_promo_idx on public.ad_events (viewer_id, promotion_id, created_at desc);

-- People who turned promoted-task alerts off. Writes through set_promo_alerts() only.
create table if not exists public.promo_alert_optout (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.promo_alert_optout enable row level security;
drop policy if exists "promo_alert_optout: own reads" on public.promo_alert_optout;
create policy "promo_alert_optout: own reads" on public.promo_alert_optout
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.promo_alert_optout from anon, authenticated;
grant select on public.promo_alert_optout to authenticated;

-- ---- budget and pacing -------------------------------------------------------------------------------
-- When a live promotion stops spending: at its end, or, with money left, up to run_on_days later.
create or replace function private.promo_last_end(p public.task_promotions)
returns timestamptz
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when p.ends_at is null then null
    when p.spent_minor >= p.amount_minor or now() < p.ends_at then p.ends_at
    else p.ends_at + make_interval(days => private.promo_cfg('run_on_days', 2)::int)
  end;
$fn$;
revoke all on function private.promo_last_end(public.task_promotions) from public, anon, authenticated;

-- Today's budget for one live promotion: what is left at the start of today, spread over the time left,
-- for the part of today the promotion runs. A quiet day leaves more for the next ones. Also what it has
-- spent today and how much of today's running time has passed (0 to 1).
create or replace function private.promo_today(p public.task_promotions,
                                               out o_allow bigint, out o_spent_today bigint, out o_elapsed numeric)
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_end        timestamptz := private.promo_last_end(p);
  v_day        timestamptz := private.promo_day_start();
  v_from       timestamptz;
  v_to         timestamptz;
  v_left       bigint;
  v_day_budget bigint := coalesce(p.day_budget_minor, p.amount_minor / greatest(p.days, 1));
begin
  o_allow := 0; o_spent_today := 0; o_elapsed := 0;
  if p.starts_at is null or v_end is null then return; end if;
  v_from := greatest(v_day, p.starts_at);
  v_to   := least(v_day + interval '1 day', v_end);
  select coalesce(sum(e.cost_minor), 0) into o_spent_today
    from public.ad_events e
   where e.promotion_id = p.id and e.top and e.kind = 'impression' and e.created_at >= v_from;
  if v_to <= v_from or now() >= v_end then return; end if;
  v_left := greatest(p.amount_minor - (p.spent_minor - o_spent_today), 0);
  o_allow := least(v_left,
                   ceil(v_left * extract(epoch from (v_to - v_from)) / greatest(extract(epoch from (v_end - v_from)), 1))::bigint,
                   v_day_budget * 3);
  o_elapsed := least(greatest(extract(epoch from (now() - v_from)) / greatest(extract(epoch from (v_to - v_from)), 1), 0), 1);
end;
$fn$;
revoke all on function private.promo_today(public.task_promotions) from public, anon, authenticated;

-- Live promotions of a kind that could be shown to this viewer: never their own, never someone blocked,
-- the post still open, money left, remote posts always and pinned ones within the radius. p_task_ids,
-- when given, is the list the viewer is looking at (after their filters): only those can win.
create or replace function private.promo_candidates(p_viewer uuid, p_kind text, p_lat double precision,
                                                    p_lng double precision, p_radius_km numeric, p_task_ids uuid[])
returns table (promotion_id uuid, task_id uuid, poster_id uuid, km numeric)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select p.id, p.task_id, t.poster_id,
         case when t.loc_lat is null or p_lat is null or p_lng is null then null
              else round(private.hunt_km(p_lat, p_lng, t.loc_lat, t.loc_lng)::numeric, 1) end
    from public.task_promotions p
    join public.tasks t on t.id = p.task_id
   where p_kind in ('request', 'service')
     and t.kind::text = p_kind
     and p.status = 'active' and p.starts_at <= now()
     and p.spent_minor < p.amount_minor
     and now() < private.promo_last_end(p)
     and t.status::text = 'OPEN'
     and t.poster_id is distinct from p_viewer
     and p.user_id is distinct from p_viewer
     and not private.blocked_between(p_viewer, t.poster_id)
     and (p_task_ids is null or t.id = any (p_task_ids))
     and (t.loc_lat is null
          or (p_lat is not null and p_lng is not null
              and private.hunt_km(p_lat, p_lng, t.loc_lat, t.loc_lng) <= least(greatest(coalesce(p_radius_km, 10), 1), 100)))
   order by p.starts_at
   limit 200;
$fn$;
revoke all on function private.promo_candidates(uuid, text, double precision, double precision, numeric, uuid[])
  from public, anon, authenticated;

-- Once a day, tell the payer when today's budget is used up while money is left for later days.
create or replace function private.promo_tell_paused(p_promotion_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_promo public.task_promotions;
  v_task  public.tasks;
  v_today record;
  v_date  date := (now() at time zone 'Asia/Kolkata')::date;
begin
  select * into v_promo from public.task_promotions where id = p_promotion_id;
  if not found or v_promo.paused_told_on is not distinct from v_date
     or v_promo.spent_minor >= v_promo.amount_minor then
    return;
  end if;
  select * into v_today from private.promo_today(v_promo);
  if v_today.o_allow - v_today.o_spent_today >= greatest(private.promo_cfg('floor_minor', 20)::bigint, 1) then
    return;
  end if;
  update public.task_promotions set paused_told_on = v_date where id = v_promo.id;
  select * into v_task from public.tasks where id = v_promo.task_id;
  perform private.notify(v_promo.user_id, 'promotion_paused', 'Today''s budget is used up',
    'Your ' || case when v_task.kind::text = 'service' then 'service' else 'task' end
      || ' shows on top again tomorrow.', v_promo.task_id);
end;
$fn$;
revoke all on function private.promo_tell_paused(uuid) from public, anon, authenticated;

-- ---- the auction -------------------------------------------------------------------------------------
-- Called each time a list opens. Returns every live promotion near the viewer that could be shown (for
-- the Promoted label and the bigger map pin) and marks the top places won in this auction. Each new top
-- place is charged its second price here, once; the same place shown again within repeat_minutes is free.
create or replace function public.promoted_live(p_kind text, p_lat double precision, p_lng double precision,
                                                p_radius_km numeric, p_surface text default 'list',
                                                p_task_ids uuid[] default null)
returns table (task_id uuid, promotion_id uuid, poster_id uuid, top boolean, place integer, km numeric)
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
#variable_conflict use_column
declare
  v_me      uuid := auth.uid();
  v_surface text := case when p_surface in ('list', 'home', 'map', 'search', 'alert', 'detail') then p_surface else 'other' end;
  v_ids     uuid[] := case when p_task_ids is null then null else p_task_ids[1:500] end;
  v_slots   integer := greatest(private.promo_cfg('top_slots', 2)::int, 0);
  v_floor   bigint := greatest(private.promo_cfg('floor_minor', 20)::bigint, 1);
  v_target  numeric := greatest(private.promo_cfg('target_shows_day', 100), 1);
  v_cap     integer := private.promo_cfg('viewer_top_per_day', 3)::int;
  v_repeat  interval := make_interval(mins => private.promo_cfg('repeat_minutes', 10)::int);
  v_day     timestamptz := private.promo_day_start();
  v_top     uuid[] := '{}';
  r         record;
begin
  if v_me is null or p_kind not in ('request', 'service') then return; end if;
  -- One auction at a time per viewer, so two lists opening together cannot charge twice.
  perform pg_advisory_xact_lock(hashtextextended('promo-auction:' || v_me::text, 0));

  -- Places this viewer was shown in the last few minutes keep their place without a new charge.
  for r in
    select c.promotion_id
      from private.promo_candidates(v_me, p_kind, p_lat, p_lng, p_radius_km, v_ids) c
      join lateral (select max(e.created_at) as at from public.ad_events e
                     where e.promotion_id = c.promotion_id and e.viewer_id = v_me and e.top
                       and e.kind = 'impression' and e.created_at > now() - v_repeat) h on h.at is not null
     order by h.at desc
     limit v_slots
  loop
    v_top := v_top || r.promotion_id;
  end loop;

  if coalesce(array_length(v_top, 1), 0) < v_slots then
    for r in
      with c as (
        select c.promotion_id, c.km, p,
               (select count(*) from public.ad_events e
                 where e.promotion_id = c.promotion_id and e.viewer_id = v_me and e.top
                   and e.kind = 'impression' and e.created_at >= v_day) as mine_today,
               (select count(*) from public.ad_events e
                 where e.promotion_id = c.promotion_id and e.top and e.kind = 'impression'
                   and e.created_at >= v_day) as top_today,
               (select count(*) from public.ad_events e
                 where e.promotion_id = c.promotion_id and e.top and e.kind = 'impression') as top_all,
               (select count(*) from public.ad_events e
                 where e.promotion_id = c.promotion_id and e.kind = 'click') as clicks
          from private.promo_candidates(v_me, p_kind, p_lat, p_lng, p_radius_km, v_ids) c
          join public.task_promotions p on p.id = c.promotion_id
         where not (c.promotion_id = any (v_top))
      ), b as (
        select c.*, t.o_allow, t.o_spent_today,
               least(t.o_allow - t.o_spent_today, (c.p).amount_minor - (c.p).spent_minor) as can_spend,
               -- Automatic bid: today's budget over the shows we aim for, halved when ahead of the clock.
               greatest(v_floor::numeric,
                        (t.o_allow / v_target)
                        * case when t.o_spent_today > t.o_allow * t.o_elapsed + t.o_allow * 0.1 then 0.5 else 1 end) as bid0,
               (case when c.km is null then 0.5 else 1 / (1 + c.km / 3) end)
               * (0.5 + 10 * least((c.clicks + 1)::numeric / (c.top_all + 20), 0.15)) as match
          from c cross join lateral private.promo_today(c.p) t
         where c.mine_today < v_cap
      ), e as (
        select b.*, least(b.bid0, b.can_spend::numeric) as bid
          from b where b.can_spend >= v_floor
      ), ranked as (
        select e.promotion_id, e.bid, e.match, e.can_spend,
               row_number() over w as rn,
               lead(e.bid * e.match) over w as next_score
          from e
        window w as (order by e.bid * e.match desc, e.top_today, e.km nulls last, e.promotion_id)
      )
      select ranked.promotion_id,
             least(ceil(ranked.bid)::bigint, ranked.can_spend,
                   greatest(v_floor, ceil(coalesce(ranked.next_score, 0) / ranked.match)::bigint)) as price
        from ranked
       where ranked.rn <= v_slots - coalesce(array_length(v_top, 1), 0)
       order by ranked.rn
    loop
      -- Charge only while the budget allows it (two viewers at the same moment cannot overspend).
      update public.task_promotions
         set spent_minor = spent_minor + r.price, updated_at = now()
       where id = r.promotion_id and spent_minor + r.price <= amount_minor;
      if found then
        insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor, surface, top)
        select r.promotion_id, p.task_id, v_me, 'impression', r.price, v_surface, true
          from public.task_promotions p where p.id = r.promotion_id;
        v_top := v_top || r.promotion_id;
        perform private.promo_tell_paused(r.promotion_id);
      end if;
    end loop;
  end if;

  for r in select c.* from private.promo_candidates(v_me, p_kind, p_lat, p_lng, p_radius_km, v_ids) c loop
    task_id := r.task_id; promotion_id := r.promotion_id; poster_id := r.poster_id; km := r.km;
    top := r.promotion_id = any (v_top);
    if top then
      place := array_position(v_top, r.promotion_id);
    else
      place := null;
    end if;
    return next;
  end loop;
end;
$fn$;
revoke all on function public.promoted_live(text, double precision, double precision, numeric, text, uuid[]) from public, anon;
grant execute on function public.promoted_live(text, double precision, double precision, numeric, text, uuid[]) to authenticated;

-- One showing of a promoted post that is not a top place (the label in a list, the map pin, a search
-- result, an alert, the post itself). Free. Top places are written only by the auction above. Own views
-- never count, the same showing within 10 minutes counts once, and a viewer counts at most
-- views_per_viewer_day a day per promotion and ad_impression_viewer_day in all. p_top is ignored.
create or replace function public.record_promo_view(p_task_id uuid, p_surface text, p_top boolean)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me      uuid := auth.uid();
  v_promo   public.task_promotions;
  v_surface text := case when p_surface in ('list', 'home', 'map', 'search', 'alert', 'detail') then p_surface else 'other' end;
begin
  if v_me is null then return; end if;
  select * into v_promo from public.task_promotions
   where task_id = p_task_id and status = 'active' and starts_at <= now()
   order by created_at desc limit 1;
  if not found or now() >= private.promo_last_end(v_promo) then return; end if;
  if v_promo.user_id = v_me or exists (select 1 from public.tasks where id = p_task_id and poster_id = v_me) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('promo-view:' || v_me::text || ':' || v_promo.id::text, 0));
  if exists (select 1 from public.ad_events e
              where e.viewer_id = v_me and e.promotion_id = v_promo.id and e.kind = 'impression'
                and e.surface = v_surface and not e.top and e.created_at > now() - interval '10 minutes') then
    return;
  end if;
  if (select count(*) from public.ad_events e
       where e.viewer_id = v_me and e.promotion_id = v_promo.id and e.kind = 'impression'
         and e.created_at > now() - interval '1 day') >= private.promo_cfg('views_per_viewer_day', 20) then
    return;
  end if;
  if (select count(*) from public.ad_events e
       where e.viewer_id = v_me and e.kind = 'impression'
         and e.created_at > now() - interval '1 day') >= private.setting_num('ad_impression_viewer_day', 300) then
    return;
  end if;

  insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor, surface, top)
  values (v_promo.id, p_task_id, v_me, 'impression', 0, v_surface, false);
end;
$fn$;
revoke all on function public.record_promo_view(uuid, text, boolean) from public, anon;
grant execute on function public.record_promo_view(uuid, text, boolean) to authenticated;

-- ---- what the Promote screen shows -------------------------------------------------------------------
-- Limits, lengths, and how busy the area is: other live promotions of the same kind within area_km, the
-- average price of a top show there in the last 7 days (null when there is none yet), top shows a day
-- there, and people active this week who could see it. Plus the post's current campaign, if any.
create or replace function public.promotion_quote(p_task_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := auth.uid();
  v_task  public.tasks;
  v_kind  text;
  v_area  numeric := private.promo_cfg('area_km', 10);
  v_promo public.task_promotions;
  v_area_promos uuid[];
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'That task no longer exists'; end if;
  if v_task.poster_id <> v_me then raise exception 'That is not your task'; end if;
  v_kind := v_task.kind::text;

  select * into v_promo from public.task_promotions
   where task_id = p_task_id and status in ('pending', 'active')
   order by created_at desc limit 1;

  -- Promotions of this kind in the same area in the last 7 days (remote with remote, pinned within area_km).
  select coalesce(array_agg(p.id), '{}') into v_area_promos
    from public.task_promotions p join public.tasks t on t.id = p.task_id
   where t.kind::text = v_kind and p.task_id <> p_task_id
     and p.starts_at is not null and coalesce(private.promo_last_end(p), now()) > now() - interval '7 days'
     and case when v_task.loc_lat is null or t.loc_lat is null then v_task.loc_lat is null and t.loc_lat is null
              else private.hunt_km(v_task.loc_lat, v_task.loc_lng, t.loc_lat, t.loc_lng) <= v_area end;

  return jsonb_build_object(
    'kind', v_kind,
    'remote', v_task.loc_lat is null,
    'days', to_jsonb(private.promo_lengths()),
    'minDayMinor', private.promo_cfg('min_day_minor', 2000),
    'maxDayMinor', private.promo_cfg('max_day_minor', 100000),
    'floorMinor', private.promo_cfg('floor_minor', 20),
    'topSlots', private.promo_cfg('top_slots', 2),
    'viewerTopPerDay', private.promo_cfg('viewer_top_per_day', 3),
    'areaKm', v_area,
    'others', (select count(*) from public.task_promotions p
                where p.id = any (v_area_promos) and p.status = 'active' and now() < private.promo_last_end(p)
                  and p.spent_minor < p.amount_minor),
    'areaPriceMinor', (select round(avg(e.cost_minor))::bigint from public.ad_events e
                        where e.promotion_id = any (v_area_promos) and e.top and e.kind = 'impression'
                          and e.cost_minor > 0 and e.created_at > now() - interval '7 days'),
    'areaTopShowsDay', (select round(count(*) / 7.0)::bigint from public.ad_events e
                         where e.promotion_id = any (v_area_promos) and e.top and e.kind = 'impression'
                           and e.created_at > now() - interval '7 days'),
    'nearbyActive', (select count(*) from public.profiles pr
                      where pr.id <> v_me and pr.deleted_at is null
                        and pr.last_seen_at > now() - interval '7 days'
                        and (v_kind <> 'request' or pr.intent in ('earn', 'both'))
                        and (v_task.loc_lat is null
                             or private.hunt_km(v_task.loc_lat, v_task.loc_lng, pr.loc_lat, pr.loc_lng) <= v_area)),
    'promotion', case when v_promo.id is null then null else jsonb_build_object(
              'id', v_promo.id, 'status', v_promo.status, 'days', v_promo.days,
              'amountMinor', v_promo.amount_minor, 'dayBudgetMinor', v_promo.day_budget_minor,
              'startsAt', v_promo.starts_at, 'endsAt', v_promo.ends_at) end
  );
end;
$fn$;
revoke all on function public.promotion_quote(uuid) from public, anon;
grant execute on function public.promotion_quote(uuid) to authenticated;

-- ---- buying ------------------------------------------------------------------------------------------
-- 114's checks, with any daily budget between the limits instead of fixed tiers: p_amount_minor must be
-- p_days x a whole daily budget. Same name, arguments, refusals and grants. The campaign starts pending;
-- the payment switches it on (activate_promotion / activate_promotion_from_payment, unchanged).
create or replace function public.start_promotion(
  p_task_id uuid,
  p_days integer,
  p_amount_minor bigint
)
returns public.task_promotions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me   uuid := auth.uid();
  v_task public.tasks;
  v_row  public.task_promotions;
  v_day  bigint;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_days is null or p_days < 1 or p_days > 30 then
    raise exception 'Choose between 1 and 30 days';
  end if;
  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'Choose a budget';
  end if;
  if not (p_days = any (private.promo_lengths())) then
    raise exception 'That campaign length is not offered';
  end if;
  v_day := p_amount_minor / p_days;
  if p_amount_minor % p_days <> 0 or v_day % 100 <> 0
     or v_day < private.promo_cfg('min_day_minor', 2000) or v_day > private.promo_cfg('max_day_minor', 100000) then
    raise exception 'That budget is not offered';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'That task no longer exists';
  end if;
  if v_task.poster_id <> v_me then
    raise exception 'That is not your task';
  end if;
  if v_task.status::text <> 'OPEN' then
    raise exception 'Only an open post can be promoted';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('promo-start:' || p_task_id::text, 0));

  -- A payment page left open for 30 minutes no longer blocks the post.
  update public.task_promotions
     set status = 'cancelled', settled_at = now(), updated_at = now()
   where task_id = p_task_id and status = 'pending' and payment_id is null
     and created_at <= now() - interval '30 minutes';

  select * into v_row from public.task_promotions
   where task_id = p_task_id and status in ('pending', 'active')
   order by created_at desc limit 1;
  if found then
    -- Asking again for the same thing while paying is not a second campaign.
    if v_row.status = 'pending' and v_row.days = p_days and v_row.amount_minor = p_amount_minor then
      return v_row;
    end if;
    raise exception 'This task already has a campaign running';
  end if;

  insert into public.task_promotions (task_id, user_id, amount_minor, days, day_budget_minor)
  values (p_task_id, v_me, p_amount_minor, p_days, v_day)
  returning * into v_row;

  return v_row;
end;
$$;
revoke all on function public.start_promotion(uuid, integer, bigint) from anon, public;
grant execute on function public.start_promotion(uuid, integer, bigint) to authenticated;

-- 046's cancel, for an unpaid campaign only (the payment page was left). A paid one runs to the end.
create or replace function public.cancel_promotion(p_promotion_id uuid)
returns public.task_promotions
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_me uuid := auth.uid(); v_row public.task_promotions;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_row from public.task_promotions where id = p_promotion_id for update;
  if not found then raise exception 'That campaign no longer exists'; end if;
  if v_row.user_id <> v_me then raise exception 'That is not your campaign'; end if;
  if v_row.status not in ('pending', 'active') then
    raise exception 'That campaign has already finished';
  end if;
  if v_row.status = 'active' or v_row.payment_id is not null then
    raise exception 'A paid promotion runs to the end and cannot be stopped';
  end if;

  update public.task_promotions
     set status = 'cancelled', ends_at = least(coalesce(ends_at, now()), now()), updated_at = now()
   where id = v_row.id;
  perform private.settle_campaign(v_row.id);

  select * into v_row from public.task_promotions where id = p_promotion_id;
  return v_row;
end;
$fn$;
revoke all on function public.cancel_promotion(uuid) from public, anon;
grant execute on function public.cancel_promotion(uuid) to authenticated;

-- ---- what the payer sees -----------------------------------------------------------------------------
create or replace function public.promotion_results(p_promotion_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := auth.uid();
  v_promo public.task_promotions;
  v_task  public.tasks;
  v_today record;
  v_area  numeric := private.promo_cfg('area_km', 10);
  v_shows bigint;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_promo from public.task_promotions where id = p_promotion_id;
  if not found or v_promo.user_id <> v_me then raise exception 'That is not your campaign'; end if;
  select * into v_task from public.tasks where id = v_promo.task_id;
  select * into v_today from private.promo_today(v_promo);
  select count(*) into v_shows from public.ad_events e
   where e.promotion_id = v_promo.id and e.top and e.kind = 'impression';

  return jsonb_build_object(
    'promotionId', v_promo.id,
    'taskId', v_promo.task_id,
    'kind', v_task.kind::text,
    'status', v_promo.status,
    'days', v_promo.days,
    'amountMinor', v_promo.amount_minor,
    'dayBudgetMinor', coalesce(v_promo.day_budget_minor, v_promo.amount_minor / greatest(v_promo.days, 1)),
    'spentMinor', v_promo.spent_minor,
    'todaySpentMinor', v_today.o_spent_today,
    'todayBudgetMinor', v_today.o_allow,
    'startsAt', v_promo.starts_at,
    'endsAt', v_promo.ends_at,
    'lastEndAt', private.promo_last_end(v_promo),
    'topShows', v_shows,
    'avgPriceMinor', case when v_shows > 0 then round(v_promo.spent_minor::numeric / v_shows)::bigint end,
    'areaPriceMinor', (select round(avg(e.cost_minor))::bigint
                         from public.ad_events e
                         join public.task_promotions p on p.id = e.promotion_id
                         join public.tasks t on t.id = p.task_id
                        where p.id <> v_promo.id and t.kind = v_task.kind and e.top and e.kind = 'impression'
                          and e.cost_minor > 0 and e.created_at > now() - interval '7 days'
                          and case when v_task.loc_lat is null or t.loc_lat is null
                                   then v_task.loc_lat is null and t.loc_lat is null
                                   else private.hunt_km(v_task.loc_lat, v_task.loc_lng, t.loc_lat, t.loc_lng) <= v_area end),
    'saw', (select count(distinct e.viewer_id) from public.ad_events e
             where e.promotion_id = v_promo.id and e.kind = 'impression'),
    'onTop', (select count(distinct e.viewer_id) from public.ad_events e
               where e.promotion_id = v_promo.id and e.kind = 'impression' and e.top),
    'opened', (select count(distinct e.viewer_id) from public.ad_events e
                where e.promotion_id = v_promo.id and e.kind = 'click'),
    'bySurface', coalesce((select jsonb_object_agg(s.surface, s.n) from (
                   select e.surface, count(distinct e.viewer_id) as n from public.ad_events e
                    where e.promotion_id = v_promo.id and e.kind = 'impression' group by e.surface) s), '{}'::jsonb),
    'offersSince', case when v_promo.starts_at is null then 0 else
                     (select count(*) from public.bids b where b.task_id = v_promo.task_id and b.created_at >= v_promo.starts_at) end,
    'offersBefore', (select count(*) from public.bids b where b.task_id = v_promo.task_id
                      and b.created_at < coalesce(v_promo.starts_at, now())),
    'alerted', v_promo.alerted_count
  );
end;
$fn$;
revoke all on function public.promotion_results(uuid) from public, anon;
grant execute on function public.promotion_results(uuid) to authenticated;

-- ---- the one alert -----------------------------------------------------------------------------------
create or replace function public.set_promo_alerts(p_on boolean)
returns boolean
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if coalesce(p_on, true) then
    delete from public.promo_alert_optout where user_id = v_me;
  else
    insert into public.promo_alert_optout (user_id) values (v_me) on conflict (user_id) do nothing;
  end if;
  return coalesce(p_on, true);
end;
$fn$;
revoke all on function public.set_promo_alerts(boolean) from public, anon;
grant execute on function public.set_promo_alerts(boolean) to authenticated;

-- Send a live task promotion's one alert, unless it is quiet hours (the sweep sends it later), it was
-- already sent, the post is remote or a service, or the promotion is not live. Returns how many were sent.
create or replace function private.promo_alert(p_promotion_id uuid)
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_promo public.task_promotions;
  v_task  public.tasks;
  v_hour  integer := extract(hour from now() at time zone 'Asia/Kolkata')::integer;
  v_day   timestamptz := private.promo_day_start();
  v_n     integer := 0;
  r       record;
begin
  select * into v_promo from public.task_promotions where id = p_promotion_id for update;
  if not found or v_promo.alerted_at is not null or v_promo.status <> 'active' or v_promo.ends_at <= now() then
    return 0;
  end if;
  select * into v_task from public.tasks where id = v_promo.task_id;
  if v_task.kind::text <> 'request' or v_task.loc_lat is null or v_task.status::text <> 'OPEN' then
    update public.task_promotions set alerted_at = now(), updated_at = now() where id = v_promo.id;
    return 0;
  end if;
  if v_hour >= 21 or v_hour < 8 then
    return 0;
  end if;

  for r in
    select pr.id, round(private.hunt_km(v_task.loc_lat, v_task.loc_lng, pr.loc_lat, pr.loc_lng)::numeric, 1) as km
      from public.profiles pr
     where pr.id <> v_task.poster_id
       and pr.deleted_at is null
       and pr.intent in ('earn', 'both')
       and pr.last_seen_at > now() - interval '7 days'
       and private.hunt_km(v_task.loc_lat, v_task.loc_lng, pr.loc_lat, pr.loc_lng) <= private.promo_cfg('alert_radius_km', 10)
       and not exists (select 1 from public.promo_alert_optout o where o.user_id = pr.id)
       and not private.blocked_between(pr.id, v_task.poster_id)
       and (select count(*) from public.notifications n
             where n.user_id = pr.id and n.kind = 'promoted_task' and n.created_at >= v_day)
           < private.promo_cfg('alert_per_person_day', 3)
     order by 2, pr.last_seen_at desc
     limit private.promo_cfg('alert_max', 30)::integer
  loop
    perform private.notify(r.id, 'promoted_task',
      'Promoted task ' || r.km || ' km from you',
      left(v_task.title, 80) || ' · ₹' || (v_task.benchmark_minor / 100), v_task.id);
    v_n := v_n + 1;
  end loop;

  update public.task_promotions set alerted_at = now(), alerted_count = v_n, updated_at = now()
   where id = v_promo.id;
  return v_n;
end;
$fn$;
revoke all on function private.promo_alert(uuid) from public, anon, authenticated;

-- A promotion that goes live sends its alert at once. An alert that fails never stops the activation.
create or replace function private.promo_on_live()
returns trigger
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if new.status = 'active' and old.status is distinct from 'active' then
    begin
      perform private.promo_alert(new.id);
    exception when others then
      null;
    end;
    perform private.notify(new.user_id, 'promotion_live', 'Your promotion is live',
      coalesce((select 'We told ' || p.alerted_count || ' workers nearby. ' from public.task_promotions p
                 where p.id = new.id and p.alerted_count > 0), '') || 'Tap to see who saw it.', new.task_id);
  end if;
  return new;
end;
$fn$;
revoke all on function private.promo_on_live() from public, anon, authenticated;
drop trigger if exists task_promotions_on_live on public.task_promotions;
create trigger task_promotions_on_live after update of status on public.task_promotions
  for each row execute function private.promo_on_live();

-- ---- money: paid upfront, never refunded -------------------------------------------------------------
-- 046's settlement without the refund (owner, 25 Nov: "if it is paid, it is done"). Once only: the whole
-- paid amount goes to the company ledger as ad revenue, whether the auction used all of it or not, and
-- whether the campaign ran its course or ended because the post closed. An unpaid campaign just closes.
-- Returns the refund, which is always 0 now.
create or replace function private.settle_campaign(p_promotion_id uuid)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_promo public.task_promotions;
begin
  select * into v_promo from public.task_promotions
   where id = p_promotion_id for update;
  if not found then return 0; end if;
  if v_promo.settled_at is not null then return 0; end if;

  if v_promo.payment_id is not null and v_promo.amount_minor > 0 then
    insert into public.platform_ledger (task_id, kind, amount_minor, note)
    values (v_promo.task_id, 'ad_revenue', v_promo.amount_minor,
            'promotion paid (top shows ' || least(v_promo.spent_minor, v_promo.amount_minor) || ' of ' || v_promo.amount_minor || ')');
    perform private.notify(v_promo.user_id, 'promotion_ended', 'Promotion ended',
      (select count(distinct e.viewer_id) from public.ad_events e
        where e.promotion_id = v_promo.id and e.top and e.kind = 'impression')
      || case when (select t.kind::text from public.tasks t where t.id = v_promo.task_id) = 'service'
              then ' customers' else ' workers' end
      || ' saw it on top. Tap to see the results.', v_promo.task_id);
  end if;

  update public.task_promotions
     set status = case when status = 'cancelled' then 'cancelled' else 'expired' end,
         settled_at = now(),
         updated_at = now()
   where id = v_promo.id;

  return 0;
end;
$fn$;
revoke all on function private.settle_campaign(uuid) from public, anon, authenticated;

-- 046's sweep: a live promotion whose post is no longer open ends; one that used all its money, or ran
-- past its end (plus the run-on days when money was left), finishes; both settle. Alerts held back by
-- quiet hours go out. Still not granted to clients; the hourly schedule is unchanged.
create or replace function public.settle_finished_campaigns()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_id uuid; v_n integer := 0;
begin
  update public.task_promotions p
     set status = 'cancelled', ends_at = least(p.ends_at, now()), updated_at = now()
    from public.tasks t
   where t.id = p.task_id and p.status = 'active' and now() < private.promo_last_end(p)
     and t.status::text <> 'OPEN';

  for v_id in
    select p.id from public.task_promotions p
     where p.settled_at is null
       and (p.status = 'cancelled'
            or (p.status = 'active'
                and (p.ends_at is null or p.spent_minor >= p.amount_minor or now() >= private.promo_last_end(p))))
     order by p.ends_at
  loop
    perform private.settle_campaign(v_id);
    v_n := v_n + 1;
  end loop;

  for v_id in
    select id from public.task_promotions
     where status = 'active' and alerted_at is null and ends_at > now()
     order by starts_at limit 50
  loop
    perform private.promo_alert(v_id);
  end loop;

  return v_n;
end;
$fn$;
revoke all on function public.settle_finished_campaigns() from public, anon, authenticated;
