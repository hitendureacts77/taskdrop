-- Worker commission: 20% -> 10%.
--
-- Every function that moves a worker's money (confirm_release,
-- auto_complete_due, admin_resolve_dispute, settle_cleared_earnings,
-- settle_my_cleared_earnings) and books platform revenue
-- (book_revenue_on_completion) reads this setting at the moment it runs, so
-- changing the one row changes them all. Jobs released from now on pay the
-- worker 90% of the agreed price.
--
-- Earnings already released at 20% are safe: settle_* never moves more out of
-- clearing than is actually there, so a job that put 80% into clearing still
-- pays exactly that 80%.

update public.settings
   set value = to_jsonb(0.10)
 where key = 'worker_commission_pct';

-- What TaskDrop actually earned on one completed job: the commission and
-- poster fee booked for it, or -- for a job older than the ledger -- the
-- 20% + 3% every such job was charged.
create or replace function private.task_revenue_minor(p_task_id uuid, p_locked_minor bigint)
 returns bigint
 language sql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
  select coalesce(
    (select sum(l.amount_minor)::bigint from public.platform_ledger l
      where l.task_id = p_task_id and l.kind in ('worker_commission', 'poster_fee')),
    round(coalesce(p_locked_minor, 0) * 0.20)::bigint + round(coalesce(p_locked_minor, 0) * 0.03)::bigint
  );
$function$;

revoke all on function private.task_revenue_minor(uuid, bigint) from public, anon, authenticated;

-- platform_stats worked revenue out as a flat 20% + 3% of every completed job,
-- which stops being true today. It now reads what was actually booked for each
-- job in platform_ledger. Jobs finished before the ledger existed have no rows
-- there; all of them were charged the original 20% + 3%, so that is what they
-- are counted at.
create or replace function public.platform_stats(p_days integer default 30)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_out   jsonb;
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  select jsonb_build_object(
    'windowDays', greatest(p_days, 1),
    'gmvMinor', coalesce((
      select sum(t.locked_minor) from public.tasks t
      where t.status in ('COMPLETED', 'AUTO_COMPLETED') and t.completed_at >= v_since
    ), 0),
    'revenueMinor', coalesce((
      select sum(private.task_revenue_minor(t.id, t.locked_minor))
      from public.tasks t
      where t.status in ('COMPLETED', 'AUTO_COMPLETED') and t.completed_at >= v_since
    ), 0),
    'escrowHeldMinor', coalesce((
      select sum(a.escrow_minor) from public.assignments a
      where a.status in ('assigned', 'started')
    ), 0),
    'payoutsPendingMinor', coalesce((
      select sum(p.amount_minor) from public.payouts p where p.status = 'requested'
    ), 0),
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
    'quotesPlaced', (select count(*) from public.bids where created_at >= v_since),
    'quotedRate', (
      select case when count(*) = 0 then 0
        else round(
          count(*) filter (where exists (select 1 from public.bids b where b.task_id = t.id))::numeric
          / count(*)::numeric, 4)
      end
      from public.tasks t where t.created_at >= v_since
    ),
    'newUsers', (select count(*) from public.profiles where created_at >= v_since),
    'totalUsers', (select count(*) from public.profiles),
    'activeUsers', (
      select count(distinct u) from (
        select poster_id as u from public.tasks where created_at >= v_since
        union
        select worker_id from public.bids where created_at >= v_since
      ) s
    ),
    'avgWorkerRating', coalesce((
      select round(avg(rating)::numeric, 2) from public.reviews
      where about_role = 'worker' and created_at >= v_since
    ), 0),
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
          (select coalesce(sum(private.task_revenue_minor(t.id, t.locked_minor)), 0) from public.tasks t
             where t.status in ('COMPLETED','AUTO_COMPLETED')
               and t.completed_at >= gs and t.completed_at < gs + interval '1 day') as revenue_minor
        from generate_series(date_trunc('day', v_since), date_trunc('day', now()), interval '1 day') gs
      ) d
    ), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$function$;
