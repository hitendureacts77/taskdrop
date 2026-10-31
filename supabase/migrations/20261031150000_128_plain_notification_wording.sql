-- 128: say what happened, in words a customer understands.
--
-- Notifications (the bell list and the phone push are the same text) used the
-- build team's words: "escrow", "poster", "quote", "clearing", and titles that
-- told you a task name but not what to do. Each one now follows four rules:
--
--   1. The title says WHAT HAPPENED and WHO, in a few words. The first line on a
--      lock screen has to be enough on its own.
--   2. The body names the task, then gives the ONE next step (if there is one).
--   3. Only the app's own words: offer (not quote), customer and worker (not
--      poster), "held safely" (not escrow), wallet, rupee amounts as ₹.
--   4. A person is called by first name when they have a real one; otherwise
--      "The customer" / "Your worker" (never "New user", a phone number or a
--      handle). A task name is cut at 40 characters.
--
-- Only the wording changes: every function below is its current definition with
-- the notify() text swapped. Not touched on purpose: copyright notices (waiting
-- for lawyer review), staff alerts, broadcasts written by an admin, support
-- replies, "account is active again", promotion stopped and referral joined.
-- The full wording table is task 1.7 in docs/ULTIMATE_PLAN.md.

-- ---- helpers: one place for the wording rules ------------------------------

-- ₹100 or ₹50.50 (Indian grouping, no ".00" on whole rupees).
create or replace function private.rupees(p_minor bigint)
returns text
language sql
immutable
set search_path to 'pg_temp'
as $$
  select '₹' || case
    when coalesce(p_minor, 0) % 100 = 0
      then to_char(coalesce(p_minor, 0) / 100, 'FM999,99,99,990')
    else to_char(coalesce(p_minor, 0) / 100.0, 'FM999,99,99,990.00')
  end
$$;

-- A task name for a sentence: "Fix a leaking kitchen tap", cut at 40 characters.
create or replace function private.label(p_title text)
returns text
language sql
immutable
set search_path to 'pg_temp'
as $$
  select '"' || left(coalesce(nullif(btrim(p_title), ''), 'your task'), 40)
         || case when length(btrim(coalesce(p_title, ''))) > 40 then '…' else '' end || '"'
$$;

-- A person's first name, only when it looks like one; otherwise the fallback
-- ("The customer", "Your worker"). Never a handle, number, e-mail or "New user".
create or replace function private.who(p_user uuid, p_fallback text)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select s.f
       from (select split_part(btrim(p.display_name), ' ', 1) as f
               from public.profiles p
              where p.id = p_user and p.deleted_at is null) s
      where length(s.f) between 2 and 20
        and s.f !~ '[0-9@._:/]'
        and lower(s.f) not in ('new', 'deleted', 'tasker', 'guest', 'user')),
    p_fallback)
$$;

