-- 015_platform_stats
--
-- The numbers an owner needs to know whether this business is working, in one
-- round trip.
--
-- It is a SECURITY DEFINER function gated on private.is_admin() rather than a
-- view: these figures span every user's rows, so RLS would either hide most of
-- them or have to be opened up in a way that leaks one customer's data to
-- another. Gating the whole answer on the caller being an admin keeps the
-- normal policies untouched.
--
-- Revenue is derived the same way the money RPCs derive it — 20% of the locked
-- amount from the worker, plus the 3% the poster paid on top — so the dashboard
-- can never drift from what was actually moved.

create or replace function public.platform_stats(p_days int default 30)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_out   jsonb;
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  select jsonb_build_object(
    'windowDays', greatest(p_days, 1),

    -- ---- money ---------------------------------------------------------
    'gmvMinor', coalesce((
      select sum(t.locked_minor)
      from public.tasks t
      where t.status in ('COMPLETED', 'AUTO_COMPLETED')
        and t.completed_at >= v_since
    ), 0),

    'revenueMinor', coalesce((
      select sum(round(t.locked_minor * 0.20) + round(t.locked_minor * 0.03))
      from public.tasks t
      where t.status in ('COMPLETED', 'AUTO_COMPLETED')
        and t.completed_at >= v_since
    ), 0),

    'escrowHeldMinor', coalesce((
      select sum(a.escrow_minor)
      from public.assignments a
      where a.status in ('assigned', 'started')
    ), 0),

    'payoutsPendingMinor', coalesce((
      select sum(p.amount_minor) from public.payouts p where p.status = 'requested'
    ), 0),

    -- ---- flow ----------------------------------------------------------
    'tasksPosted', (select count(*) from public.tasks where created_at >= v_since),
    'tasksCompleted', (
      select count(*) from public.tasks
      where status in ('COMPLETED', 'AUTO_COMPLETED') and completed_at >= v_since
    ),
    'tasksCancelled', (
      select count(*) from public.tasks where status = 'CANCELLED' and updated_at >= v_since
    ),
    'tasksOpen', (select count(*) from public.tasks where status = 'OPEN'),
    'tasksLive', (
      select count(*) from public.tasks
      where status in ('LOCKED', 'TASK_STARTED', 'OVERDUE', 'WORK_DONE')
    ),
    'disputesOpen', (select count(*) from public.tasks where status = 'DISPUTED'),

    -- ---- marketplace health -------------------------------------------
    'quotesPlaced', (select count(*) from public.bids where created_at >= v_since),
    -- The share of requests that actually attract a quote. If this sags, the
    -- supply side is too thin and nothing else matters.
    'quotedRate', (
      select case when count(*) = 0 then 0
        else round(
          count(*) filter (where exists (select 1 from public.bids b where b.task_id = t.id))::numeric
          / count(*)::numeric, 4)
      end
      from public.tasks t where t.created_at >= v_since
    ),

    -- ---- people --------------------------------------------------------
    'newUsers', (select count(*) from public.profiles where created_at >= v_since),
    'totalUsers', (select count(*) from public.profiles),
    'activeUsers', (
      select count(distinct u) from (
        select poster_id as u from public.tasks where created_at >= v_since
        union
        select worker_id from public.bids where created_at >= v_since
      ) s
    ),

    -- ---- reputation ----------------------------------------------------
    'avgWorkerRating', coalesce((
      select round(avg(rating)::numeric, 2) from public.reviews
      where about_role = 'worker' and created_at >= v_since
    ), 0),

    -- ---- a small daily series for the chart ----------------------------
    'daily', coalesce((
      select jsonb_agg(row_to_json(d) order by d.day)
      from (
        select
          date_trunc('day', gs)::date as day,
          (select count(*) from public.tasks t
             where t.created_at >= gs and t.created_at < gs + interval '1 day') as posted,
          (select count(*) from public.tasks t
             where t.status in ('COMPLETED','AUTO_COMPLETED')
               and t.completed_at >= gs and t.completed_at < gs + interval '1 day') as completed,
          (select coalesce(sum(round(t.locked_minor * 0.23)), 0) from public.tasks t
             where t.status in ('COMPLETED','AUTO_COMPLETED')
               and t.completed_at >= gs and t.completed_at < gs + interval '1 day') as revenue_minor
        from generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') gs
      ) d
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.platform_stats(int) from public;
grant execute on function public.platform_stats(int) to authenticated;
