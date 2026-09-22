-- 045 — campaigns become an ad system rather than a sort key.
--
-- What 044 left us with: rank sponsored listings by daily budget, charge the
-- whole campaign up front, deliver forever inside the window. The budget was
-- never actually spent, so "daily budget" was a label; the richest bidder sat
-- on top of every feed all day whether or not anyone ever tapped it.
--
-- Meta's auction does three things that one did not:
--   1. It ranks on bid x estimated action rate, not bid. A cheap ad people
--      actually tap beats an expensive one they ignore, because the platform
--      is paid on delivery and an ignored ad earns nothing.
--   2. It charges second price -- the winner pays only what it took to beat
--      the runner-up, not their own bid. Bidding your true value is then safe.
--   3. It paces. A daily budget is spread across the day, and delivery stops
--      when the day's budget is gone.
--
-- Money note: nothing here charges a card. cost_minor accrues against the
-- budget the advertiser already paid for, so spend is accounting, not a new
-- collection path. Unspent budget is NOT yet refunded -- see the note at the
-- end of docs/promotion-ranking.pdf.

create table if not exists public.ad_events (
  id            uuid primary key default gen_random_uuid(),
  promotion_id  uuid not null references public.task_promotions (id) on delete cascade,
  task_id       uuid not null references public.tasks (id) on delete cascade,
  viewer_id     uuid references public.profiles (id) on delete set null,
  kind          text not null check (kind in ('impression', 'click')),
  cost_minor    bigint not null default 0,
  created_at    timestamptz not null default now()
);

create index if not exists ad_events_promo_day_idx
  on public.ad_events (promotion_id, created_at desc);
create index if not exists ad_events_task_idx
  on public.ad_events (task_id, created_at desc);

alter table public.ad_events enable row level security;

drop policy if exists ad_events_own_read on public.ad_events;
create policy ad_events_own_read on public.ad_events
  for select using (
    private.is_admin()
    or exists (
      select 1 from public.task_promotions p
       where p.id = ad_events.promotion_id and p.user_id = auth.uid()
    )
  );

revoke all on public.ad_events from anon, authenticated;
grant select on public.ad_events to authenticated;

alter table public.task_promotions
  add column if not exists audience text not null default 'city'
    check (audience in ('city', 'radius'));

insert into public.settings (key, value) values
  ('ad_cpm_divisor',        '1000'),
  ('ad_ctr_prior',          '0.05'),
  ('ad_ctr_smoothing',      '50'),
  ('ad_min_charge_minor',   '1')
on conflict (key) do nothing;

-- Estimated action rate: clicks per impression, pulled toward a prior while
-- the sample is small. Without the smoothing a campaign with one impression
-- and one click would look like a 100% CTR and win everything.
create or replace function private.ad_ectr(p_promotion_id uuid)
returns numeric
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select (count(*) filter (where kind = 'click')
            + private.setting_num('ad_ctr_smoothing', 50)
            * private.setting_num('ad_ctr_prior', 0.05))
         / nullif(count(*) filter (where kind = 'impression')
            + private.setting_num('ad_ctr_smoothing', 50), 0)
    from public.ad_events
   where promotion_id = p_promotion_id;
$fn$;

