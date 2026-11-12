-- 177: a paid promotion switches on without the payer coming back to the screen
-- (debug round 1, W1).
--
-- W1 (Medium-High) Only the app called activate_promotion(promotion, payment), from the Promote
--     screen, holding the campaign id in screen state. Close the tab after paying and the campaign
--     stayed 'pending' while the payment was 'paid'. The payment webhook and the razorpay function's
--     sync acted only on 'escrow' and 'topup'.
--     * payments.promotion_id (new, nullable): the razorpay function's create-link writes the
--       campaign a promotion link was made for.
--     * activate_promotion_from_payment(payment): service role only (the webhook and the razorpay
--       function call it). It finds the campaign (payments.promotion_id; for a link made before
--       this column, the newest pending campaign of the same person, task and amount made before
--       the payment and not run by another payment) and switches it on once, with the same checks
--       and refusals as activate_promotion (111). Asking again is harmless: a payment that already
--       runs a campaign returns that campaign; a payment that is not a settled promotion, or has no
--       campaign to run, returns null. The app's own activate_promotion call keeps working: on a
--       campaign already active it returns the row unchanged.
--
-- Only adds: one nullable column and one new function.

alter table public.payments
  add column if not exists promotion_id uuid references public.task_promotions(id) on delete set null;

comment on column public.payments.promotion_id is
  'For a promotion payment: the campaign its link was made for (migration 177). Null for other purposes and older links.';

create or replace function public.activate_promotion_from_payment(p_payment_id uuid)
returns public.task_promotions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_pay public.payments;
  v_row public.task_promotions;
begin
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found or v_pay.purpose::text <> 'promotion' or v_pay.status::text <> 'paid' then
    return null;
  end if;

  -- Already running a campaign (an earlier call, or the app): nothing more to do.
  select * into v_row from public.task_promotions where payment_id = p_payment_id;
  if found then
    return v_row;
  end if;

  if v_pay.promotion_id is not null then
    select * into v_row from public.task_promotions
     where id = v_pay.promotion_id for update;
  else
    select * into v_row from public.task_promotions p
     where p.user_id = v_pay.user_id
       and p.task_id is not distinct from v_pay.task_id
       and p.status = 'pending'
       and p.payment_id is null
       and p.amount_minor = v_pay.amount_minor
       and p.created_at <= v_pay.created_at
     order by p.created_at desc, p.id
     limit 1
     for update;
  end if;
  if not found then
    return null;
  end if;

  -- The checks of activate_promotion (111), for the payment's owner instead of the caller.
  if v_row.user_id <> v_pay.user_id then
    raise exception 'That is not your campaign';
  end if;
  if v_row.status = 'active' then
    return v_row;
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That campaign is no longer pending';
  end if;
  if v_pay.task_id is distinct from v_row.task_id then
    raise exception 'That payment was not for this campaign';
  end if;
  if v_pay.amount_minor < v_row.amount_minor then
    raise exception 'That payment does not cover the campaign';
  end if;
  if v_row.payment_id is not null and v_row.payment_id <> p_payment_id then
    raise exception 'That payment already runs another campaign';
  end if;

  update public.payments set credited_at = coalesce(credited_at, now()) where id = v_pay.id;

  update public.task_promotions
     set status = 'active',
         payment_id = p_payment_id,
         starts_at = now(),
         ends_at = now() + make_interval(days => v_row.days),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.activate_promotion_from_payment(uuid) from public, anon, authenticated;
grant execute on function public.activate_promotion_from_payment(uuid) to service_role;
