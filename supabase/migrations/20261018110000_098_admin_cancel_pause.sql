-- 098 — admin: cancel a task with a refund, and stop a promotion.
--
-- Phase 2 of the admin control-center plan. Both are money actions, so they
-- need a full admin or finance, and the authenticator code (aal2) while
-- settings.admin_require_mfa is on. Both write to the audit log.
--
-- Cancelling here is for work that has NOT started (OPEN or LOCKED). Once the
-- worker has started, the money questions are a fine, a part-payment or a
-- dispute, and those already have their own paths (cancel_task by the poster,
-- admin_resolve_dispute). A task paid through Razorpay rather than the wallet
-- is cancelled here too, but its money goes back through the Refunds screen.
--
-- The wallet refund hangs off the insert into cancellations_log
-- (private.refund_wallet_on_cancel), exactly as when the poster cancels.

-- One place for "money staff, with the authenticator code".
create or replace function private.assert_money_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  uuid := auth.uid();
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_mfa    boolean;
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Admins only' using errcode = '42501';
  end if;
  if not private.staff_can(v_actor, 'money') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin or finance.', private.staff_role(v_actor)
      using errcode = '42501';
  end if;
  select s.value = 'true'::jsonb into v_mfa from public.settings s where s.key = 'admin_require_mfa';
  if coalesce(v_mfa, true) and coalesce(v_claims ->> 'aal', '') <> 'aal2' then
    raise exception 'Verify your authenticator code first (Security page in the admin panel)'
      using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function private.assert_money_staff() from public, anon, authenticated;

-- ---------------------------------------------------------- cancel with refund --
create or replace function public.admin_cancel_task_with_refund(p_task_id uuid, p_reason text)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  uuid := private.assert_money_staff();
  v_task   public.tasks;
  v_assign public.assignments;
  v_phase  text;
  v_promo  uuid;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'Say why you are cancelling this task';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'That task no longer exists';
  end if;
  if v_task.status in ('COMPLETED', 'AUTO_COMPLETED', 'CANCELLED') then
    raise exception 'This task is already closed';
  end if;
  if v_task.status not in ('OPEN', 'LOCKED') then
    raise exception 'Work on this task has already started. Resolve it as a dispute, or let the poster cancel (a fine may apply).';
  end if;

  v_phase := v_task.status::text;

  select * into v_assign from public.assignments
   where task_id = p_task_id and status in ('assigned', 'started')
   order by created_at desc limit 1;
  if v_assign.id is not null then
    update public.assignments set status = 'refunded' where id = v_assign.id;
    update public.bids set is_locked = false where id = v_assign.bid_id;
  end if;

  -- Any campaign on the task stops with it; settling returns what was not used.
  for v_promo in
    select id from public.task_promotions where task_id = p_task_id and status in ('pending', 'active')
  loop
    update public.task_promotions
       set status = 'cancelled', ends_at = least(coalesce(ends_at, now()), now()), updated_at = now()
     where id = v_promo;
    perform private.settle_campaign(v_promo);
  end loop;

  update public.tasks
     set status = 'CANCELLED', completed_at = now()
   where id = p_task_id
  returning * into v_task;

  -- Fires the wallet refund for wallet-funded tasks. No fine: the worker had
  -- not started and this was TaskDrop's decision, not the poster's.
  insert into public.cancellations_log
    (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
  values (p_task_id, 'poster', 'normal', v_phase, v_task.locked_minor, 0);

  perform private.notify(v_task.poster_id, 'admin_cancelled',
    'Your task was cancelled by TaskDrop',
    '"' || left(v_task.title, 60) || '" was cancelled. Reason: ' || left(v_reason, 200), v_task.id);
  if v_assign.worker_id is not null then
    perform private.notify(v_assign.worker_id, 'admin_cancelled',
      'A task you were assigned to was cancelled',
      '"' || left(v_task.title, 60) || '" was cancelled by TaskDrop. You can offer on other jobs.', v_task.id);
  end if;

  perform public.admin_log_event(
    'cancel_task_with_refund', p_task_id::text,
    left('phase ' || v_phase || '; funded via ' || coalesce(v_task.funded_via, 'nothing')
         || '; ' || v_reason, 500));
  return v_task;
end;
$$;
revoke all on function public.admin_cancel_task_with_refund(uuid, text) from public, anon;
grant execute on function public.admin_cancel_task_with_refund(uuid, text) to authenticated;

-- --------------------------------------------------------------- stop a promotion --
create or replace function public.admin_pause_promotion(p_promotion_id uuid, p_reason text)
returns public.task_promotions
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor  uuid := private.assert_money_staff();
  v_row    public.task_promotions;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'Say why you are stopping this promotion';
  end if;

  select * into v_row from public.task_promotions where id = p_promotion_id for update;
  if not found then
    raise exception 'That promotion no longer exists';
  end if;
  if v_row.status not in ('pending', 'active') then
    raise exception 'That promotion has already finished';
  end if;

  update public.task_promotions
     set status = 'cancelled', ends_at = least(coalesce(ends_at, now()), now()), updated_at = now()
   where id = v_row.id;

  -- Same as the advertiser stopping it: what was not delivered goes back to
  -- their wallet, what was delivered is booked as revenue.
  perform private.settle_campaign(v_row.id);

  perform private.notify(v_row.user_id, 'admin_promo_stopped',
    'Your promotion was stopped',
    'TaskDrop stopped your promotion. Whatever it had not used is back in your wallet. Reason: ' || left(v_reason, 200),
    v_row.task_id);

  perform public.admin_log_event('pause_promotion', v_row.id::text, left('task ' || v_row.task_id || '; ' || v_reason, 500));

  select * into v_row from public.task_promotions where id = p_promotion_id;
  return v_row;
end;
$$;
revoke all on function public.admin_pause_promotion(uuid, text) from public, anon;
grant execute on function public.admin_pause_promotion(uuid, text) to authenticated;
