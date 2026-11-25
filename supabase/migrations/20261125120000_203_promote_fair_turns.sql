-- 203 -- Promote, made visible and fair (plan task 1.19 row C, owner 25 Nov).
--
-- Before: a paid promotion only moved the post up on Home, was charged per view at about a paisa, and
-- the payer never saw a result. Owner: "I can't see where other people actually see my promoted task".
--
-- After (design canvas DfAYTdyZK6E6cjbHMFUJZV, boards 1-10):
--   * One flat price per day, per kind of post (setting promotion_price_per_day_minor; tasks and services
--     separately). No bidding, no charge per view. Stopping early or the post closing returns the unused
--     FULL days (settle_campaign below).
--   * Two pools that never compete: promoted tasks (kind 'request', shown to workers) and promoted
--     services (kind 'service', shown to customers).
--   * Step 1, a spot: at most `cap` live promotions of a kind within `radius_km` of each other (remote posts
--     share `remote_cap` for the whole country). First come, first served. When full, a free line
--     (promotion_line): when a spot opens, the first in line gets it held for `hold_minutes` and one alert.
--   * Step 2, turns: promoted_live() gives each live promotion near the viewer with how often it was shown
--     on top today (all viewers, and this viewer). The app keeps the ones matching the viewer's filters,
--     puts the fewest-shown first (tie: nearer, then started earlier), shows the top `top_slots`, and skips
--     one this viewer already saw on top `viewer_top_per_day` times. record_promo_view() writes each showing
--     with where it was seen (list, home, map, search, alert, detail) and whether it was on top.
--   * One alert when a task promotion starts: up to `alert_max` people who earn, active this week, within
--     `alert_radius_km`, never in quiet hours (21:00-08:00 IST; sent at 08:00 instead), at most
--     `alert_per_person_day` such alerts a day each, and never to anyone who turned them off.
--   * promotion_results(): what the payer sees (saw it, opened it, offers since, alerted, by place).
--
-- Adds only: new settings, columns, table and functions; start_promotion, settle_campaign and
-- settle_finished_campaigns keep their names and grants. The old ad_auction()/record_ad_impression() stay
-- for an app that has not updated yet (they now cost nothing at settlement: spend is days, not views).
-- The settle sweep moves from hourly to every 5 minutes so a freed spot reaches the line quickly.
-- Undo: supabase/undo/203_promote_fair_turns.down.sql.

-- ---- settings ----------------------------------------------------------------------------------------
insert into public.settings (key, value) values
  ('promotion_price_per_day_minor', '{"request": 8000, "service": 8000}'::jsonb),
  ('promotion_spots', '{"cap": 8, "radius_km": 5, "remote_cap": 8, "top_slots": 2, "viewer_top_per_day": 3,
                        "hold_minutes": 30, "alert_max": 30, "alert_radius_km": 10, "alert_per_person_day": 3,
                        "views_per_viewer_day": 20}'::jsonb)
on conflict (key) do nothing;

-- One number from promotion_spots; a missing, non-number or non-positive value falls back.
create or replace function private.promo_cfg(p_key text, p_fallback numeric)
returns numeric
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce((
    select case when jsonb_typeof(s.value -> p_key) = 'number' and (s.value ->> p_key)::numeric > 0
                then (s.value ->> p_key)::numeric end
      from public.settings s where s.key = 'promotion_spots'), p_fallback);
$fn$;
revoke all on function private.promo_cfg(text, numeric) from public, anon, authenticated;

-- The flat day price for a kind of post, in paise. A value saved in the wrong shape falls back to Rs 80.
create or replace function private.promo_day_price(p_kind text)
returns bigint
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce((
    select case when (s.value ->> p_kind) ~ '^[0-9]{3,9}$' then (s.value ->> p_kind)::bigint end
      from public.settings s where s.key = 'promotion_price_per_day_minor'), 8000);
$fn$;
revoke all on function private.promo_day_price(text) from public, anon, authenticated;

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

-- Two posts are in the same area when both are remote, or both are pinned within radius_km.
create or replace function private.promo_near(p_lat1 double precision, p_lng1 double precision,
                                              p_lat2 double precision, p_lng2 double precision)
