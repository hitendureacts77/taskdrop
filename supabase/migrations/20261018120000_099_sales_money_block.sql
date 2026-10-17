-- Sales cannot read company money or settings, even by calling the database directly.
--
-- Until now the Sales staff role (089/097) only narrowed what the admin panel let
-- a person CHANGE; the database still answered every admin read. So a Sales login
-- could call, for example, admin_payout_queue() (people's UPI and bank details) or
-- read platform_ledger straight from the API. This closes that.
--
-- Additive: new helper functions, new RESTRICTIVE policies (they only ever narrow
-- what an existing policy allows), and a guard line added to existing functions.
-- Nothing is dropped or renamed. Anyone who is not a Sales login is unaffected.
-- The project owner at a SQL prompt is unaffected (no auth.uid()).
--
-- What stays open to Sales on purpose: people, jobs and their prices, CRM, leads,
-- follow-ups, reports/moderation, help requests, devices. Their OWN wallet, payouts
-- and promotions as an app user also stay readable. Not covered: a job's own money
-- columns (tasks.funded_*, assignments.escrow_minor), which the job page needs.

-- --------------------------------------------------------------- helpers --

create or replace function private.is_money_blind()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.staff_role = 'sales' from public.admin_staff s where s.user_id = auth.uid()), false);
$$;
revoke all on function private.is_money_blind() from public;
grant execute on function private.is_money_blind() to anon, authenticated;

create or replace function private.assert_not_money_blind()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if private.is_money_blind() then
    raise exception 'Your staff role does not include company money';
  end if;
end;
$$;
revoke all on function private.assert_not_money_blind() from public;
grant execute on function private.assert_not_money_blind() to anon, authenticated;

-- ---------------------------------------------------------------- tables --
-- Restrictive = ANDed with every existing policy. A Sales login still reads its
-- own rows (it is also an ordinary app user); other people's money is closed.

drop policy if exists sales_blind_wallets on public.wallets;
create policy sales_blind_wallets on public.wallets as restrictive for select to authenticated
  using (user_id = (select auth.uid()) or not private.is_money_blind());

drop policy if exists sales_blind_wallet_adjustments on public.wallet_adjustments;
create policy sales_blind_wallet_adjustments on public.wallet_adjustments as restrictive for select to authenticated
  using (user_id = (select auth.uid()) or not private.is_money_blind());

drop policy if exists sales_blind_payouts on public.payouts;
create policy sales_blind_payouts on public.payouts as restrictive for select to authenticated
  using (user_id = (select auth.uid()) or not private.is_money_blind());

drop policy if exists sales_blind_payout_profiles on public.payout_profiles;
create policy sales_blind_payout_profiles on public.payout_profiles as restrictive for select to authenticated
  using (user_id = (select auth.uid()) or not private.is_money_blind());

drop policy if exists sales_blind_task_promotions on public.task_promotions;
create policy sales_blind_task_promotions on public.task_promotions as restrictive for select to authenticated
  using (user_id = (select auth.uid()) or not private.is_money_blind());

drop policy if exists sales_blind_ad_events on public.ad_events;
create policy sales_blind_ad_events on public.ad_events as restrictive for select to authenticated
  using (
    not private.is_money_blind()
    or exists (select 1 from public.task_promotions p where p.id = ad_events.promotion_id and p.user_id = (select auth.uid()))
  );

drop policy if exists sales_blind_platform_ledger on public.platform_ledger;
create policy sales_blind_platform_ledger on public.platform_ledger as restrictive for select to authenticated
  using (not private.is_money_blind());

drop policy if exists sales_blind_dispute_decisions on public.dispute_decisions;
create policy sales_blind_dispute_decisions on public.dispute_decisions as restrictive for select to authenticated
  using (not private.is_money_blind());

drop policy if exists sales_blind_cancellations_log on public.cancellations_log;
create policy sales_blind_cancellations_log on public.cancellations_log as restrictive for select to authenticated
  using (not private.is_money_blind());

