-- 079 — Pay the post-start cancellation fine again; restore the 7-day clearing.
--
-- Audit findings F-19 and F-26 (docs/audit/SECURITY_FINDINGS.md).
--
-- 1. The fine. Migration 014 designed it: when a poster cancels after the worker
--    has started, the worker is paid a fine (settings.post_start_cancel_penalty_pct,
--    5%) out of the locked amount for the time already put in, and the rest goes
--    back to the poster. 033 still subtracts that logged fine from card refunds.
--    Wallet funding (063) rewrote cancel_task and the fine was lost: it logged 0
--    and refunded the poster in full. 014 also credited the fine to the worker's
--    clearing balance, which the clearing sweep (completed tasks only) never
--    releases, so even then it would have been stuck. Now:
--      worker  + fine, straight to the withdrawable balance (no task to clear)
--      poster  + (escrow - fine) back to the wallet
--    so escrow is conserved exactly: refund + fine = what the poster paid.
--
-- 2. Clearing. settings.clearing_period_days was 0, while packages/rules, the
--    README and the hardening plan all say 7, and 0 removes the window in which a
--    dispute can still claw earnings back before they are withdrawn. Back to 7;
--    it is one edit in Admin -> Settings if the owner wants otherwise, and the
--    change is in the audit log.

-- ------------------------------------------------------------- cancel_task --
create or replace function public.cancel_task(p_task_id uuid, p_reason text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me        uuid := auth.uid();
  v_task      public.tasks;
  v_assign    public.assignments;
  v_is_poster boolean;
  v_phase     text;
  v_fine      bigint := 0;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;

  if v_task.status in ('COMPLETED', 'AUTO_COMPLETED', 'CANCELLED') then
    raise exception 'This task is already closed';
  end if;
  if v_task.status in ('WORK_DONE', 'REVISION_REQUESTED', 'DISPUTED') then
    raise exception 'The work is already submitted — open a dispute instead';
  end if;

  select * into v_assign
  from public.assignments
  where task_id = p_task_id and status in ('assigned', 'started')
  order by created_at desc
  limit 1;

  v_is_poster := (v_me = v_task.poster_id);
  if not v_is_poster and (v_assign.worker_id is null or v_assign.worker_id <> v_me) then
    raise exception 'You were not part of this task';
  end if;

  v_phase := v_task.status::text;

  -- ---- worker walks away: hand the task back to the market --------------
  if not v_is_poster then
    update public.assignments set status = 'refunded' where id = v_assign.id;
    update public.bids set is_locked = false where id = v_assign.bid_id;

    update public.tasks
       set status = 'OPEN',
           locked_bid_id = null,
           locked_minor = null,
           started_at = null
     where id = p_task_id
    returning * into v_task;

    insert into public.cancellations_log
      (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
    values (p_task_id, 'worker', 'normal', v_phase, v_assign.escrow_minor, 0);

    return v_task;
  end if;

  -- ---- poster cancels ----------------------------------------------------
  if v_assign.id is not null then
    -- Only once the worker has actually started does the fine apply, and it
    -- never exceeds what was paid in.
    if v_task.status in ('TASK_STARTED', 'OVERDUE') and v_task.funded_at is not null then
      v_fine := round(coalesce(v_task.locked_minor, 0)
                      * private.setting_num('post_start_cancel_penalty_pct', 0.05))::bigint;
      v_fine := least(greatest(v_fine, 0), coalesce(v_task.funded_minor, v_assign.escrow_minor, 0));
      if v_fine > 0 then
        insert into public.wallets (user_id) values (v_assign.worker_id) on conflict (user_id) do nothing;
        update public.wallets
           set balance_minor = balance_minor + v_fine, updated_at = now()
         where user_id = v_assign.worker_id;
        perform private.notify(
          v_assign.worker_id, 'cancel_fine',
          'The poster cancelled after you started',
          'You were paid ' || to_char(v_fine / 100.0, 'FM999999990.00') || ' rupees for the time you put into "'
            || left(v_task.title, 60) || '". It is in your wallet now.',
          v_task.id);
      end if;
    end if;

    update public.assignments set status = 'refunded' where id = v_assign.id;
    update public.bids set is_locked = false where id = v_assign.bid_id;
  end if;

  update public.tasks
     set status = 'CANCELLED',
         completed_at = now()
   where id = p_task_id
  returning * into v_task;

  -- The wallet refund trigger reads penalty_or_refund_minor and returns the
  -- escrow less the fine.
  insert into public.cancellations_log
    (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
  values (p_task_id, 'poster', 'normal', v_phase, v_task.locked_minor, v_fine);

  return v_task;
end;
$$;

-- ------------------------------------------------- wallet refund less the fine
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
  if not found
     or v_task.funded_via is distinct from 'wallet'
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
    'Money back in your wallet',
    'The ' || to_char(v_refund / 100.0, 'FM999999990.00') || ' rupees locked for "' || left(v_task.title, 60)
      || '" is back in your wallet.'
      || case when coalesce(new.penalty_or_refund_minor, 0) > 0
              then ' ' || to_char(new.penalty_or_refund_minor / 100.0, 'FM999999990.00')
                   || ' rupees went to the worker for the time they had already put in.'
              else '' end,
    v_task.id);
  return new;
end;
$$;

-- ------------------------------------------------------------- clearing ---
update public.settings
   set value = to_jsonb(7), updated_at = now()
 where key = 'clearing_period_days' and value = to_jsonb(0);
