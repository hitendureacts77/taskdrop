-- 168: a worker walking off a card-paid job gives the card money back to the poster's wallet.
--
-- B54 (High) 066_razorpayx_hardening (section J) gave private.refund_wallet_on_cancel a branch
--     that, when a worker walks off a job paid by card, moves what is left of that payment to
--     the poster's wallet and marks the job unpaid (private.move_card_payment_to_wallet).
--     066_single_wallet_pool rewrote the trigger an hour later from an older copy without that
--     branch, and 079 and 128 kept the loss. The job went back to OPEN still marked paid: a
--     cheaper next hire paid the smaller amount out and the rest of the card money was never
--     returned. The branch is restored on top of the 128 definition.
-- B56 (Medium) The hosted project never got 066 section J: payments has no wallet_credited_minor /
--     wallet_credited_at (move_card_payment_to_wallet reads them), fund_task_from_payment is the
--     older version, and payments_unapplied still counts a payment moved to the wallet. All three
--     are put back as 066 wrote them. 148 did not change fund_task_from_payment.
--
-- Also: move_card_payment_to_wallet (latest 128) credited wallets.credits_minor, a column unused
-- since 066_single_wallet_pool (always 0, never spendable). It now credits balance_minor, the one
-- wallet balance (docs/WALLET_LEDGER_DESIGN.md, F2).
--
-- Only adds. Every function keeps its signature, grants and refusals.

-- ---- 1. the payments columns from 066 section J -------------------------------------------
alter table public.payments
  add column if not exists wallet_credited_minor bigint,
  add column if not exists wallet_credited_at    timestamptz;

comment on column public.payments.wallet_credited_at is
  'An older per-job card payment whose worker walked off: its money was moved to the poster''s wallet and the job unfunded.';

-- ---- 2. moving a walked-off card payment to the wallet -----------------------------------
-- From 128, with balance_minor in place of the unused credits_minor.
create or replace function private.move_card_payment_to_wallet(p_task_id uuid)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task   public.tasks;
  v_pay    public.payments;
  v_amount bigint := 0;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found
     or v_task.status <> 'OPEN'
     or v_task.funded_at is null
     or v_task.funding_payment_id is null
     or v_task.funded_via is not distinct from 'wallet' then
    return 0;
  end if;

  select * into v_pay from public.payments where id = v_task.funding_payment_id for update;
  -- A card refund already under way for this payment is left to finish.
  if found and v_pay.wallet_credited_at is null and v_pay.refund_claimed_at is null then
    v_amount := greatest(coalesce(v_pay.amount_minor, 0) - coalesce(v_pay.refunded_minor, 0), 0);
    if v_amount > 0 then
      insert into public.wallets (user_id) values (v_task.poster_id) on conflict (user_id) do nothing;
      update public.wallets set balance_minor = balance_minor + v_amount, updated_at = now()
       where user_id = v_task.poster_id;
      update public.payments set wallet_credited_minor = v_amount, wallet_credited_at = now(), updated_at = now()
       where id = v_pay.id;
      perform private.notify(v_task.poster_id, 'wallet_refund',
        private.rupees(v_amount) || ' is back in your wallet',
        'The worker left ' || private.label(v_task.title) || '. Use the money for the next worker you hire.',
        v_task.id);
    end if;
  end if;

  update public.tasks
     set funded_at = null, funded_via = null, funded_minor = null, funded_credits_minor = 0,
         funding_payment_id = null, wallet_refunded_at = null
   where id = v_task.id;
  return v_amount;
end;
$fn$;
revoke all on function private.move_card_payment_to_wallet(uuid) from public, anon, authenticated;

-- ---- 3. the refund trigger, with the card walk-off branch back --------------------------
-- From 128; the first branch is 066_razorpayx_hardening's.
create or replace function private.refund_wallet_on_cancel()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task   public.tasks;
  v_refund bigint;
begin
  select * into v_task from public.tasks where id = new.task_id for update;
  if not found then
    return new;
  end if;

  -- Paid by card (funded_via is 'payment', or empty on jobs paid before 066), and open
  -- again after a walk-off: what is left of the payment goes to the poster's wallet and
  -- the next hire is paid for afresh.
  if v_task.funding_payment_id is not null
     and v_task.funded_via is distinct from 'wallet'
     and v_task.status = 'OPEN'
     and v_task.funded_at is not null then
    perform private.move_card_payment_to_wallet(v_task.id);
    return new;
  end if;

  if v_task.funded_via is distinct from 'wallet'
     or v_task.funded_at is null
     or v_task.wallet_refunded_at is not null
     or coalesce(v_task.funded_minor, 0) <= 0 then
    return new;
  end if;

  -- What the worker was paid out of this escrow as a fine stays paid.
  v_refund := greatest(v_task.funded_minor - coalesce(new.penalty_or_refund_minor, 0), 0);

  update public.wallets
     set balance_minor = balance_minor + v_refund, updated_at = now()
   where user_id = v_task.poster_id;

  if v_task.status = 'OPEN' then
    update public.tasks
       set funded_at = null, funded_via = null, funded_minor = null,
           funded_credits_minor = 0, wallet_refunded_at = null
     where id = v_task.id;
  else
    update public.tasks set wallet_refunded_at = now() where id = v_task.id;
  end if;

  perform private.notify(v_task.poster_id, 'wallet_refund',
    private.rupees(v_refund) || ' is back in your wallet',
    private.label(v_task.title) || ' was cancelled.'
      || case when coalesce(new.penalty_or_refund_minor, 0) > 0
              then ' ' || private.rupees(new.penalty_or_refund_minor)
                   || ' went to the worker for the time already spent.'
              else '' end,
    v_task.id);
  return new;
