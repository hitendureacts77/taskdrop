-- 046 — you only pay for delivery.
--
-- The campaign total is collected up front, but the Meta model bills per
-- impression: what is not delivered is not owed. Until now a campaign that
-- under-delivered simply kept the money, and cancel_promotion was worse --
-- it flipped the status and kept the entire remaining budget.
--
-- Settling does three things in one transaction: refund the unspent
-- remainder, book the delivered portion as platform revenue, and stamp
-- settled_at so it can never happen twice.
--
-- The refund lands in the in-app wallet rather than going back to the card.
-- That matches how admin_resolve_dispute returns escrow, keeps the money
-- inside a system that can account for it, and does not depend on Razorpay --
-- which cannot presently collect, let alone refund.
--
-- NOTE: the status written here is 'expired', not 'completed'. This table's
-- vocabulary is pending | active | expired | cancelled, and the first cut of
-- this migration invented a fifth value that tripped the check constraint on
-- every settlement. See 047, which is folded into the definition below.

alter table public.task_promotions
  add column if not exists settled_at timestamptz;

-- Delivered ad spend is revenue and belongs in the company ledger next to
-- commission and poster fees.
alter table public.platform_ledger drop constraint if exists platform_ledger_kind_check;
alter table public.platform_ledger add constraint platform_ledger_kind_check
  check (kind in ('worker_commission', 'poster_fee', 'ad_revenue', 'adjustment'));

create or replace function private.settle_campaign(p_promotion_id uuid)
returns bigint
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_promo    public.task_promotions;
  v_spent    bigint;
  v_refund   bigint;
  v_balance  bigint;
  v_clearing bigint;
begin
  select * into v_promo from public.task_promotions
   where id = p_promotion_id for update;
  if not found then return 0; end if;

  -- Settled once, ever.
  if v_promo.settled_at is not null then return 0; end if;

  -- Nothing was collected for a campaign that never activated.
  if v_promo.payment_id is null then
    update public.task_promotions
       set settled_at = now(), updated_at = now()
     where id = v_promo.id;
    return 0;
  end if;

  select coalesce(sum(cost_minor), 0) into v_spent
    from public.ad_events where promotion_id = v_promo.id;

  -- Spend can never exceed what was paid for; clamp rather than trust it.
  v_spent  := least(v_spent, v_promo.amount_minor);
  v_refund := greatest(v_promo.amount_minor - v_spent, 0);

  if v_refund > 0 then
    select balance_minor, clearing_minor into v_balance, v_clearing
      from public.wallets where user_id = v_promo.user_id for update;
    if found then
      update public.wallets
         set balance_minor = balance_minor + v_refund, updated_at = now()
       where user_id = v_promo.user_id;

      insert into public.wallet_adjustments
        (user_id, delta_minor, balance_before, clearing_before, reason)
      values (v_promo.user_id, v_refund, v_balance, v_clearing,
              'unspent promotion budget returned');
    end if;
  end if;

  -- Only the delivered part was ever earned.
  if v_spent > 0 then
    insert into public.platform_ledger (task_id, kind, amount_minor, note)
    values (v_promo.task_id, 'ad_revenue', v_spent, 'delivered promotion spend');
  end if;

  update public.task_promotions
     set status = case when status = 'cancelled' then 'cancelled' else 'expired' end,
         settled_at = now(),
         updated_at = now()
   where id = v_promo.id;

  return v_refund;
end;
$fn$;

revoke all on function private.settle_campaign(uuid) from public, anon, authenticated;

-- Campaigns whose window has closed. Safe to call repeatedly: settle_campaign
-- is a no-op on anything already settled.
create or replace function public.settle_finished_campaigns()
returns integer
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_id uuid; v_n integer := 0;
begin
  for v_id in
    select id from public.task_promotions
     where settled_at is null
       and status in ('active', 'cancelled')
       and (ends_at is null or ends_at <= now())
     order by ends_at
  loop
    perform private.settle_campaign(v_id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$fn$;

revoke all on function public.settle_finished_campaigns() from public, anon;
grant execute on function public.settle_finished_campaigns() to authenticated;

-- Cancelling now returns the remainder instead of keeping it.
create or replace function public.cancel_promotion(p_promotion_id uuid)
returns public.task_promotions
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_me uuid := auth.uid(); v_row public.task_promotions;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_row from public.task_promotions where id = p_promotion_id for update;
  if not found then raise exception 'That campaign no longer exists'; end if;
  if v_row.user_id <> v_me then raise exception 'That is not your campaign'; end if;
  if v_row.status not in ('pending', 'active') then
    raise exception 'That campaign has already finished';
  end if;

  update public.task_promotions
     set status = 'cancelled',
         ends_at = least(coalesce(ends_at, now()), now()),
         updated_at = now()
   where id = v_row.id;

  -- Stopping early is exactly the case where a refund is owed, so settle now
  -- rather than leaving it for the sweep.
  perform private.settle_campaign(v_row.id);

  select * into v_row from public.task_promotions where id = p_promotion_id;
  return v_row;
end;
$fn$;

revoke all on function public.cancel_promotion(uuid) from public, anon;
grant execute on function public.cancel_promotion(uuid) to authenticated;

-- Campaigns end at arbitrary times, so sweep hourly rather than nightly: a
-- refund that waits until 2am is a refund the advertiser notices is late.
select cron.schedule('settle-finished-campaigns', '7 * * * *',
                     'select public.settle_finished_campaigns()');
