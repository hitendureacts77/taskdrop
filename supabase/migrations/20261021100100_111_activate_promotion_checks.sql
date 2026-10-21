-- 111 — activate_promotion checks what was paid for (Phase 2, known bug).
--
-- Until now the only gate was "the caller has some paid payment": a ₹1 top-up,
-- or an escrow payment already holding a worker's money, could switch on a
-- campaign of any size, and one payment could switch on several. A campaign
-- now needs a settled payment that
--   * is for a promotion (purpose 'promotion', migration 110),
--   * belongs to the caller and to this campaign's task,
--   * covers the campaign's amount, and
--   * has not already been used by another campaign.
-- The payment is marked credited once it is spent, so the closeout check
-- "paid, not credited" does not flag a promotion that is running.
--
-- Same name, arguments and return type as migration 022, so a caller that used
-- the function correctly sees no difference. Replacing the function only.

create or replace function public.activate_promotion(p_promotion_id uuid, p_payment_id uuid)
returns public.task_promotions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me  uuid := auth.uid();
  v_row public.task_promotions;
  v_pay public.payments;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_row from public.task_promotions
   where id = p_promotion_id for update;
  if not found then
    raise exception 'That campaign no longer exists';
  end if;
  if v_row.user_id <> v_me then
    raise exception 'That is not your campaign';
  end if;
  -- Already running: say so rather than extending it on a repeated call.
  if v_row.status = 'active' then
    return v_row;
  end if;
  if v_row.status <> 'pending' then
    raise exception 'That campaign is no longer pending';
  end if;

  select * into v_pay from public.payments p
   where p.id = p_payment_id and p.user_id = v_me
   for update;
  if not found or v_pay.status::text <> 'paid' then
    raise exception 'That payment has not settled yet';
  end if;
  if v_pay.purpose::text <> 'promotion' or v_pay.task_id is distinct from v_row.task_id then
    raise exception 'That payment was not for this campaign';
  end if;
  if v_pay.amount_minor < v_row.amount_minor then
    raise exception 'That payment does not cover the campaign';
  end if;
  if exists (select 1 from public.task_promotions o where o.payment_id = p_payment_id and o.id <> v_row.id) then
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

revoke all on function public.activate_promotion(uuid, uuid) from anon, public;
grant execute on function public.activate_promotion(uuid, uuid) to authenticated;
