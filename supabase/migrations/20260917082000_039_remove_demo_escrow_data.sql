-- 039 — remove the seeded demo escrow data.
--
-- Nine payments with provider_ref 'plink_demo_*' were inserted to populate the
-- escrow and dispute screens. They were never real Razorpay payments, but they
-- were indistinguishable from real ones in every figure the platform reports,
-- and four of them had been "released" — crediting ₹6,600 of clearing to three
-- wallets, with a further ₹310 from a demo cancellation penalty.
--
-- That was the entire clearing balance on the platform: ₹6,910, none of it
-- backed by money anyone ever paid. The nightly sweep scheduled in 038 would
-- have turned it into withdrawable balance within days.
--
-- The wallet reversal is written to wallet_adjustments rather than done
-- silently, so the numbers can be explained later. On a database that never
-- had the demo rows, every statement here matches nothing and does nothing.

create temporary table _demo_tasks on commit drop as
select distinct t.id
from public.tasks t
where t.id in (select task_id from public.payments where provider_ref like 'plink_demo%')
   or t.funding_payment_id in (select id from public.payments where provider_ref like 'plink_demo%');

create temporary table _demo_payments on commit drop as
select id from public.payments where provider_ref like 'plink_demo%';

-- What each worker was credited by this demo data.
create temporary table _reversal on commit drop as
with released as (
  select a.worker_id, round(coalesce(t.locked_minor, 0) * 0.8) as amount
    from public.tasks t
    join public.assignments a on a.task_id = t.id
   where t.id in (select id from _demo_tasks)
     and t.status in ('COMPLETED', 'AUTO_COMPLETED')
),
fined as (
  select a.worker_id, l.penalty_or_refund_minor as amount
    from public.cancellations_log l
    join public.assignments a on a.task_id = l.task_id
   where l.task_id in (select id from _demo_tasks)
     and coalesce(l.penalty_or_refund_minor, 0) > 0
)
select worker_id, sum(amount)::bigint as amount
  from (select * from released union all select * from fined) x
 group by worker_id;

insert into public.wallet_adjustments (user_id, delta_minor, balance_before, clearing_before, reason)
select r.worker_id,
       -r.amount,
       w.balance_minor,
       w.clearing_minor,
       'Reversing clearing credited by seeded demo tasks (migration 039)'
  from _reversal r
  join public.wallets w on w.user_id = r.worker_id;

-- Never take a wallet negative, even if the arithmetic above is ever wrong.
update public.wallets w
   set clearing_minor = greatest(w.clearing_minor - r.amount, 0)
  from _reversal r
 where w.user_id = r.worker_id;

-- Dependents first.
delete from public.reviews            where task_id in (select id from _demo_tasks);
delete from public.messages           where task_id in (select id from _demo_tasks);
delete from public.cancellations_log  where task_id in (select id from _demo_tasks);
delete from public.task_promotions    where task_id in (select id from _demo_tasks);
delete from public.assignments        where task_id in (select id from _demo_tasks);
delete from public.bids               where task_id in (select id from _demo_tasks);

-- Break both directions of the task <-> payment reference before either goes.
update public.tasks    set funding_payment_id = null where id in (select id from _demo_tasks);
update public.payments set task_id = null           where id in (select id from _demo_payments);

delete from public.tasks    where id in (select id from _demo_tasks);
delete from public.payments where id in (select id from _demo_payments);
