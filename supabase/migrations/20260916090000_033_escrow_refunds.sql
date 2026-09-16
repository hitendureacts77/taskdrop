-- 033 — refunding escrow when a task is cancelled.
--
-- Money-in worked end to end; money-back did not exist. cancel_task() closed
-- the task and credited the worker's penalty, and the poster's payment simply
-- stayed with Razorpay until somebody remembered to refund it by hand.
--
-- Refunding needs the Razorpay *payment* id (pay_...), not the payment *link*
-- id (plink_...) we were storing, so that is captured here too.

alter table public.payments
  add column if not exists provider_payment_id text,
  add column if not exists refunded_minor bigint not null default 0,
  add column if not exists refund_ref text,
  add column if not exists refunded_at timestamptz;

comment on column public.payments.provider_payment_id is
  'Razorpay payment id (pay_...). Refunds are issued against this, not the link.';
comment on column public.payments.refunded_minor is
  'How much of this payment has been sent back, in paise. Never exceeds amount_minor.';

alter table public.payments
  drop constraint if exists payments_refund_within_amount;
alter table public.payments
  add constraint payments_refund_within_amount
  check (refunded_minor >= 0 and refunded_minor <= amount_minor);

-- ---------------------------------------------------------------------------
-- What a cancelled task still owes back to the poster.
--
-- The escrow the poster paid, less anything already refunded, less the penalty
-- that was paid to the worker out of it. The 3% service fee IS returned: the
-- service it pays for is a completed job, and there wasn't one.
-- ---------------------------------------------------------------------------
create or replace function public.escrow_refund_due(p_task_id uuid)
returns table (
  payment_id          uuid,
  provider_payment_id text,
  due_minor           bigint,
  reason              text
)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me      uuid := auth.uid();
  v_task    public.tasks;
  v_pay     public.payments;
  v_penalty bigint;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  -- The poster is the only person owed this money. Admin can look.
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

  -- What the worker was already paid out of this escrow stays paid.
  select coalesce(sum(penalty_or_refund_minor), 0) into v_penalty
    from public.cancellations_log
   where task_id = p_task_id;

  return query
    select v_pay.id,
           v_pay.provider_payment_id,
           greatest(v_pay.amount_minor - v_pay.refunded_minor - v_penalty, 0)::bigint,
           case
             when v_pay.refunded_minor > 0 then 'Already refunded'
             else 'Cancelled task — escrow returned'
           end::text;
end;
$$;

revoke all on function public.escrow_refund_due(uuid) from public;
grant execute on function public.escrow_refund_due(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Write down a refund Razorpay has accepted.
--
-- Service role only: this is called by the edge function after the money has
-- actually moved. Nothing a client says about a refund is believed.
-- ---------------------------------------------------------------------------
create or replace function public.record_escrow_refund(
  p_payment_id   uuid,
  p_ref          text,
  p_amount_minor bigint
)
returns public.payments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pay public.payments;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform records refunds';
  end if;

  if p_amount_minor is null or p_amount_minor <= 0 then
    raise exception 'A refund needs an amount';
  end if;

  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found then
    raise exception 'That payment does not exist';
  end if;

  if v_pay.refunded_minor + p_amount_minor > v_pay.amount_minor then
    raise exception 'That would refund more than was paid';
  end if;

  update public.payments
     set refunded_minor = refunded_minor + p_amount_minor,
         refund_ref     = coalesce(p_ref, refund_ref),
         refunded_at    = now(),
         updated_at     = now()
   where id = p_payment_id
  returning * into v_pay;

  return v_pay;
end;
$$;

revoke all on function public.record_escrow_refund(uuid, text, bigint) from public;
revoke all on function public.record_escrow_refund(uuid, text, bigint) from authenticated;

-- Refunds owed but not yet sent — the operator's queue, and the answer to
-- "did that poster get their money back".
create or replace view public.refunds_outstanding as
  select t.id            as task_id,
         t.title,
         t.poster_id,
         p.id            as payment_id,
         p.provider_payment_id,
         p.amount_minor,
         p.refunded_minor,
         coalesce(c.penalty, 0) as penalty_minor,
         greatest(p.amount_minor - p.refunded_minor - coalesce(c.penalty, 0), 0) as due_minor,
         t.completed_at  as cancelled_at
    from public.tasks t
    join public.payments p on p.id = t.funding_payment_id
    left join lateral (
      select coalesce(sum(penalty_or_refund_minor), 0) as penalty
        from public.cancellations_log l
       where l.task_id = t.id
    ) c on true
   where t.status = 'CANCELLED'
     and p.status = 'paid'
     and p.amount_minor - p.refunded_minor - coalesce(c.penalty, 0) > 0;

comment on view public.refunds_outstanding is
  'Cancelled, funded tasks whose escrow has not been returned to the poster yet.';