-- A withdrawal that was sent, failed, or came back from the bank. Four code paths
-- used to word this four slightly different ways.
create or replace function private.notify_payout(
  p_user uuid, p_result text, p_amount_minor bigint,
  p_reason text default null, p_reference text default null
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_reason text := nullif(rtrim(btrim(coalesce(p_reason, '')), '. '), '');
begin
  if p_result = 'sent' then
    perform private.notify(p_user, 'payout_paid',
      private.rupees(p_amount_minor) || ' withdrawal sent',
      'It is on its way to your bank or UPI account.'
        || coalesce(' Bank reference: ' || nullif(btrim(p_reference), '') || '.', ''));
  else
    perform private.notify(p_user, 'payout_failed',
      case when p_result = 'returned'
           then 'Your bank sent ' || private.rupees(p_amount_minor) || ' back'
           else private.rupees(p_amount_minor) || ' withdrawal failed' end,
      'Your money is back in your earnings. Check your bank or UPI details and try again.'
        || coalesce(' Reason: ' || left(v_reason, 100) || '.', ''));
  end if;
end;
$$;

revoke all on function private.rupees(bigint) from public;
revoke all on function private.label(text) from public;
revoke all on function private.who(uuid, text) from public;
revoke all on function private.notify_payout(uuid, text, bigint, text, text) from public;

-- ---- offers and task progress ------------------------------------------------

create or replace function private.on_bid_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = new.task_id;
  if found then
    perform private.notify(
      v_task.poster_id, 'quote',
      private.who(new.worker_id, 'A worker') || ' offered ' || private.rupees(new.price_minor),
      'To do ' || private.label(v_task.title) || '. Open it to compare offers.',
      v_task.id);
  end if;
  return new;
exception when others then
  return new;
end;
$$;

create or replace function private.on_task_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_worker uuid;
  v_task   text;
  v_cust   text;
begin
  -- Set here, not in DECLARE: an error there would not be caught by the handler
  -- below, and wording must never block a task from changing state.
  v_task := private.label(new.title);
  v_cust := private.who(new.poster_id, 'The customer');

  if new.status = 'LOCKED' and old.status is distinct from 'LOCKED' then
    select b.worker_id into v_worker from public.bids b where b.id = new.locked_bid_id;
    perform private.notify(v_worker, 'picked', v_cust || ' picked you',
      'For ' || v_task || '. You can start once they have paid.', new.id);
  end if;

  if new.funded_at is not null and old.funded_at is null then
    perform private.notify(private.task_worker(new.id), 'funded', v_cust || ' has paid. You can start',
      v_task || ': your payment is held safely until the work is approved.', new.id);
  end if;

  if new.status is distinct from old.status then
    v_worker := private.task_worker(new.id);
    case new.status
      when 'TASK_STARTED' then
        perform private.notify(new.poster_id, 'started',
          private.who(v_worker, 'Your worker') || ' started your task',
          v_task || ' is now in progress.', new.id);
      when 'WORK_DONE' then
        perform private.notify(new.poster_id, 'submitted',
          private.who(v_worker, 'Your worker') || ' sent in the work',
          'For ' || v_task || '. Approve it to pay them, or ask for changes.', new.id);
      when 'REVISION_REQUESTED' then
        perform private.notify(v_worker, 'revision', v_cust || ' asked for changes',
          'On ' || v_task || '. Open it to see what to fix, then send it again.', new.id);
      when 'COMPLETED', 'AUTO_COMPLETED' then
        if new.status = 'AUTO_COMPLETED' then
          perform private.notify(v_worker, 'released', 'Your work was approved',
            v_task || ': approved automatically. Your earnings will show in your wallet soon.', new.id);
        else
          perform private.notify(v_worker, 'released', v_cust || ' approved your work',
            v_task || ': your earnings will show in your wallet soon.', new.id);
        end if;
      when 'CANCELLED' then
        -- Whoever did not cancel it is the one who needs telling; both hear it,
        -- which is harmless for the person who pressed the button.
        perform private.notify(v_worker, 'cancelled', 'Task cancelled',
          v_task || ' was cancelled. You can offer on other tasks.', new.id);
        perform private.notify(new.poster_id, 'cancelled', 'Task cancelled',
          v_task || ' was cancelled.', new.id);
      when 'DISPUTED' then
        perform private.notify(v_worker, 'dispute', 'A problem was reported',
          'On ' || v_task || '. Our team is looking into it and will update you here.', new.id);
        perform private.notify(new.poster_id, 'dispute', 'A problem was reported',
          'On ' || v_task || '. Our team is looking into it and will update you here.', new.id);
      when 'OPEN' then
        if old.status in ('LOCKED', 'TASK_STARTED', 'OVERDUE') then
          perform private.notify(new.poster_id, 'reopened',
            private.who(v_worker, 'Your worker') || ' left your task',
            v_task || ' is open again, so new offers can come in.', new.id);
        end if;
      else
        null;
    end case;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

create or replace function private.on_message_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task  public.tasks;
  v_other uuid;
  v_text  text;
begin
  select * into v_task from public.tasks where id = new.task_id;
  if not found then
    return new;
  end if;
  v_other := case when new.sender_id = v_task.poster_id
                  then private.task_worker(v_task.id)
                  else v_task.poster_id end;
  if v_other is null then
    return new;
  end if;
  if exists (
    select 1 from public.notifications n
     where n.user_id = v_other and n.task_id = v_task.id and n.kind = 'message'
       and n.read_at is null and n.created_at > now() - interval '10 minutes'
  ) then
    return new;
  end if;
  v_text := case when new.body like '::media::%' then '📷 Photo' else left(new.body, 100) end;
  perform private.notify(v_other, 'message',
    private.who(new.sender_id, 'Someone') || ' sent you a message',
    private.label(v_task.title) || ': ' || v_text, v_task.id);
  return new;
exception when others then
  return new;
end;
$$;

create or replace function private.auto_accept_bid()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task   public.tasks;
  v_fee    numeric;
  v_escrow bigint;
  v_mode   public.payout_mode;
begin
  select * into v_task from public.tasks where id = new.task_id for update;
  if not found
     or v_task.assignment_mode <> 'auto'
     or v_task.status <> 'OPEN'
     or new.price_minor > v_task.benchmark_minor then
    return new;
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(new.price_minor * (1 + v_fee));
  v_mode := coalesce(v_task.payout_mode, 'one_time');

  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, new.id, new.worker_id, v_escrow, v_mode)
  on conflict (task_id, worker_id) do update set escrow_minor = excluded.escrow_minor, status = 'assigned';

  update public.bids set is_locked = true where id = new.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = new.id,
         locked_minor = new.price_minor,
         payout_mode = v_mode
   where id = v_task.id;

  begin
    perform private.fund_task_from_wallet(v_task.id);
    perform private.notify(v_task.poster_id, 'auto_locked', 'Offer accepted automatically',
      private.who(new.worker_id, 'The worker') || ' will do ' || private.label(v_task.title)
        || '. Paid from your wallet, so they can start.', v_task.id);
  exception when others then
    perform private.notify(v_task.poster_id, 'auto_locked', 'Offer accepted: payment needed',
      private.who(new.worker_id, 'The worker') || ' is ready to do ' || private.label(v_task.title)
        || '. Add money to your wallet so they can start.', v_task.id);
  end;
  return new;