create or replace function public.ad_auction()
returns table (
  task_id            uuid,
  promotion_id       uuid,
  daily_budget_minor bigint,
  spent_today_minor  bigint,
  ectr               numeric,
  total_value        numeric,
  charge_minor       bigint,
  rank               integer
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  with live as (
    select p.id, p.task_id,
           round(p.amount_minor::numeric / greatest(p.days, 1))::bigint as daily_budget_minor
      from public.task_promotions p
     where p.status = 'active' and p.starts_at <= now() and p.ends_at > now()
  ),
  spend as (
    select l.*, coalesce((
             select sum(e.cost_minor) from public.ad_events e
              where e.promotion_id = l.id and e.created_at >= date_trunc('day', now())
           ), 0)::bigint as spent_today_minor
      from live l
  ),
  scored as (
    select s.*, private.ad_ectr(s.id) as ectr,
           greatest(extract(epoch from (now() - date_trunc('day', now()))) / 86400.0, 0.02) as day_elapsed
      from spend s
     where s.spent_today_minor < s.daily_budget_minor   -- out of budget today
  ),
  valued as (
    select sc.*,
           (sc.daily_budget_minor * sc.ectr)
             * least(1.0, (sc.day_elapsed * sc.daily_budget_minor)
                            / greatest(sc.spent_today_minor, 1)) as total_value
      from scored sc
  ),
  ranked as (
    select v.*,
           row_number() over (order by v.total_value desc, v.daily_budget_minor desc) as rnk,
           lead(v.total_value) over (order by v.total_value desc, v.daily_budget_minor desc) as next_value
      from valued v
  )
  select r.task_id, r.id, r.daily_budget_minor, r.spent_today_minor,
         round(r.ectr, 5), round(r.total_value, 4),
         least(r.daily_budget_minor,
               greatest(private.setting_num('ad_min_charge_minor', 1),
                        ceil(coalesce(r.next_value, 0) / nullif(r.ectr, 0))))::bigint,
         r.rnk::integer
    from ranked r
   order by r.rnk;
$fn$;

revoke all on function public.ad_auction() from public, anon;
grant execute on function public.ad_auction() to authenticated;

create or replace function public.record_ad_impression(p_task_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_row record; v_cost bigint;
begin
  select * into v_row from public.ad_auction() a where a.task_id = p_task_id;
  if not found then return; end if;

  v_cost := greatest(
    round(v_row.charge_minor::numeric / private.setting_num('ad_cpm_divisor', 1000))::bigint,
    private.setting_num('ad_min_charge_minor', 1)::bigint
  );
  v_cost := least(v_cost, v_row.daily_budget_minor - v_row.spent_today_minor);
  if v_cost <= 0 then return; end if;

  insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor)
  values (v_row.promotion_id, p_task_id, auth.uid(), 'impression', v_cost);
end;
$fn$;

create or replace function public.record_ad_click(p_task_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_promo uuid;
begin
  select p.id into v_promo from public.task_promotions p
   where p.task_id = p_task_id and p.status = 'active'
     and p.starts_at <= now() and p.ends_at > now()
   limit 1;
  if v_promo is null then return; end if;
  insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor)
  values (v_promo, p_task_id, auth.uid(), 'click', 0);
end;
$fn$;

revoke all on function public.record_ad_impression(uuid) from public, anon;
revoke all on function public.record_ad_click(uuid) from public, anon;
grant execute on function public.record_ad_impression(uuid) to authenticated;
grant execute on function public.record_ad_click(uuid) to authenticated;

create or replace function public.my_campaign_stats()
returns table (
  promotion_id uuid, task_id uuid, title text, status text, ends_at timestamptz,
  budget_minor bigint, daily_minor bigint, spent_minor bigint,
  impressions bigint, clicks bigint, ctr numeric
)
language sql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
  select p.id, p.task_id, t.title, p.status, p.ends_at, p.amount_minor,
         round(p.amount_minor::numeric / greatest(p.days, 1))::bigint,
         coalesce(sum(e.cost_minor), 0)::bigint,
         count(e.*) filter (where e.kind = 'impression'),
         count(e.*) filter (where e.kind = 'click'),
         round(count(e.*) filter (where e.kind = 'click')::numeric
               / nullif(count(e.*) filter (where e.kind = 'impression'), 0), 4)
    from public.task_promotions p
    join public.tasks t on t.id = p.task_id
    left join public.ad_events e on e.promotion_id = p.id
   where p.user_id = auth.uid()
   group by p.id, p.task_id, t.title, p.status, p.ends_at, p.amount_minor, p.days
   order by p.created_at desc;
$fn$;

revoke all on function public.my_campaign_stats() from public, anon;
grant execute on function public.my_campaign_stats() to authenticated;
