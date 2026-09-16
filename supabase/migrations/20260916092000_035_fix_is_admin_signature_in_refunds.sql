-- 035 — private.is_admin() takes no argument.
--
-- 033 and 034 called it as is_admin(uuid), so every call to escrow_refund_due
-- and record_escrow_refund raised "function private.is_admin(uuid) does not
-- exist" — the refund path was dead on arrival and the first live call said so.
--
-- 033 and 034 were corrected in place before they were committed, so replaying
-- this repo from scratch never hits the bug. This file exists because the
-- project database already had the broken versions applied, and its migration
-- history has to match the repo's.

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
$$;

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
  v_pay  public.payments;
  v_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
begin
  if not (v_role = 'service_role' or private.is_admin()) then
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

revoke all on function public.escrow_refund_due(uuid) from public, anon;
grant execute on function public.escrow_refund_due(uuid) to authenticated;
revoke all on function public.record_escrow_refund(uuid, text, bigint) from public, anon, authenticated;
grant execute on function public.record_escrow_refund(uuid, text, bigint) to service_role;
