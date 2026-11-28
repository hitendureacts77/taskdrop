-- 255: decide a dispute as a SPLIT (admin v2 WP2, owner decision 5 "dispute split is on").
--
-- Today admin_resolve_dispute takes only 'worker' or 'poster'. This adds a third decision for a job
-- paid under Plan B (pay per task, the payment company holds the money):
--
--   the admin picks the part of the agreed price the finished work is worth (P, 0 < P < price);
--   the worker gets P less the commission on P   -> release_minor  = round(P * worker_share / offer)
--   the poster gets everything else back, the service fee included -> refund_minor = charged - P
--   TaskDrop keeps only the commission on P       -> charged - release - refund
--
-- The money moves are the ones Plan B already makes for a late-cancel fine ('split_asked'): the refund
-- first (POST /payments/:id/refund after reversing the worker's unused part of the transfer), then
-- the release of what is left on the transfer (PATCH /transfers/:id on_hold:false). Two changes make
-- that path carry a dispute split:
--   1. plan_b_claim_move also returns release_minor, so the money function reverses exactly
--      worker_share - release_minor (a fine split keeps release_minor = charged - refund, as before);
--   2. plan_b_record_move books a dispute split's release as 'released' + 'commission' and tells the
--      worker, instead of 'fine_paid'. A dispute split is told apart by its release key 'dispute:<id>'.
--
-- The old wallet path (money_flow = 'wallet') is not offered a split: it never held the money with the
-- payment company, so there is nothing to split there. Forward-only; only adds or widens.

-- ---- 1. a decision can be a split -----------------------------------------------------------------
alter table public.dispute_decisions drop constraint if exists dispute_decisions_outcome_check;
alter table public.dispute_decisions
  add constraint dispute_decisions_outcome_check check (outcome in ('worker', 'poster', 'split'));

-- ---- 2. the split decision ------------------------------------------------------------------------
create or replace function public.admin_resolve_dispute_split(
  p_task_id uuid,
  p_worker_part_minor bigint,
  p_note text
)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_task    public.tasks;
  v_assign  public.assignments;
  v_hold    public.task_holds;
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_part    bigint := coalesce(p_worker_part_minor, 0);
  v_release bigint;
  v_refund  bigint;
  v_title   text;
begin
  perform private.assert_not_money_blind();
  perform private.assert_money_staff();
  if not private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if v_note is null then
    raise exception 'Write the reason for the split. Both people see it.';
  end if;
  if char_length(v_note) > 500 then
    raise exception 'Keep the reason under 500 characters.';
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
  if v_assign.id is null then
    raise exception 'No worker on this task to pay';
  end if;

  select * into v_hold from public.task_holds
   where task_id = p_task_id and status = 'held'
   order by created_at desc limit 1
   for update;
  if not found then
    raise exception 'A split works only for a job paid with pay per task, while its money is on hold';
  end if;

  if v_part <= 0 or v_part >= v_hold.offer_minor then
    raise exception 'The worker''s part must be more than ₹0 and less than the agreed price (%). For all or nothing, pay the worker or refund the poster.',
      private.rupees(v_hold.offer_minor);
  end if;

  -- The worker's cut of P at the same rate their whole share was set at (the commission stays as hired).
  v_release := round(v_part::numeric * v_hold.worker_share_minor / v_hold.offer_minor)::bigint;
  v_release := least(greatest(v_release, 0), v_hold.worker_share_minor, v_part);
  v_refund  := v_hold.charged_minor - v_part;
  if v_refund < 0 or v_release + v_refund > v_hold.charged_minor then
    raise exception 'Those amounts do not add up to what the poster paid';
  end if;

  update public.task_holds
     set status = 'split_asked',
         release_minor = v_release,
         refund_minor = v_refund,
         release_key = 'dispute:' || id,
         refund_key = 'refund:' || id,
         asked_at = now(), updated_at = now()
   where id = v_hold.id;
  perform private.emit_event('money.move', jsonb_build_object('hold_id', v_hold.id, 'task_id', p_task_id, 'move', 'split'));

  update public.assignments set status = 'released' where id = v_assign.id;
  update public.tasks
     set status = 'COMPLETED', completed_at = now(), clear_at = now(), cleared_at = now(), updated_at = now()
   where id = p_task_id;

  -- The audit row is written by the audit_dispute_decisions trigger (private.audit_change).
  insert into public.dispute_decisions (task_id, decided_by, outcome, note, worker_paid_minor, poster_refunded_minor)
  values (p_task_id, auth.uid(), 'split', v_note, v_release, v_refund);

  v_title := private.label(v_task.title);
  perform private.notify(v_assign.worker_id, 'dispute', 'The problem was decided: split',
    v_title || ': you get ' || private.rupees(v_release) || ' for the part that was done. Reason: ' || left(v_note, 200), p_task_id);
  perform private.notify(v_task.poster_id, 'dispute', 'The problem was decided: split',
    v_title || ': ' || private.rupees(v_refund) || ' comes back to the card or UPI you paid with. Reason: ' || left(v_note, 200), p_task_id);

  select * into v_task from public.tasks where id = p_task_id;
  return v_task;
end;
$$;

revoke all on function public.admin_resolve_dispute_split(uuid, bigint, text) from public, anon;
grant execute on function public.admin_resolve_dispute_split(uuid, bigint, text) to authenticated;

comment on function public.admin_resolve_dispute_split(uuid, bigint, text) is
  'Admin v2 (255): decide a Plan B dispute as a split. p_worker_part_minor = part of the agreed price the work is worth.';

-- ---- 3. the claim tells the money function what the worker keeps -------------------------------
create or replace function public.plan_b_claim_move(p_hold_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_hold public.task_holds;
  v_part text;
  v_acc  public.payout_accounts;
begin
  perform private.assert_service();
  select * into v_hold from public.task_holds where id = p_hold_id for update;
  if not found or v_hold.status not in ('release_asked', 'refund_asked', 'split_asked') then return null; end if;
  if v_hold.moving_until is not null and v_hold.moving_until > now() then return null; end if;

  -- A split refunds first (money back to the poster never waits on the stop), then pays the fine.
  v_part := case
    when v_hold.status = 'release_asked' then 'release'
    when v_hold.status = 'refund_asked' then 'refund'
    when v_hold.refund_ref is null then 'refund'
    else 'release' end;
  if v_part = 'release' and private.money_paused() then return null; end if;

  select * into v_acc from public.payout_accounts where user_id = v_hold.worker_id;
  update public.task_holds set moving_until = now() + interval '10 minutes', attempts = attempts + 1, updated_at = now()
   where id = v_hold.id;
  return jsonb_build_object(
    'hold_id', v_hold.id, 'part', v_part, 'provider', v_hold.provider, 'status', v_hold.status,
    'amount_minor', case when v_part = 'release' then v_hold.release_minor else v_hold.refund_minor end,
    'charged_minor', v_hold.charged_minor, 'worker_share_minor', v_hold.worker_share_minor,
    -- 255: what the worker keeps in the end (a dispute split keeps less than charged - refund).
    'release_minor', coalesce(v_hold.release_minor, 0),
    'key', case when v_part = 'release' then v_hold.release_key else v_hold.refund_key end,
    'provider_order_id', v_hold.provider_order_id, 'provider_payment_id', v_hold.provider_payment_id,
    'provider_transfer_id', v_hold.provider_transfer_id, 'payee_account_id', v_acc.provider_account_id);
end;
$$;

-- ---- 4. a dispute split's release is booked as the worker's pay + TaskDrop's commission -----------
create or replace function public.plan_b_record_move(p_hold_id uuid, p_part text, p_ok boolean, p_ref text, p_note text default null)
returns text
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_hold  public.task_holds;
  v_title text;
begin
  perform private.assert_service();
  if p_part not in ('release', 'refund') then raise exception 'part is release or refund'; end if;
  select * into v_hold from public.task_holds where id = p_hold_id for update;
  if not found then raise exception 'That hold does not exist'; end if;
  if v_hold.status not in ('release_asked', 'refund_asked', 'split_asked') then return v_hold.status; end if;
  select left(t.title, 60) into v_title from public.tasks t where t.id = v_hold.task_id;

  if not coalesce(p_ok, false) then
    update public.task_holds
       set failed_from = status, status = 'failed', moving_until = null,
           note = left(coalesce(p_note, 'The payment company refused'), 300), updated_at = now()
     where id = v_hold.id;
    perform private.emit_event('money.move_failed', jsonb_build_object('hold_id', v_hold.id, 'task_id', v_hold.task_id, 'part', p_part));
    return 'failed';
  end if;

  if p_part = 'release' then
    update public.task_holds set release_ref = coalesce(release_ref, p_ref), moving_until = null, updated_at = now()
     where id = v_hold.id returning * into v_hold;
    if v_hold.status = 'release_asked' then
      perform private.ledger_add(v_hold, v_hold.worker_id, 'released', v_hold.release_minor, 'released:' || v_hold.id, p_ref);
      perform private.ledger_add(v_hold, null, 'service_fee', v_hold.fee_minor, 'service_fee:' || v_hold.id, null);
      perform private.ledger_add(v_hold, null, 'commission', v_hold.charged_minor - v_hold.fee_minor - v_hold.release_minor,
                                 'commission:' || v_hold.id, null);
      perform private.notify(v_hold.worker_id, 'money_released', 'Your money is on its way',
        private.rupees(v_hold.release_minor) || ' for ' || private.label(v_title) || ' was sent to your bank or UPI.', v_hold.task_id);
    elsif coalesce(v_hold.release_key, '') like 'dispute:%' then
      -- 255: a dispute split. The worker is paid for the part done; TaskDrop keeps the commission on it
      -- (the service fee went back to the poster with the refund).
      perform private.ledger_add(v_hold, v_hold.worker_id, 'released', v_hold.release_minor, 'released:' || v_hold.id, p_ref);
      perform private.ledger_add(v_hold, null, 'commission',
                                 v_hold.charged_minor - v_hold.release_minor - coalesce(v_hold.refund_minor, 0),
                                 'commission:' || v_hold.id, null);
      perform private.notify(v_hold.worker_id, 'money_released', 'Your money is on its way',
        private.rupees(v_hold.release_minor) || ' for ' || private.label(v_title) || ' was sent to your bank or UPI.', v_hold.task_id);
    else
      perform private.ledger_add(v_hold, v_hold.worker_id, 'fine_paid', v_hold.release_minor, 'fine_paid:' || v_hold.id, p_ref);
    end if;
  else
    update public.task_holds set refund_ref = coalesce(refund_ref, p_ref), moving_until = null, updated_at = now()
     where id = v_hold.id returning * into v_hold;
    perform private.ledger_add(v_hold, v_hold.poster_id, 'refunded', v_hold.refund_minor, 'refunded:' || v_hold.id, p_ref);
    perform private.ledger_add(v_hold, v_hold.worker_id, 'hold_cancelled', v_hold.worker_share_minor, 'hold_cancelled:' || v_hold.id, null);
    perform private.notify(v_hold.poster_id, 'money_refunded', 'Your money is coming back',
      private.rupees(v_hold.refund_minor) || ' for ' || private.label(v_title) || ' is going back to the card or UPI you paid with.', v_hold.task_id);
  end if;

  -- Finished?
  if v_hold.status = 'release_asked' then
    update public.task_holds set status = 'released', settled_at = now(), updated_at = now() where id = v_hold.id;
    return 'released';
  elsif v_hold.status = 'refund_asked' then
    update public.task_holds set status = 'refunded', settled_at = now(), updated_at = now() where id = v_hold.id;
    return 'refunded';
  elsif v_hold.release_ref is not null and v_hold.refund_ref is not null then
    update public.task_holds set status = 'split', settled_at = now(), updated_at = now() where id = v_hold.id;
    return 'split';
  end if;
  return v_hold.status; -- a split with one half still to go
end;
$$;