-- A dispute you opened, or one on your own job or work, stays readable.
drop policy if exists sales_blind_task_disputes on public.task_disputes;
create policy sales_blind_task_disputes on public.task_disputes as restrictive for select to authenticated
  using (
    not private.is_money_blind()
    or opened_by = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_disputes.task_id and t.poster_id = (select auth.uid()))
    or exists (select 1 from public.assignments a where a.task_id = task_disputes.task_id and a.worker_id = (select auth.uid()))
  );

-- Settings and the team: the audit log, alerts, other people's staff roles, the
-- per-platform controls and the automation rules. A Sales login keeps its own
-- staff row (the panel reads it to know the role).
drop policy if exists sales_blind_admin_audit_log on public.admin_audit_log;
create policy sales_blind_admin_audit_log on public.admin_audit_log as restrictive for select to authenticated
  using (not private.is_money_blind());

drop policy if exists sales_blind_admin_alerts on public.admin_alerts;
create policy sales_blind_admin_alerts on public.admin_alerts as restrictive for select to authenticated
  using (not private.is_money_blind());

drop policy if exists sales_blind_admin_staff on public.admin_staff;
create policy sales_blind_admin_staff on public.admin_staff as restrictive for select to authenticated
  using (user_id = (select auth.uid()) or not private.is_money_blind());

drop policy if exists sales_blind_app_controls on public.app_controls;
create policy sales_blind_app_controls on public.app_controls as restrictive for select to authenticated
  using (not private.is_money_blind());

drop policy if exists sales_blind_crm_rules on public.crm_rules;
create policy sales_blind_crm_rules on public.crm_rules as restrictive for select to authenticated
  using (not private.is_money_blind());

-- The live feed: no withdrawals, payouts, wallet changes or disputes.
drop policy if exists sales_blind_admin_live_events on public.admin_live_events;
create policy sales_blind_admin_live_events on public.admin_live_events as restrictive for select to authenticated
  using (
    not private.is_money_blind()
    or not (
      kind in ('withdrawal_requested', 'payout_status', 'wallet_adjustment')
      or (kind = 'task_status' and summary ->> 'to' = 'DISPUTED')
    )
  );

-- The broadcast channel sends every event to everyone who joins it, so Sales
-- does not join it (its live numbers still refresh every minute from the server).
drop policy if exists sales_blind_staff_live_channel on realtime.messages;
create policy sales_blind_staff_live_channel on realtime.messages as restrictive for select to authenticated
  using (realtime.topic() <> 'admin:live' or not private.is_money_blind());

-- ------------------------------------------------------------- functions --
-- Each keeps its signature and body; one guard line is added at the top.