returns boolean
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select case
    when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null
      then (p_lat1 is null or p_lng1 is null) and (p_lat2 is null or p_lng2 is null)
    else private.hunt_km(p_lat1, p_lng1, p_lat2, p_lng2) <= private.promo_cfg('radius_km', 5)
  end;
$fn$;
revoke all on function private.promo_near(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

create or replace function private.promo_cap(p_lat double precision)
returns integer
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select (case when p_lat is null then private.promo_cfg('remote_cap', 8) else private.promo_cfg('cap', 8) end)::integer;
$fn$;
revoke all on function private.promo_cap(double precision) from public, anon, authenticated;

-- ---- columns -----------------------------------------------------------------------------------------
alter table public.task_promotions add column if not exists day_price_minor bigint;
alter table public.task_promotions add column if not exists alerted_at timestamptz;
alter table public.task_promotions add column if not exists alerted_count integer not null default 0;
comment on column public.task_promotions.day_price_minor is
  'The flat price per day paid (migration 203). Unused full days are returned at this rate.';

alter table public.ad_events add column if not exists surface text not null default 'other';
alter table public.ad_events drop constraint if exists ad_events_surface_check;
alter table public.ad_events add constraint ad_events_surface_check
  check (surface in ('list', 'home', 'map', 'search', 'alert', 'detail', 'other'));
alter table public.ad_events add column if not exists top boolean not null default false;
create index if not exists ad_events_promo_top_idx on public.ad_events (promotion_id, created_at desc) where top;
create index if not exists ad_events_viewer_promo_idx on public.ad_events (viewer_id, promotion_id, created_at desc);

-- ---- the line ----------------------------------------------------------------------------------------
create table if not exists public.promotion_line (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  kind          text not null check (kind in ('request', 'service')),
  days          integer not null check (days between 1 and 30),
  status        text not null default 'waiting'
                check (status in ('waiting', 'offered', 'used', 'left', 'missed', 'closed')),
  offered_until timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists promotion_line_one_per_task
  on public.promotion_line (task_id) where status in ('waiting', 'offered');
create index if not exists promotion_line_open_idx
  on public.promotion_line (kind, created_at) where status in ('waiting', 'offered');
create index if not exists promotion_line_user_idx on public.promotion_line (user_id, created_at desc);

alter table public.promotion_line enable row level security;
drop policy if exists "promotion_line: own reads" on public.promotion_line;
create policy "promotion_line: own reads" on public.promotion_line
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.promotion_line from anon, authenticated;
grant select on public.promotion_line to authenticated;

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

-- ---- spots -------------------------------------------------------------------------------------------
-- Spots taken in the area of a post of this kind: live promotions, payments in progress (a pending row
-- younger than the hold time) and spots held for someone in line. The post itself is not counted.
create or replace function private.promo_taken(p_kind text, p_lat double precision, p_lng double precision,
                                               p_except_task uuid)
returns integer
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select ((
    select count(*) from public.task_promotions p join public.tasks t on t.id = p.task_id
     where t.kind::text = p_kind
       and p.task_id is distinct from p_except_task
       and ((p.status = 'active' and p.ends_at > now())
            or (p.status = 'pending' and p.created_at > now() - make_interval(mins => private.promo_cfg('hold_minutes', 30)::int)))
       and private.promo_near(p_lat, p_lng, t.loc_lat, t.loc_lng)
  ) + (
    select count(*) from public.promotion_line l join public.tasks t on t.id = l.task_id
     where l.kind = p_kind and l.status = 'offered' and l.offered_until > now()
       and l.task_id is distinct from p_except_task
       and private.promo_near(p_lat, p_lng, t.loc_lat, t.loc_lng)
  ))::integer;
$fn$;
revoke all on function private.promo_taken(text, double precision, double precision, uuid) from public, anon, authenticated;

-- Move the line on: missed holds end, entries for closed posts close, and each waiting entry (oldest
-- first) whose area has a free spot gets it held, with one alert. Returns how many were offered a spot.
create or replace function private.promo_advance_line()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  r   record;
  v_n integer := 0;
  v_hold integer := private.promo_cfg('hold_minutes', 30)::integer;
begin
  perform pg_advisory_xact_lock(hashtextextended('promotion-spots', 0));

  update public.promotion_line set status = 'missed', updated_at = now()
   where status = 'offered' and offered_until <= now();
  update public.promotion_line l set status = 'closed', updated_at = now()
    from public.tasks t
   where t.id = l.task_id and l.status in ('waiting', 'offered') and t.status::text <> 'OPEN';

  for r in
    select l.id, l.user_id, l.task_id, l.kind, t.loc_lat, t.loc_lng
      from public.promotion_line l join public.tasks t on t.id = l.task_id
     where l.status = 'waiting'
     order by l.created_at, l.id
  loop
    if private.promo_taken(r.kind, r.loc_lat, r.loc_lng, r.task_id) < private.promo_cap(r.loc_lat) then
      update public.promotion_line
         set status = 'offered', offered_until = now() + make_interval(mins => v_hold), updated_at = now()
       where id = r.id;
      perform private.notify(r.user_id, 'promotion_spot', 'Your promotion spot is free',
        'We are holding it for you for ' || v_hold || ' minutes. Open Promote to start it.', r.task_id);
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$fn$;
revoke all on function private.promo_advance_line() from public, anon, authenticated;

-- Where a post stands in its area's line: 0 when it is not in line.
create or replace function private.promo_line_position(p_task_id uuid)
returns integer
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select coalesce((
    select count(*)::integer from public.promotion_line o join public.tasks ot on ot.id = o.task_id
     where o.kind = me.kind and o.status in ('waiting', 'offered')
       and (o.created_at, o.id) <= (me.created_at, me.id)
       and private.promo_near(mt.loc_lat, mt.loc_lng, ot.loc_lat, ot.loc_lng)
  ), 0)
  from public.promotion_line me join public.tasks mt on mt.id = me.task_id
  where me.task_id = p_task_id and me.status in ('waiting', 'offered');
$fn$;
revoke all on function private.promo_line_position(uuid) from public, anon, authenticated;

-- ---- what the Promote screen shows -------------------------------------------------------------------
create or replace function public.promotion_quote(p_task_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := auth.uid();
  v_task  public.tasks;
  v_kind  text;
  v_line  public.promotion_line;
  v_promo public.task_promotions;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'That task no longer exists'; end if;
  if v_task.poster_id <> v_me then raise exception 'That is not your task'; end if;
  v_kind := v_task.kind::text;

  perform private.promo_advance_line();

  select * into v_line from public.promotion_line
   where task_id = p_task_id and status in ('waiting', 'offered') limit 1;
  select * into v_promo from public.task_promotions
   where task_id = p_task_id and status in ('pending', 'active')
   order by created_at desc limit 1;

  return jsonb_build_object(
    'kind', v_kind,
    'dayPriceMinor', private.promo_day_price(v_kind),
    'days', to_jsonb(private.promo_lengths()),
    'remote', v_task.loc_lat is null,
    'radiusKm', private.promo_cfg('radius_km', 5),
    'taken', private.promo_taken(v_kind, v_task.loc_lat, v_task.loc_lng, p_task_id),
    'cap', private.promo_cap(v_task.loc_lat),
    'waiting', (select count(*) from public.promotion_line l join public.tasks t on t.id = l.task_id
                 where l.kind = v_kind and l.status = 'waiting' and l.task_id <> p_task_id
                   and private.promo_near(v_task.loc_lat, v_task.loc_lng, t.loc_lat, t.loc_lng)),
    'nextFreeAt', (select min(p.ends_at) from public.task_promotions p join public.tasks t on t.id = p.task_id
                    where t.kind::text = v_kind and p.status = 'active' and p.ends_at > now()
                      and p.task_id <> p_task_id
                      and private.promo_near(v_task.loc_lat, v_task.loc_lng, t.loc_lat, t.loc_lng)),
    -- People active this week near the post who would see it: earners for a task, everyone for a service.
    'nearbyActive', (select count(*) from public.profiles pr
                      where pr.id <> v_me and pr.deleted_at is null
                        and pr.last_seen_at > now() - interval '7 days'
                        and (v_kind <> 'request' or pr.intent in ('earn', 'both'))
                        and (v_task.loc_lat is null
                             or private.hunt_km(v_task.loc_lat, v_task.loc_lng, pr.loc_lat, pr.loc_lng)
                                <= private.promo_cfg('alert_radius_km', 10))),
    'line', case when v_line.id is null then null else jsonb_build_object(
              'status', v_line.status, 'days', v_line.days, 'joinedAt', v_line.created_at,
              'offeredUntil', v_line.offered_until, 'position', private.promo_line_position(p_task_id)) end,
    'promotion', case when v_promo.id is null then null else jsonb_build_object(
              'id', v_promo.id, 'status', v_promo.status, 'days', v_promo.days,
              'startsAt', v_promo.starts_at, 'endsAt', v_promo.ends_at) end
  );
end;
$fn$;
revoke all on function public.promotion_quote(uuid) from public, anon;
grant execute on function public.promotion_quote(uuid) to authenticated;

-- ---- buying ------------------------------------------------------------------------------------------
-- 114's checks, with the flat price and the spot rule. Same name, arguments and grants.
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
  v_me    uuid := auth.uid();
  v_task  public.tasks;
  v_row   public.task_promotions;
  v_kind  text;
  v_price bigint;
  v_held  public.promotion_line;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_days is null or not (p_days = any (private.promo_lengths())) then
    raise exception 'That campaign length is not offered';
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
  v_kind  := v_task.kind::text;
  v_price := private.promo_day_price(v_kind);
  if p_amount_minor is null or p_amount_minor <> v_price * p_days then
    raise exception 'That budget is not offered';
  end if;

  perform private.promo_advance_line();   -- takes the spots lock for the rest of this transaction

  -- A payment page left open past the hold time no longer blocks the post.
  update public.task_promotions
     set status = 'cancelled', settled_at = now(), updated_at = now()
   where task_id = p_task_id and status = 'pending' and payment_id is null
     and created_at <= now() - make_interval(mins => private.promo_cfg('hold_minutes', 30)::int);

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

  select * into v_held from public.promotion_line
   where task_id = p_task_id and status = 'offered' and offered_until > now() limit 1;
  if v_held.id is null
     and private.promo_taken(v_kind, v_task.loc_lat, v_task.loc_lng, p_task_id) >= private.promo_cap(v_task.loc_lat) then
    raise exception 'All promotion spots near this post are taken. Join the line instead.';
  end if;

  insert into public.task_promotions (task_id, user_id, amount_minor, days, day_price_minor)
  values (p_task_id, v_me, p_amount_minor, p_days, v_price)
  returning * into v_row;

  update public.promotion_line set status = 'used', updated_at = now()
   where task_id = p_task_id and status in ('waiting', 'offered');

  return v_row;
end;
$$;
revoke all on function public.start_promotion(uuid, integer, bigint) from anon, public;
grant execute on function public.start_promotion(uuid, integer, bigint) to authenticated;

create or replace function public.join_promotion_line(p_task_id uuid, p_days integer)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me   uuid := auth.uid();
  v_task public.tasks;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_days is null or not (p_days = any (private.promo_lengths())) then
    raise exception 'That campaign length is not offered';
  end if;
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'That task no longer exists'; end if;
  if v_task.poster_id <> v_me then raise exception 'That is not your task'; end if;
  if v_task.status::text <> 'OPEN' then raise exception 'Only an open post can be promoted'; end if;
  if exists (select 1 from public.task_promotions where task_id = p_task_id and status = 'active') then
    raise exception 'This task already has a campaign running';
  end if;

  perform private.promo_advance_line();
  if not exists (select 1 from public.promotion_line where task_id = p_task_id and status in ('waiting', 'offered')) then
    insert into public.promotion_line (task_id, user_id, kind, days)
    values (p_task_id, v_me, v_task.kind::text, p_days);
    -- A spot may be free right now (nobody ahead): hold it at once.
    perform private.promo_advance_line();
  end if;
  return public.promotion_quote(p_task_id);
end;
$fn$;
revoke all on function public.join_promotion_line(uuid, integer) from public, anon;
grant execute on function public.join_promotion_line(uuid, integer) to authenticated;

create or replace function public.leave_promotion_line(p_task_id uuid)
returns jsonb
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  update public.promotion_line set status = 'left', updated_at = now()
   where task_id = p_task_id and user_id = v_me and status in ('waiting', 'offered');
  perform private.promo_advance_line();
  return public.promotion_quote(p_task_id);
end;
$fn$;
revoke all on function public.leave_promotion_line(uuid) from public, anon;
grant execute on function public.leave_promotion_line(uuid) to authenticated;

-- ---- showing -----------------------------------------------------------------------------------------
-- Live promotions of a kind near the viewer, with today's top showings (IST day). Remote ones always;
-- pinned ones only within p_radius_km of the viewer's point. Never the viewer's own, never someone blocked.
create or replace function public.promoted_live(p_kind text, p_lat double precision, p_lng double precision,
                                                p_radius_km numeric)
returns table (task_id uuid, promotion_id uuid, poster_id uuid, top_today integer, my_top_today integer,
               starts_at timestamptz, ends_at timestamptz)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  with day as (
    select (date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata') as since
  )
  select p.task_id, p.id, t.poster_id,
         (select count(*) from public.ad_events e, day
           where e.promotion_id = p.id and e.top and e.kind = 'impression' and e.created_at >= day.since)::integer,
         (select count(*) from public.ad_events e, day
           where e.promotion_id = p.id and e.top and e.kind = 'impression' and e.viewer_id = auth.uid()
             and e.created_at >= day.since)::integer,
         p.starts_at, p.ends_at
    from public.task_promotions p
    join public.tasks t on t.id = p.task_id
   where p_kind in ('request', 'service')
     and t.kind::text = p_kind
     and p.status = 'active' and p.starts_at <= now() and p.ends_at > now()
     and t.status::text = 'OPEN'
     and t.poster_id is distinct from auth.uid()
     and not private.blocked_between(auth.uid(), t.poster_id)
     and (t.loc_lat is null
          or (p_lat is not null and p_lng is not null
              and private.hunt_km(p_lat, p_lng, t.loc_lat, t.loc_lng) <= least(greatest(coalesce(p_radius_km, 10), 1), 100)))
   order by p.starts_at
   limit 200;
$fn$;
revoke all on function public.promoted_live(text, double precision, double precision, numeric) from public, anon;
grant execute on function public.promoted_live(text, double precision, double precision, numeric) to authenticated;

-- One showing of a promoted post. Free (nothing is charged per view any more). Own views never count,
-- the same showing within 10 minutes counts once, and a viewer counts at most views_per_viewer_day a day
-- per promotion and ad_impression_viewer_day in all.
create or replace function public.record_promo_view(p_task_id uuid, p_surface text, p_top boolean)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me      uuid := auth.uid();
  v_promo   public.task_promotions;
  v_surface text := case when p_surface in ('list', 'home', 'map', 'search', 'alert', 'detail') then p_surface else 'other' end;
  v_top     boolean := coalesce(p_top, false);
begin
  if v_me is null then return; end if;
  select * into v_promo from public.task_promotions
   where task_id = p_task_id and status = 'active' and starts_at <= now() and ends_at > now()
   order by created_at desc limit 1;
  if not found then return; end if;
  if v_promo.user_id = v_me or exists (select 1 from public.tasks where id = p_task_id and poster_id = v_me) then
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('promo-view:' || v_me::text || ':' || v_promo.id::text, 0));
  if exists (select 1 from public.ad_events e
              where e.viewer_id = v_me and e.promotion_id = v_promo.id and e.kind = 'impression'
                and e.surface = v_surface and e.top = v_top and e.created_at > now() - interval '10 minutes') then
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
  values (v_promo.id, p_task_id, v_me, 'impression', 0, v_surface, v_top);
end;
$fn$;
revoke all on function public.record_promo_view(uuid, text, boolean) from public, anon;
grant execute on function public.record_promo_view(uuid, text, boolean) to authenticated;

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
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  select * into v_promo from public.task_promotions where id = p_promotion_id;
  if not found or v_promo.user_id <> v_me then raise exception 'That is not your campaign'; end if;
  select * into v_task from public.tasks where id = v_promo.task_id;

  return jsonb_build_object(
    'promotionId', v_promo.id,
    'taskId', v_promo.task_id,
    'kind', v_task.kind::text,
    'status', v_promo.status,
    'days', v_promo.days,
    'amountMinor', v_promo.amount_minor,
    'startsAt', v_promo.starts_at,
    'endsAt', v_promo.ends_at,
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
  v_day   timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
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
    select pr.id, private.hunt_km(v_task.loc_lat, v_task.loc_lng, pr.loc_lat, pr.loc_lng) as km
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
  end if;
  return new;
end;
$fn$;
revoke all on function private.promo_on_live() from public, anon, authenticated;
drop trigger if exists task_promotions_on_live on public.task_promotions;
create trigger task_promotions_on_live after update of status on public.task_promotions
  for each row execute function private.promo_on_live();

-- ---- money: days, not views --------------------------------------------------------------------------
-- 046's settlement, with spend = the days used (a started day counts as a whole day) at the day price.
-- A campaign that ran its course spends all of it; one stopped early (by the payer, or because the post
-- closed) gets the unused full days back. Everything else as 046: once only, wallet credit + audit row,
-- the earned part to the company ledger.
create or replace function private.settle_campaign(p_promotion_id uuid)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_promo    public.task_promotions;
  v_day      bigint;
  v_used     integer;
  v_spent    bigint;
  v_refund   bigint;
  v_balance  bigint;
  v_clearing bigint;
begin
  select * into v_promo from public.task_promotions
   where id = p_promotion_id for update;
  if not found then return 0; end if;
  if v_promo.settled_at is not null then return 0; end if;

  if v_promo.payment_id is null then
    update public.task_promotions
       set settled_at = now(), updated_at = now()
     where id = v_promo.id;
    return 0;
  end if;

  v_day := coalesce(v_promo.day_price_minor, v_promo.amount_minor / greatest(v_promo.days, 1));
  if v_promo.status = 'cancelled' and v_promo.starts_at is not null then
    v_used := least(v_promo.days, greatest(1,
      ceil(extract(epoch from (coalesce(v_promo.ends_at, now()) - v_promo.starts_at)) / 86400.0)::integer));
    v_spent := least(v_promo.amount_minor, v_used * v_day);
  else
    v_spent := v_promo.amount_minor;
  end if;
  v_refund := greatest(v_promo.amount_minor - v_spent, 0);

  if v_refund > 0 then
    select balance_minor, clearing_minor into v_balance, v_clearing
      from public.wallets where user_id = v_promo.user_id for update;
    if found then
      update public.wallets
         set balance_minor = balance_minor + v_refund, updated_at = now()
       where user_id = v_promo.user_id;

      insert into public.wallet_adjustments
        (user_id, delta_minor, balance_before, clearing_before, reason)
      values (v_promo.user_id, v_refund, v_balance, v_clearing,
              'unused promotion days returned');
    end if;
  end if;

  if v_spent > 0 then
    insert into public.platform_ledger (task_id, kind, amount_minor, note)
    values (v_promo.task_id, 'ad_revenue', v_spent, 'promotion days used');
  end if;

  update public.task_promotions
     set status = case when status = 'cancelled' then 'cancelled' else 'expired' end,
         settled_at = now(),
         updated_at = now()
   where id = v_promo.id;

  return v_refund;
end;
$fn$;
revoke all on function private.settle_campaign(uuid) from public, anon, authenticated;

-- 046's sweep, plus: a live promotion whose post is no longer open stops (and gets its unused days
-- back), the line moves on, and alerts held back by quiet hours go out. Still not granted to clients.
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
   where t.id = p.task_id and p.status = 'active' and p.ends_at > now() and t.status::text <> 'OPEN';

  for v_id in
    select id from public.task_promotions
     where settled_at is null
       and status in ('active', 'cancelled')
       and (ends_at is null or ends_at <= now())
     order by ends_at
  loop
    perform private.settle_campaign(v_id);
    v_n := v_n + 1;
  end loop;

  perform private.promo_advance_line();

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

-- The sweep now also moves the line, so it runs every 5 minutes instead of hourly.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'cron') then
    if exists (select 1 from cron.job where jobname = 'settle-finished-campaigns') then
      perform cron.unschedule('settle-finished-campaigns');
    end if;
    perform cron.schedule('settle-finished-campaigns', '*/5 * * * *',
      $c$set statement_timeout = '5min'; select private.run_cron_job('settle-finished-campaigns')$c$);
  end if;
end $$;
update private.cron_jobs set max_gap = interval '20 minutes' where job = 'settle-finished-campaigns';
