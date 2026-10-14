-- ===========================================================================
-- Task lifecycle RPCs (migration 006)
-- Money and multi-table state moves live here, not in the client: each function
-- re-checks auth.uid() itself and runs as one transaction. Rates come from the
-- settings table so they stay tunable.
-- ===========================================================================

create or replace function private.setting_num(k text, fallback numeric)
returns numeric language sql stable security definer set search_path = public as $$
  select coalesce((select (value #>> '{}')::numeric from public.settings where key = k), fallback);
$$;

-- ---- Poster locks a quote -> assignment created, task LOCKED ---------------
create or replace function public.lock_bid(p_bid_id uuid, p_payout_mode payout_mode default 'one_time')
returns public.tasks language plpgsql security definer set search_path = public as $$
declare
  v_bid    public.bids;
  v_task   public.tasks;
  v_fee    numeric;
  v_escrow bigint;
begin
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Quote not found'; end if;

  select * into v_task from public.tasks where id = v_bid.task_id for update;
  if v_task.poster_id <> auth.uid() then raise exception 'Only the poster can lock a quote'; end if;
  if v_task.status <> 'OPEN' then raise exception 'This task is no longer open'; end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(v_bid.price_minor * (1 + v_fee));

  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, v_bid.id, v_bid.worker_id, v_escrow, p_payout_mode)
  on conflict (task_id, worker_id) do update set escrow_minor = excluded.escrow_minor;

  update public.bids set is_locked = true where id = v_bid.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = v_bid.id,
         locked_minor = v_bid.price_minor,
         payout_mode = p_payout_mode
   where id = v_task.id
  returning * into v_task;

  return v_task;
end $$;

-- ---- Worker starts -> first to start wins, others released ----------------
create or replace function public.start_task(p_task_id uuid)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not exists (select 1 from public.assignments
                  where task_id = p_task_id and worker_id = auth.uid()) then
    raise exception 'You are not assigned to this task';
  end if;
  if v_task.status <> 'LOCKED' then raise exception 'This task cannot be started'; end if;

  update public.assignments set status = 'started'
   where task_id = p_task_id and worker_id = auth.uid();
  -- Everyone else loses the race; their hold is released.
  update public.assignments set status = 'refunded'
   where task_id = p_task_id and worker_id <> auth.uid();

  update public.tasks
     set status = 'TASK_STARTED', started_at = now()
   where id = p_task_id
  returning * into v_task;

  return v_task;
end $$;

-- ---- Worker marks the work done -> poster's review window opens -----------
create or replace function public.mark_work_done(p_task_id uuid)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare v_task public.tasks; v_days numeric;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not exists (select 1 from public.assignments
                  where task_id = p_task_id and worker_id = auth.uid() and status = 'started') then
    raise exception 'You are not the worker on this task';
  end if;
  if v_task.status not in ('TASK_STARTED','OVERDUE','REVISION_REQUESTED') then
    raise exception 'This task is not in progress';
  end if;

  v_days := private.setting_num('review_window_days', 3);

  update public.tasks
     set status = 'WORK_DONE',
         work_done_at = now(),
         auto_complete_at = now() + (v_days || ' days')::interval
   where id = p_task_id
  returning * into v_task;

  return v_task;
end $$;

-- ---- Poster confirms -> commission taken, worker paid into clearing -------
create or replace function public.confirm_release(p_task_id uuid)
returns public.tasks language plpgsql security definer set search_path = public as $$
declare
  v_task public.tasks; v_worker uuid;
  v_commission numeric; v_clear_days numeric; v_net bigint;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.poster_id <> auth.uid() then raise exception 'Only the poster can release escrow'; end if;
  if v_task.status not in ('WORK_DONE','REVISION_REQUESTED') then
    raise exception 'The worker has not marked this done yet';
  end if;

  select worker_id into v_worker from public.assignments
   where task_id = p_task_id and status = 'started' limit 1;
  if v_worker is null then raise exception 'No active worker on this task'; end if;

  v_commission := private.setting_num('worker_commission_pct', 0.20);
  v_clear_days := private.setting_num('clearing_period_days', 7);
  v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));

  -- Earnings clear before they can be withdrawn.
  update public.wallets
     set clearing_minor = clearing_minor + v_net
   where user_id = v_worker;

  update public.assignments set status = 'released'
   where task_id = p_task_id and worker_id = v_worker;

  update public.tasks
     set status = 'COMPLETED',
         completed_at = now(),
         clear_at = now() + (v_clear_days || ' days')::interval
   where id = p_task_id
  returning * into v_task;

  return v_task;
end $$;

-- Callable by signed-in users only; each function authorises internally.
revoke execute on function public.lock_bid(uuid, payout_mode)  from public, anon;
revoke execute on function public.start_task(uuid)             from public, anon;
revoke execute on function public.mark_work_done(uuid)         from public, anon;
revoke execute on function public.confirm_release(uuid)        from public, anon;
grant  execute on function public.lock_bid(uuid, payout_mode)  to authenticated;
grant  execute on function public.start_task(uuid)             to authenticated;
grant  execute on function public.mark_work_done(uuid)         to authenticated;
grant  execute on function public.confirm_release(uuid)        to authenticated;