CREATE OR REPLACE FUNCTION public.admin_business_daily(p_from date, p_to date)
 RETURNS TABLE(day date, new_people bigint, jobs_posted bigint, jobs_finished bigint, cancellations bigint, disputes_decided bigint, funded_minor bigint, topup_minor bigint, revenue_minor bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 400 then raise exception 'At most 400 days at a time'; end if;

  return query
  with d as (select generate_series(p_from, p_to, interval '1 day')::date as dd)
  select d.dd,
    (select count(*) from public.profiles p where (p.created_at at time zone 'Asia/Kolkata')::date = d.dd),
    (select count(*) from public.tasks t where (t.created_at at time zone 'Asia/Kolkata')::date = d.dd),
    (select count(*) from public.tasks t where t.status::text in ('COMPLETED', 'AUTO_COMPLETED') and (t.updated_at at time zone 'Asia/Kolkata')::date = d.dd),
    (select count(*) from public.cancellations_log c where (c.created_at at time zone 'Asia/Kolkata')::date = d.dd),
    (select count(*) from public.dispute_decisions x where (x.created_at at time zone 'Asia/Kolkata')::date = d.dd),
    coalesce((select sum(pay.amount_minor) from public.payments pay where pay.status::text = 'paid' and pay.purpose::text = 'escrow' and (pay.paid_at at time zone 'Asia/Kolkata')::date = d.dd), 0)::bigint,
    coalesce((select sum(pay.amount_minor) from public.payments pay where pay.status::text = 'paid' and pay.purpose::text = 'topup' and (pay.paid_at at time zone 'Asia/Kolkata')::date = d.dd), 0)::bigint,
    coalesce((select sum(l.amount_minor) from public.platform_ledger l where (l.created_at at time zone 'Asia/Kolkata')::date = d.dd), 0)::bigint
  from d
  order by d.dd;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_earnings_daily(p_since date)
 RETURNS TABLE(day date, kind text, amount_minor bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  return query
    select (l.created_at at time zone 'Asia/Kolkata')::date as day,
           l.kind,
           sum(l.amount_minor)::bigint
      from public.platform_ledger l
     where l.created_at >= (p_since::timestamp at time zone 'Asia/Kolkata')
     group by 1, 2
     order by 1, 2;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_funnel(p_from date, p_to date)
 RETURNS TABLE(joined bigint, engaged bigint, funded bigint, completed bigint, repeat bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  return query
  select count(*)::bigint,
         count(*) filter (where s.stage in ('engaged', 'funded', 'completed', 'repeat'))::bigint,
         count(*) filter (where s.stage in ('funded', 'completed', 'repeat'))::bigint,
         count(*) filter (where s.stage in ('completed', 'repeat'))::bigint,
         count(*) filter (where s.stage = 'repeat')::bigint
    from public.admin_user_stages() s
    join public.profiles p on p.id = s.user_id
   where (p.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_money_position()
 RETURNS TABLE(credits_minor bigint, earnings_minor bigint, clearing_minor bigint, locked_minor bigint, in_flight_minor bigint, refunds_owed_minor bigint, unapplied_minor bigint, held_for_people_minor bigint, ready_to_withdraw_minor bigint, taskdrop_earned_minor bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_credits   bigint;
  v_earnings  bigint;
  v_clearing  bigint;
  v_locked    bigint;
  v_flight    bigint;
  v_refunds   bigint;
  v_unapplied bigint;
  v_earned    bigint;
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  select coalesce(sum(w.credits_minor), 0), coalesce(sum(w.balance_minor), 0), coalesce(sum(w.clearing_minor), 0)
    into v_credits, v_earnings, v_clearing
    from public.wallets w;

  select coalesce(sum(
           case
             when t.funded_via = 'wallet' and t.wallet_refunded_at is null then coalesce(t.funded_minor, 0)
             when t.funded_via is distinct from 'wallet' and t.funding_payment_id is not null then coalesce((
               select greatest(p.amount_minor - p.refunded_minor, 0) from public.payments p where p.id = t.funding_payment_id), 0)
             else 0
           end), 0)
    into v_locked
    from public.tasks t
   where t.funded_at is not null
     and t.status in ('LOCKED', 'TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED', 'DISPUTED');

  select coalesce(sum(o.amount_minor), 0) into v_flight
    from public.payouts o
   where o.status in ('requested', 'processing')
     and not (o.provider_payout_id is not null
              and coalesce(o.provider_status, '') in ('processing', 'initiated', 'processed'));

  select coalesce(sum(r.due_minor), 0)::bigint into v_refunds from public.refunds_outstanding r;
  select coalesce(sum(u.paid_minor), 0)::bigint into v_unapplied from public.payments_unapplied u;

  select coalesce(sum(l.amount_minor), 0) into v_earned from public.platform_ledger l;

  return query select v_credits, v_earnings, v_clearing, v_locked, v_flight, v_refunds, v_unapplied,
    (v_credits + v_earnings + v_clearing + v_locked + v_flight + v_refunds + v_unapplied)::bigint,
    (v_earnings + v_clearing + v_flight)::bigint,
    v_earned;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_payout_queue()
 RETURNS TABLE(id uuid, user_id uuid, display_name text, amount_minor bigint, status payout_status, snapshot text, kind text, upi_id text, account_name text, account_number text, ifsc text, requested_at timestamp with time zone, via text, attempts integer, last_attempt_at timestamp with time zone, provider_payout_id text, provider_status text, provider_status_at timestamp with time zone, failure_note text, has_pan boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  return query
    select
      o.id, o.user_id, pr.display_name, o.amount_minor, o.status, o.destination,
      d.kind, d.upi_id, d.account_name, d.account_number, d.ifsc, o.created_at,
      o.via, o.attempts, o.last_attempt_at, o.provider_payout_id, o.provider_status,
      o.provider_status_at, o.failure_note,
      exists (select 1 from public.payout_profiles pp where pp.user_id = o.user_id)
    from public.payouts o
    left join public.profiles pr on pr.id = o.user_id
    left join lateral (
      select dd.*
        from public.payout_destinations dd
       where dd.user_id = o.user_id
         and (o.destination_id is null or dd.id = o.destination_id)
       order by (dd.upi_id is not distinct from o.destination) desc,
                dd.is_default desc,
                dd.created_at desc
       limit 1
    ) d on true
    where o.status in ('requested', 'processing')
    order by o.created_at;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_promotion_roi(p_from date, p_to date)
 RETURNS TABLE(promotions bigint, active bigint, spend_minor bigint, impressions bigint, clicks bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  return query
  select (select count(*) from public.task_promotions x where (x.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::bigint,
         (select count(*) from public.task_promotions x where x.status = 'active')::bigint,
         coalesce((select sum(e.cost_minor) from public.ad_events e where (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 0)::bigint,
         (select count(*) from public.ad_events e where e.kind = 'impression' and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::bigint,
         (select count(*) from public.ad_events e where e.kind = 'click' and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::bigint;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reconcile(p_from date, p_to date)
 RETURNS TABLE(check_code text, severity text, ref_type text, ref_id uuid, amount_minor bigint, at timestamp with time zone, detail text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not (private.staff_can(auth.uid(), 'money') or private.staff_role(auth.uid()) = 'viewer') then
    raise exception 'Your staff role (%) can''t see this.', private.staff_role(auth.uid()) using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 400 then raise exception 'At most 400 days at a time'; end if;
  return query select * from private.reconcile_rows(p_from, p_to);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_reconciliation_runs(p_limit integer DEFAULT 20)
 RETURNS TABLE(id uuid, ran_at timestamp with time zone, kind text, from_day date, to_day date, checked integer, mismatches integer, detail jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'private', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not (private.staff_can(auth.uid(), 'money') or private.staff_role(auth.uid()) = 'viewer') then
    raise exception 'Your staff role (%) can''t see this.', private.staff_role(auth.uid()) using errcode = '42501';
  end if;
  return query
  select r.id, r.ran_at, r.kind, r.from_day, r.to_day, r.checked, r.mismatches, r.detail
    from public.reconciliation_runs r
   order by r.ran_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_retention(p_weeks integer DEFAULT 8)
 RETURNS TABLE(cohort_week date, week_offset integer, cohort_size bigint, active bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_weeks is null or p_weeks < 1 or p_weeks > 26 then raise exception 'Choose between 1 and 26 weeks'; end if;
  return query
  with cohorts as (
    select p.id as pid, date_trunc('week', p.created_at at time zone 'Asia/Kolkata')::date as cw
      from public.profiles p
     where p.deleted_at is null
       and p.created_at >= now() - make_interval(weeks => p_weeks)
  ),
  sizes as (select c.cw, count(*) as n from cohorts c group by c.cw),
  act as (
    select t.poster_id as uid, date_trunc('week', t.created_at at time zone 'Asia/Kolkata')::date as aw from public.tasks t
    union
    select b.worker_id, date_trunc('week', b.created_at at time zone 'Asia/Kolkata')::date from public.bids b
  )
  select c.cw,
         ((a.aw - c.cw) / 7)::integer,
         sz.n::bigint,
         count(distinct c.pid)::bigint
    from cohorts c
    join act a on a.uid = c.pid and a.aw >= c.cw
    join sizes sz on sz.cw = c.cw
   group by c.cw, ((a.aw - c.cw) / 7)::integer, sz.n
   order by c.cw, 2;
end;
$function$;

CREATE OR REPLACE FUNCTION public.escrow_refund_due(p_task_id uuid)
 RETURNS TABLE(payment_id uuid, provider_payment_id text, due_minor bigint, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_me      uuid := auth.uid();
  v_task    public.tasks;
  v_pay     public.payments;
  v_penalty bigint;
begin
  perform private.assert_not_money_blind();
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  if v_task.poster_id <> v_me and not private.is_admin() then
    raise exception 'That is not your task';
  end if;

  if v_task.status <> 'CANCELLED' then
    return query select null::uuid, null::text, 0::bigint,
      'This task is not cancelled, so nothing is owed back'::text;
    return;
  end if;

  if v_task.funding_payment_id is null then
    return query select null::uuid, null::text, 0::bigint,
      'No escrow was ever paid for this task'::text;
    return;
  end if;

  select * into v_pay from public.payments where id = v_task.funding_payment_id;
  if not found or v_pay.status <> 'paid' then
    return query select null::uuid, null::text, 0::bigint,
      'The escrow payment never settled'::text;
    return;
  end if;

  select coalesce(sum(penalty_or_refund_minor), 0) into v_penalty
    from public.cancellations_log
   where task_id = p_task_id;

  return query
    select v_pay.id,
           v_pay.provider_payment_id,
           greatest(v_pay.amount_minor - v_pay.refunded_minor - v_penalty, 0)::bigint,
           case
             when v_pay.refunded_minor > 0 then 'Already refunded'
             else 'Cancelled task - escrow returned'
           end::text;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_earnings()
 RETURNS TABLE(balance_minor bigint, commission_minor bigint, poster_fee_minor bigint, orders bigint)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  return query
    select coalesce(sum(l.amount_minor), 0)::bigint,
           coalesce(sum(l.amount_minor) filter (where l.kind = 'worker_commission'), 0)::bigint,
           coalesce(sum(l.amount_minor) filter (where l.kind = 'poster_fee'), 0)::bigint,
           count(distinct l.task_id) filter (where l.kind = 'worker_commission')::bigint
      from public.platform_ledger l;
end;
$function$;

CREATE OR REPLACE FUNCTION public.platform_stats(p_days integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_since timestamptz := now() - make_interval(days => greatest(p_days, 1));
  v_out   jsonb;
begin
  perform private.assert_not_money_blind();
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

CREATE OR REPLACE FUNCTION public.admin_mark_payout(p_payout_id uuid, p_status text, p_note text DEFAULT NULL::text)
 RETURNS payouts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare v_row public.payouts;
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('processing', 'paid', 'failed') then
    raise exception 'A payout can be moved to processing, paid or failed';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'That payout no longer exists'; end if;
  if v_row.status in ('paid', 'failed', 'cancelled') then
    raise exception 'That payout is already %', v_row.status;
  end if;
  if v_row.via = 'razorpayx' and v_row.last_attempt_at is not null then
    raise exception 'This withdrawal was sent to RazorpayX, so only RazorpayX can settle it. Use "Check with RazorpayX".';
  end if;

  -- A person has taken it over: RazorpayX must never send it as well.
  update public.payouts
     set via = 'manual',
         status = p_status::public.payout_status,
         failure_note = case when p_status = 'failed' then p_note else failure_note end,
         reference = case when p_status = 'paid' then coalesce(p_note, reference) else reference end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if p_status = 'failed' then
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify(v_row.user_id, 'payout_failed', 'Withdrawal could not be sent',
      coalesce(p_note, 'It could not be sent') || '. The money is back in your earnings.', null);
  elsif p_status = 'paid' then
    perform private.notify(v_row.user_id, 'payout_paid', 'Money sent to your account',
      'Your withdrawal of ' || to_char(v_row.amount_minor / 100.0, 'FM999999990.00') || ' rupees has been sent.', null);
  end if;

  return v_row;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_resolve_dispute(p_task_id uuid, p_outcome text, p_note text DEFAULT NULL::text)
 RETURNS tasks
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_task       public.tasks;
  v_assign     public.assignments;
  v_net        bigint := 0;
  v_back       bigint := 0;
  v_clear_days numeric := private.setting_num('clearing_period_days', 0);
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;
  if p_outcome not in ('worker', 'poster') then
    raise exception 'Resolve in favour of the worker or the poster';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task no longer exists';
  end if;
  if v_task.status <> 'DISPUTED' then
    raise exception 'That task is not disputed';
  end if;

  select * into v_assign from public.assignments a
   where a.task_id = p_task_id and a.status in ('started', 'assigned')
   order by (a.status = 'started') desc, a.created_at desc
   limit 1;

  if p_outcome = 'worker' then
    if v_task.funded_at is null then
      raise exception 'Nothing was paid for this job, so there is nothing to pay the worker';
    end if;
    if v_assign.id is null then
      raise exception 'No worker on this task to pay';
    end if;

    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - private.setting_num('worker_commission_pct', 0.20)));
    insert into public.wallets (user_id) values (v_assign.worker_id) on conflict (user_id) do nothing;
    update public.assignments set status = 'released' where id = v_assign.id;

    if v_clear_days <= 0 then
      update public.wallets set balance_minor = balance_minor + v_net, updated_at = now()
       where user_id = v_assign.worker_id;
      update public.tasks
         set status = 'COMPLETED', completed_at = now(), clear_at = now(), cleared_at = now(), updated_at = now()
       where id = p_task_id
      returning * into v_task;
    else
      update public.wallets set clearing_minor = clearing_minor + v_net, updated_at = now()
       where user_id = v_assign.worker_id;
      update public.tasks
         set status = 'COMPLETED',
             completed_at = now(),
             clear_at = now() + make_interval(days => v_clear_days::int),
             updated_at = now()
       where id = p_task_id
      returning * into v_task;
    end if;
  else
    v_back := case
      when v_task.funded_via = 'wallet' and v_task.wallet_refunded_at is null then coalesce(v_task.funded_minor, 0)
      when v_task.funding_payment_id is not null then coalesce((
        select greatest(p.amount_minor - p.refunded_minor, 0) from public.payments p where p.id = v_task.funding_payment_id), 0)
      else 0
    end;

    update public.assignments set status = 'refunded'
     where task_id = p_task_id and status in ('assigned', 'started');

    update public.tasks
       set status = 'CANCELLED', completed_at = now(), updated_at = now()
     where id = p_task_id
    returning * into v_task;

    insert into public.cancellations_log (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
    values (p_task_id, 'poster', 'normal', 'DISPUTED', v_task.locked_minor, 0);
  end if;

  insert into public.dispute_decisions (task_id, decided_by, outcome, note, worker_paid_minor, poster_refunded_minor)
  values (p_task_id, auth.uid(), p_outcome, nullif(btrim(coalesce(p_note, '')), ''), v_net, v_back);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_payout_method(p_method text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_method not in ('manual', 'razorpayx') then
    raise exception 'The payout method is manual or razorpayx';
  end if;

  insert into public.settings (key, value) values ('payout_method', to_jsonb(p_method))
  on conflict (key) do update set value = excluded.value;

  if p_method = 'razorpayx' then
    update public.payouts
       set via = 'razorpayx', updated_at = now()
     where status = 'requested' and via = 'manual' and last_attempt_at is null;
  end if;

  return p_method;
end;
$function$;