end;
$$;
revoke all on function private.refund_wallet_on_cancel() from public, anon, authenticated;

-- ---- 4. a card payment for a job (066 section J) ---------------------------------------
-- Marks the job as paid by card, pays only for a job that is hired and waiting to start, and
-- never for a payment already moved to the wallet.
create or replace function public.fund_task_from_payment(p_payment_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_payment public.payments;
  v_task    public.tasks;
  v_escrow  bigint;
  -- nullif: an empty claims setting (a SQL prompt after a request) is "no claims", not a JSON error.
  v_role    text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json->>'role', '');
begin
  -- Positive identification: the service role, or the owner at a SQL prompt.
  -- session_user is not rewritten by SECURITY DEFINER; current_user is.
  if not (v_role = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'not authorised';
  end if;
  select * into v_payment from public.payments where id = p_payment_id;
  if not found then
    raise exception 'That payment does not exist';
  end if;
  if v_payment.status <> 'paid' or v_payment.purpose <> 'escrow' then
    return null;
  end if;
  if v_payment.task_id is null then
    return null;
  end if;
  select * into v_task from public.tasks where id = v_payment.task_id for update;
  if not found then
    return null;
  end if;
  if v_task.poster_id <> v_payment.user_id then
    raise exception 'That payment was not made by the poster of this task';
  end if;
  if v_task.funded_at is not null then
    return v_task;
  end if;
  if v_task.status <> 'LOCKED' then
    return v_task;
  end if;
  if v_payment.wallet_credited_at is not null then
    return v_task;
  end if;
  select a.escrow_minor into v_escrow
    from public.assignments a
   where a.task_id = v_task.id
   order by a.created_at desc
   limit 1;
  -- Under the agreed escrow, or no quote locked yet: refuses to fund, and the payment
  -- shows up in payments_unapplied instead of vanishing quietly.
  if v_escrow is null or v_payment.amount_minor < v_escrow then
    return v_task;
  end if;
  update public.tasks
     set funded_at = now(),
         funded_via = 'payment',
         funding_payment_id = p_payment_id,
         updated_at = now()
   where id = v_task.id
  returning * into v_task;
  return v_task;
end;
$fn$;
revoke all on function public.fund_task_from_payment(uuid) from public, anon, authenticated;
grant execute on function public.fund_task_from_payment(uuid) to service_role;

-- ---- 5. a payment moved to the wallet is applied, not waiting to be applied (066 J) ------
create or replace view public.payments_unapplied with (security_invoker = true) as
 select p.id as payment_id,
    p.user_id as poster_id,
    p.task_id,
    t.title,
    t.status as task_status,
    p.amount_minor as paid_minor,
    a.escrow_minor as expected_minor,
    (a.escrow_minor - p.amount_minor) as short_by_minor,
    p.provider_payment_id,
    p.paid_at
   from ((public.payments p
     join public.tasks t on ((t.id = p.task_id)))
     left join lateral ( select aa.escrow_minor
           from public.assignments aa
          where (aa.task_id = t.id)
          order by aa.created_at desc
         limit 1) a on (true))
  where ((p.purpose = 'escrow'::payment_purpose) and (p.status = 'paid'::payment_status) and (t.funded_at is null)
         and p.wallet_credited_at is null and p.refunded_minor < p.amount_minor);

revoke all on public.payments_unapplied from anon, authenticated;
grant select on public.payments_unapplied to service_role;

-- ---- 6. old rows (066 section J, run once; both safe to run again) ----------------------
-- Jobs paid by card since 063 were left without funded_via.
update public.tasks
   set funded_via = 'payment'
 where funded_at is not null and funded_via is null and funding_payment_id is not null;

-- Jobs paid by card that a worker already walked off: still marked as paid while open.
-- Move what is left of the payment to the poster's wallet now, as a walk-off does from here on.
do $$
declare v_id uuid;
begin
  for v_id in
    select t.id from public.tasks t
     where t.status = 'OPEN' and t.funded_at is not null
       and t.funding_payment_id is not null and t.funded_via is distinct from 'wallet'
  loop
    perform private.move_card_payment_to_wallet(v_id);
  end loop;
end $$;