exception when others then
  return new;
end;
$$;

-- ---- money back, fines and withdrawals ----------------------------------------

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
      update public.wallets set credits_minor = credits_minor + v_amount, updated_at = now()
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
          private.who(v_task.poster_id, 'The customer') || ' cancelled after you started',
          'You were paid ' || private.rupees(v_fine) || ' for your time on '
            || private.label(v_task.title) || '. It is in your wallet.',
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
    perform private.notify_payout(v_row.user_id, 'failed', v_row.amount_minor, p_note);
  elsif p_status = 'paid' then
    perform private.notify_payout(v_row.user_id, 'sent', v_row.amount_minor);
  end if;

  return v_row;
end;
$function$;

create or replace function public.fail_unsent_payout(
  p_payout_id         uuid,
  p_note              text,
  p_expected_attempts int default null,
  p_quiet_minutes     int default 0
)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row public.payouts;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform settles withdrawals';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then return null; end if;
  if v_row.status not in ('requested', 'processing') or v_row.provider_payout_id is not null then
    return v_row;
  end if;
  if p_expected_attempts is not null and v_row.attempts <> p_expected_attempts then
    return v_row;
  end if;
  if coalesce(p_quiet_minutes, 0) > 0
     and v_row.last_attempt_at is not null
     and v_row.last_attempt_at > now() - make_interval(mins => p_quiet_minutes) then
    return v_row;
  end if;

  update public.payouts
     set status = 'failed',
         failure_note = left(coalesce(p_note, 'RazorpayX could not send it'), 500),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
   where user_id = v_row.user_id;

  perform private.notify_payout(v_row.user_id, 'failed', v_row.amount_minor, p_note);
  return v_row;
end;
$fn$;

create or replace function public.record_payout_status(
  p_payout_id   uuid,
  p_provider_id text,
  p_status      text,
  p_utr         text default null,
  p_fee_minor   bigint default null,
  p_tax_minor   bigint default null,
  p_note        text default null
)
returns public.payouts
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_row    public.payouts;
  v_status text := lower(coalesce(p_status, ''));
  v_note   text;
