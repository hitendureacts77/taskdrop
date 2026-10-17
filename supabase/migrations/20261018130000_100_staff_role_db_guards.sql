-- The database itself enforces the staff roles on money WRITES.
--
-- Until now admin_mark_payout, admin_resolve_dispute and admin_set_payout_method only
-- asked "is this an admin?" (and, since 099, "not Sales"). The admin panel stopped
-- Support and Viewer, but a Support or Viewer login with a valid session could call
-- them straight through the API. This closes that.
--
-- Each function is replaced with exactly the same signature and body; one guard line,
-- private.assert_money_staff() (098), is added right after the Sales guard. That helper
-- allows only a full admin or Finance, and also asks for the authenticator code (aal2)
-- while settings.admin_require_mfa is on. Sales keeps getting its own, clearer message
-- from the line above it.
--
-- Additive: nothing is dropped or renamed, and read functions are untouched. The
-- helper needs a signed-in person (auth.uid()), so a bare service-role call is now
-- refused too; nothing in the admin panel, Edge Functions or jobs calls these three
-- that way (the panel uses the signed-in staff member's own session).
--
-- Audited with: public functions executable by authenticated that write money and whose
-- source lacks private.staff_can / assert_money_staff. Only these three remained.
-- record_escrow_refund is service-role only; escrow_refund_due is a read the poster uses.

create or replace function public.admin_mark_payout(p_payout_id uuid, p_status text, p_note text default null::text)
 returns public.payouts
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare v_row public.payouts;
begin
  perform private.assert_not_money_blind();
  perform private.assert_money_staff();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('processing', 'paid', 'failed') then
    raise exception 'A payout can be moved to processing, paid or failed';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then raise exception 'That payout no longer exists'; end if;
  if v_row.status in ('paid', 'failed', 'cancelled') then
    raise exception 'That payout is already %', v_row.status;
  end if;
  if v_row.via = 'razorpayx' and v_row.last_attempt_at is not null then
    raise exception 'This withdrawal was sent to RazorpayX, so only RazorpayX can settle it. Use "Check with RazorpayX".';
  end if;

  -- A person has taken it over: RazorpayX must never send it as well.
  update public.payouts
     set via = 'manual',
         status = p_status::public.payout_status,
         failure_note = case when p_status = 'failed' then p_note else failure_note end,
         reference = case when p_status = 'paid' then coalesce(p_note, reference) else reference end,
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if p_status = 'failed' then
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify(v_row.user_id, 'payout_failed', 'Withdrawal could not be sent',
      coalesce(p_note, 'It could not be sent') || '. The money is back in your earnings.', null);
  elsif p_status = 'paid' then
    perform private.notify(v_row.user_id, 'payout_paid', 'Money sent to your account',
      'Your withdrawal of ' || to_char(v_row.amount_minor / 100.0, 'FM999999990.00') || ' rupees has been sent.', null);
  end if;

  return v_row;
end;
$function$;

create or replace function public.admin_resolve_dispute(p_task_id uuid, p_outcome text, p_note text default null::text)
 returns public.tasks
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
  perform private.assert_not_money_blind();
  perform private.assert_money_staff();
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

create or replace function public.admin_set_payout_method(p_method text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
begin
  perform private.assert_not_money_blind();
  perform private.assert_money_staff();
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_method not in ('manual', 'razorpayx') then
    raise exception 'The payout method is manual or razorpayx';
  end if;

  insert into public.settings (key, value) values ('payout_method', to_jsonb(p_method))
  on conflict (key) do update set value = excluded.value;

  if p_method = 'razorpayx' then
    update public.payouts
       set via = 'razorpayx', updated_at = now()
     where status = 'requested' and via = 'manual' and last_attempt_at is null;
  end if;

  return p_method;
end;
$function$;
