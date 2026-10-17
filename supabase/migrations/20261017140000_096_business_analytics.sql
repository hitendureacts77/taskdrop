-- 096 -- Business analytics and a money consistency check, for the admin panel.
--
-- Read-only, admins only. Days are Indian Standard Time days.
--
--   admin_business_daily(from, to)   one row per day: new people, jobs posted,
--                                    jobs finished, cancellations, disputes
--                                    decided, money paid in (job funding and
--                                    top-ups), and TaskDrop's own earnings.
--   admin_funnel(from, to)           of the people who joined in the window,
--                                    how many got to each stage (see 094).
--   admin_retention(weeks)           weekly sign-up groups and how many of
--                                    each were active (posted or offered) in
--                                    the weeks after joining.
--   admin_promotion_roi(from, to)    promotion spend, views and clicks.
--   admin_reconcile(from, to)        internal money checks. Each row is one
--                                    thing that does not add up. It does NOT
--                                    ask Razorpay; comparing against the
--                                    provider's own records needs an edge
--                                    function and is a separate piece of work.
--
-- Only adds functions. Nothing is dropped or renamed.

create or replace function public.admin_business_daily(p_from date, p_to date)
returns table (day date, new_people bigint, jobs_posted bigint, jobs_finished bigint, cancellations bigint, disputes_decided bigint, funded_minor bigint, topup_minor bigint, revenue_minor bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
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
$fn$;
revoke all on function public.admin_business_daily(date, date) from public, anon;
grant execute on function public.admin_business_daily(date, date) to authenticated;

create or replace function public.admin_funnel(p_from date, p_to date)
returns table (joined bigint, engaged bigint, funded bigint, completed bigint, repeat bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
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
$fn$;
revoke all on function public.admin_funnel(date, date) from public, anon;
grant execute on function public.admin_funnel(date, date) to authenticated;

create or replace function public.admin_retention(p_weeks integer default 8)
returns table (cohort_week date, week_offset integer, cohort_size bigint, active bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
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
$fn$;
revoke all on function public.admin_retention(integer) from public, anon;
grant execute on function public.admin_retention(integer) to authenticated;

create or replace function public.admin_promotion_roi(p_from date, p_to date)
returns table (promotions bigint, active bigint, spend_minor bigint, impressions bigint, clicks bigint)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  return query
  select (select count(*) from public.task_promotions x where (x.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::bigint,
         (select count(*) from public.task_promotions x where x.status = 'active')::bigint,
         coalesce((select sum(e.cost_minor) from public.ad_events e where (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to), 0)::bigint,
         (select count(*) from public.ad_events e where e.kind = 'impression' and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::bigint,
         (select count(*) from public.ad_events e where e.kind = 'click' and (e.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to)::bigint;
end;
$fn$;
revoke all on function public.admin_promotion_roi(date, date) from public, anon;
grant execute on function public.admin_promotion_roi(date, date) to authenticated;

-- Things that do not add up. check_code says which rule; ref is the row to open.
create or replace function public.admin_reconcile(p_from date, p_to date)
returns table (check_code text, severity text, ref_type text, ref_id uuid, amount_minor bigint, at timestamptz, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not (private.staff_can(auth.uid(), 'money') or private.staff_role(auth.uid()) = 'viewer') then
    raise exception 'Your staff role (%) can''t see this.', private.staff_role(auth.uid()) using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 400 then raise exception 'At most 400 days at a time'; end if;

  return query
  select 'funded_without_paid_payment'::text, 'high'::text, 'task'::text, t.id, t.locked_minor::bigint, t.funded_at,
         ('Job is funded but its payment is ' || coalesce(pay.status::text, 'missing'))::text
    from public.tasks t
    left join public.payments pay on pay.id = t.funding_payment_id
   where t.funded_at is not null and t.funding_payment_id is not null and coalesce(pay.status::text, '') <> 'paid'
     and (t.funded_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'paid_not_credited'::text, 'high'::text, 'payment'::text, pay.id, pay.amount_minor::bigint, pay.paid_at,
         ('Paid ' || pay.purpose::text || ' with no credit recorded')::text
    from public.payments pay
   where pay.status::text = 'paid' and pay.credited_at is null
     and not exists (select 1 from public.tasks t where t.funding_payment_id = pay.id)
     and (pay.paid_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payment_stuck_created'::text, 'medium'::text, 'payment'::text, pay.id, pay.amount_minor::bigint, pay.created_at,
         'Payment link created and never paid'::text
    from public.payments pay
   where pay.status::text = 'created' and pay.created_at < now() - interval '2 days'
     and (pay.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payout_waiting_long'::text, 'medium'::text, 'payout'::text, po.id, po.amount_minor::bigint, po.created_at,
         'Withdrawal still waiting'::text
    from public.payouts po
   where po.status::text = 'requested' and po.created_at < now() - interval '3 days'
     and (po.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payout_paid_no_reference'::text, 'high'::text, 'payout'::text, po.id, po.amount_minor::bigint, po.updated_at,
         'Paid via RazorpayX without a provider reference'::text
    from public.payouts po
   where po.status::text = 'paid' and po.via = 'razorpayx' and po.provider_payout_id is null
     and (po.updated_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'finished_without_commission'::text, 'high'::text, 'task'::text, t.id, null::bigint, t.updated_at,
         'Finished job has no worker commission in the ledger'::text
    from public.tasks t
   where t.status::text in ('COMPLETED', 'AUTO_COMPLETED') and t.funded_at is not null
     and exists (select 1 from public.assignments a where a.task_id = t.id)
     and not exists (select 1 from public.platform_ledger l where l.task_id = t.id and l.kind = 'worker_commission')
     and (t.updated_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  order by 6 desc;
end;
$fn$;
revoke all on function public.admin_reconcile(date, date) from public, anon;
grant execute on function public.admin_reconcile(date, date) to authenticated;