begin
  if auth.uid() is not null and not private.is_admin() then
    raise exception 'Only the platform settles withdrawals';
  end if;

  select * into v_row from public.payouts where id = p_payout_id for update;
  if not found then return null; end if;

  -- A withdrawal a person is paying by hand has nothing to do with RazorpayX.
  if v_row.via = 'manual' then return v_row; end if;

  -- One idempotency key per withdrawal means one RazorpayX payout. A second
  -- one is never settled on; a person has to look at it.
  if p_provider_id is not null and v_row.provider_payout_id is not null and v_row.provider_payout_id <> p_provider_id then
    update public.payouts
       set failure_note = left('RazorpayX reported a second payout (' || p_provider_id || ') for this withdrawal. Check both in RazorpayX.', 500),
           updated_at = now()
     where id = v_row.id
    returning * into v_row;
    return v_row;
  end if;

  if v_row.status in ('failed', 'cancelled') then
    -- Given back as "never sent", yet RazorpayX now reports a live payout for
    -- it. The worker may get paid twice; a person has to look.
    if v_row.provider_payout_id is null and p_provider_id is not null
       and v_status not in ('failed', 'rejected', 'cancelled', 'reversed') then
      update public.payouts
         set provider_payout_id = p_provider_id,
             provider_status = nullif(v_status, ''),
             provider_status_at = now(),
             failure_note = left('Check in RazorpayX: payout ' || p_provider_id || ' (' || coalesce(nullif(v_status, ''), 'unknown')
               || ') exists for this withdrawal, but the money was already given back to the worker.', 500),
             updated_at = now()
       where id = v_row.id
      returning * into v_row;
    end if;
    return v_row;
  end if;

  if v_row.status = 'paid' then
    if v_status <> 'reversed' then
      return v_row;
    end if;
    -- The bank sent it back after it had arrived. RazorpayX credits TaskDrop's
    -- account, so the worker gets it back in earnings.
    v_note := coalesce(nullif(btrim(p_note), ''), 'Your bank sent the money back');
    update public.payouts
       set status = 'failed',
           provider_status = 'reversed',
           provider_status_at = now(),
           reversed_at = now(),
           failure_note = left(v_note, 500),
           updated_at = now()
     where id = v_row.id
    returning * into v_row;
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify_payout(v_row.user_id, 'returned', v_row.amount_minor, v_note);
    return v_row;
  end if;

  -- Still open: requested or processing.
  update public.payouts
     set provider_payout_id = coalesce(provider_payout_id, p_provider_id),
         sent_at = case when coalesce(provider_payout_id, p_provider_id) is not null then coalesce(sent_at, now()) else sent_at end,
         provider_status = nullif(v_status, ''),
         provider_status_at = now(),
         fee_minor = coalesce(p_fee_minor, fee_minor),
         tax_minor = coalesce(p_tax_minor, tax_minor),
         reference = coalesce(nullif(btrim(p_utr), ''), reference),
         updated_at = now()
   where id = v_row.id
  returning * into v_row;

  if v_status = 'processed' then
    update public.payouts set status = 'paid', failure_note = null, updated_at = now()
     where id = v_row.id
    returning * into v_row;
    perform private.notify_payout(v_row.user_id, 'sent', v_row.amount_minor, null, v_row.reference);
  elsif v_status in ('failed', 'rejected', 'cancelled', 'reversed') then
    v_note := coalesce(nullif(btrim(p_note), ''),
      case v_status
        when 'rejected' then 'The withdrawal was rejected'
        when 'cancelled' then 'The withdrawal was cancelled at RazorpayX'
        when 'reversed' then 'Your bank sent the money back'
        else 'The bank could not take the transfer'
      end);
    update public.payouts
       set status = 'failed', failure_note = left(v_note, 500),
           reversed_at = case when v_status = 'reversed' then now() else reversed_at end,
           updated_at = now()
     where id = v_row.id
    returning * into v_row;
    update public.wallets set balance_minor = balance_minor + v_row.amount_minor, updated_at = now()
     where user_id = v_row.user_id;
    perform private.notify_payout(v_row.user_id, 'failed', v_row.amount_minor, v_note);
  elsif v_row.status = 'requested' and v_row.provider_payout_id is not null then
    update public.payouts set status = 'processing', updated_at = now() where id = v_row.id
    returning * into v_row;
  end if;

  return v_row;
end;
$fn$;

-- ---- wallet, help requests and account safety ------------------------------------

create or replace function private.notify_wallet_adjustment()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.notify(
    new.user_id, 'wallet',
    private.rupees(abs(new.delta_minor)::bigint)
      || case when new.delta_minor >= 0 then ' added to your wallet' else ' taken from your wallet' end,
    'Open your wallet to see why.'
  );
  return new;
end;
$$;

create or replace function private.notify_ticket_resolved()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.status = 'resolved' and old.status is distinct from 'resolved'
     and auth.uid() is distinct from new.user_id then   -- not when they closed it themselves
    perform private.notify(new.user_id, 'support', 'Your help request is closed',
      'Open it to read our reply, or tell us if you still need help.', null, new.id);
  end if;
  return new;
end;
$$;

