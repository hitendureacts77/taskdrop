-- 068 -- two admin fixes, taken from the (never applied) 066 hardening migration
-- and nothing else:
--   I. admin_resolve_dispute failed on every call (it wrote 'cancelled' into
--      assignment_status and a uuid into cancelled_by). Worker wins: their share
--      is paid like any finished job. Poster wins: everything they paid comes back,
--      the same way as a cancellation.
--   L. admin_money_position: the figures the admin Payouts page shows.

set check_function_bodies = off;

-- ---------------------------------------------------------------- I. disputes --

create table if not exists public.dispute_decisions (
  id                    uuid primary key default gen_random_uuid(),
  task_id               uuid not null references public.tasks (id) on delete cascade,
  decided_by            uuid references auth.users (id) on delete set null,
  outcome               text not null check (outcome in ('worker', 'poster')),
  note                  text,
  worker_paid_minor     bigint not null default 0,
  poster_refunded_minor bigint not null default 0,
  created_at            timestamptz not null default now()
);

alter table public.dispute_decisions enable row level security;
drop policy if exists dispute_decisions_admin_read on public.dispute_decisions;
create policy dispute_decisions_admin_read on public.dispute_decisions
  for select to authenticated using (private.is_admin());
revoke all on public.dispute_decisions from anon, authenticated;
grant select on public.dispute_decisions to authenticated;

create or replace function public.admin_resolve_dispute(p_task_id uuid, p_outcome text, p_note text default null::text)
returns tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_task       public.tasks;
  v_assign     public.assignments;
  v_net        bigint := 0;
  v_back       bigint := 0;
  v_clear_days numeric := private.setting_num('clearing_period_days', 0);
begin
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

    -- Paid like a finished job; TaskDrop's share is booked by the completion
    -- trigger. With no clearing period the worker's share goes straight to
    -- their earnings here (not through the sweep, which has to guess the
    -- worker); otherwise it waits in clearing for this same worker.
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
    -- Everything the poster paid comes back, fee included, the same way as a
    -- cancellation: the cancellations_log row below fires the wallet refund
    -- for jobs paid from the wallet; a job paid by card shows up in Refunds.
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

revoke all on function public.admin_resolve_dispute(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_dispute(uuid, text, text) to authenticated;

-- ------------------------------------------- L. the Payouts page's figures --

/**
 * What TaskDrop holds for other people, in paise. The Payouts page sets this
 * against the RazorpayX balance: whatever is left over is TaskDrop's own.
 *
 * A withdrawal RazorpayX has already taken out of the balance (processing,
 * initiated) is not counted again; one it is holding back (queued for low
 * balance, pending, scheduled), or one it has not answered for yet, is.
 */
drop function if exists public.admin_money_position();
create or replace function public.admin_money_position()
returns table (
  credits_minor bigint,
  earnings_minor bigint,
  clearing_minor bigint,
  locked_minor bigint,
  in_flight_minor bigint,
  refunds_owed_minor bigint,
  unapplied_minor bigint,
  held_for_people_minor bigint,
  ready_to_withdraw_minor bigint,
  taskdrop_earned_minor bigint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
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
$fn$;

revoke all on function public.admin_money_position() from public, anon;
grant execute on function public.admin_money_position() to authenticated;
