-- 123 — the reconciliation no longer flags a payment that was fully refunded (Phase 2, P2-8).
--
-- `paid_not_credited` looked for a paid payment with no credit recorded. A payment that
-- was refunded in full never gets a credit, so it showed up as a mismatch every day (the
-- test project had one, pay_TgdMVcUQqGixjS). The check now skips a payment whose refunded
-- amount equals its amount. Everything else in the function is exactly as in 106.
--
-- create or replace keeps the owner and the grants.

create or replace function private.reconcile_rows(p_from date, p_to date)
returns table (check_code text, severity text, ref_type text, ref_id uuid, amount_minor bigint, at timestamptz, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
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
     and coalesce(pay.refunded_minor, 0) < pay.amount_minor
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
  select 'finished_without_commission'::text, 'high'::text, 'task'::text, t.id, null::bigint, t.completed_at,
         'Finished job has no worker commission in the ledger'::text
    from public.tasks t
   where t.status::text in ('COMPLETED', 'AUTO_COMPLETED') and t.funded_at is not null
     and exists (select 1 from public.assignments a where a.task_id = t.id)
     and not exists (select 1 from public.platform_ledger l where l.task_id = t.id and l.kind = 'worker_commission')
     and (t.completed_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  order by 6 desc;
end;
$$;