create or replace function public.record_password_attempt(p_username text, p_ip text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_15m  integer;
  v_24h  integer;
  v_user uuid;
begin
  insert into public.password_attempts (username, ip, ok) values (p_username, p_ip, p_ok);
  if p_ok then return; end if;

  select count(*) filter (where at > now() - interval '15 minutes'), count(*)
    into v_15m, v_24h
    from public.password_attempts
   where username = p_username and not ok and at > now() - interval '24 hours';

  if v_15m = 8 or v_24h = 20 then
    select id into v_user from public.profiles where username = p_username and deleted_at is null;
    perform private.notify(
      v_user, 'security',
      'Wrong password entered on your account',
      case when v_24h = 20
        then 'Password sign-in is paused for 24 hours. Not you? Set a new password in Account & settings.'
        else 'Password sign-in is paused for 15 minutes. Not you? Set a new password in Account & settings.'
      end);
  end if;
end;
$$;

create or replace function public.admin_warn_user(p_user uuid, p_reason text, p_report uuid default null)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_reason text := left(btrim(coalesce(p_reason, '')), 500);
  v_id     uuid;
  v_report public.reports;
begin
  perform private.require_people_staff();
  if v_reason = '' then raise exception 'Say what the warning is for'; end if;
  if p_user is null or not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'That person does not exist';
  end if;
  if p_user = auth.uid() then raise exception 'You can''t warn yourself'; end if;

  if p_report is not null then
    select * into v_report from public.reports where id = p_report;
    if not found then raise exception 'That report does not exist'; end if;
  end if;

  insert into public.user_warnings (user_id, reason, warned_by, report_id)
  values (p_user, v_reason, auth.uid(), p_report)
  returning id into v_id;

  perform private.notify(p_user, 'admin_warning', 'A warning from TaskDrop',
    v_reason || ' Please follow the community rules. More problems can get your account suspended.');

  -- Close the report that led to it, if it is still open.
  if p_report is not null then
    update public.reports
       set status = 'actioned', handled_by = auth.uid(), handled_at = now(),
           resolution = left('Warned the person: ' || v_reason, 500)
     where id = p_report and status = 'open';
  end if;

  perform public.admin_log_event('user.warn', p_user::text, left(v_reason, 400));
  return v_id;
end;
$fn$;

-- ---- TaskDrop steps in, and reminders ------------------------------------------------

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
    'TaskDrop cancelled your task',
    private.label(v_task.title) || ' was cancelled. Reason: ' || left(v_reason, 200), v_task.id);
  if v_assign.worker_id is not null then
    perform private.notify(v_assign.worker_id, 'admin_cancelled',
      'TaskDrop cancelled a task you were picked for',
      private.label(v_task.title) || ' was cancelled. You can offer on other tasks.', v_task.id);
  end if;

  perform public.admin_log_event(
    'cancel_task_with_refund', p_task_id::text,
    left('phase ' || v_phase || '; funded via ' || coalesce(v_task.funded_via, 'nothing')
         || '; ' || v_reason, 500));
  return v_task;
end;
$$;

create or replace function public.run_task_reminders()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  r        record;
  v_review integer := 0;
  v_due    integer := 0;
begin
  perform private.assert_service_caller();

  -- One run at a time; a second caller simply does nothing.
  if not pg_try_advisory_xact_lock(hashtextextended('run_task_reminders', 0)) then
    return jsonb_build_object('review_reminders', 0, 'due_reminders', 0, 'skipped', true);
  end if;

  -- Poster: finished work, approved for them within 24 hours if they do nothing.
  for r in
    select t.id, t.poster_id, t.title
      from public.tasks t
     where t.status = 'WORK_DONE'
       and t.funded_at is not null
       and t.auto_complete_at is not null
       and t.auto_complete_at > now()
       and t.auto_complete_at <= now() + interval '24 hours'
       and not exists (select 1 from public.notifications n
                        where n.task_id = t.id and n.user_id = t.poster_id and n.kind = 'review_reminder')
     order by t.auto_complete_at
     limit 500
  loop
    perform private.notify(
      r.poster_id, 'review_reminder',
      'Work is waiting for your approval',
      private.label(r.title) || ': approve it or report a problem. If you do nothing, it is approved for you within 24 hours.',
      r.id);
    v_review := v_review + 1;
  end loop;

  -- Worker: a started job that falls due within the hour.
  for r in
    select t.id, t.title, a.worker_id
      from public.tasks t
      join public.assignments a on a.task_id = t.id and a.status = 'started'
     where t.status = 'TASK_STARTED'
       and t.due_at is not null
       and t.due_at > now()
       and t.due_at <= now() + interval '1 hour'
       and not exists (select 1 from public.notifications n
                        where n.task_id = t.id and n.user_id = a.worker_id and n.kind = 'due_reminder')
     order by t.due_at
     limit 500
  loop
    perform private.notify(
      r.worker_id, 'due_reminder',
      'Due within the hour',
      'Send ' || private.label(r.title) || ' before the deadline.',
      r.id);
    v_due := v_due + 1;
  end loop;

  return jsonb_build_object('review_reminders', v_review, 'due_reminders', v_due);
end;
$$;
