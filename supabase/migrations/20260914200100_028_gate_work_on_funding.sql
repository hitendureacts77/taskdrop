-- The gate. Two functions, one new check each, and the hole closes.

-- A worker must not be able to begin on a task nobody has paid for. This
-- protects the worker from doing unpaid work, and the operator from owing
-- money that was never collected.
create or replace function public.start_task(p_task_id uuid)
returns public.tasks
language plpgsql security definer set search_path to 'public'
as $fn$
declare v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not exists (select 1 from public.assignments
                  where task_id = p_task_id and worker_id = auth.uid()) then
    raise exception 'You are not assigned to this task';
  end if;
  if v_task.status <> 'LOCKED' then raise exception 'This task cannot be started'; end if;

  -- No money, no work. The poster locked the quote but never paid.
  if v_task.funded_at is null then
    raise exception 'This task has not been paid for yet. Ask the poster to fund the escrow first.';
  end if;

  update public.assignments set status = 'started'
   where task_id = p_task_id and worker_id = auth.uid();
  -- Everyone else loses the race; their hold is released.
  update public.assignments set status = 'refunded'
   where task_id = p_task_id and worker_id <> auth.uid();

  update public.tasks
     set status = 'TASK_STARTED', started_at = now()
   where id = p_task_id returning * into v_task;

  return v_task;
end $fn$;

-- Belt as well as braces. start_task is the only route into TASK_STARTED, so
-- this should be unreachable -- but confirm_release is the function that moves
-- money to a worker, and it should refuse to pay out against an escrow that
-- was never collected regardless of how the task got here.
create or replace function public.confirm_release(p_task_id uuid)
returns public.tasks
language plpgsql security definer set search_path to 'public'
as $fn$
declare
  v_task public.tasks;
  v_worker uuid;
  v_commission numeric;
  v_clear_days numeric;
  v_net bigint;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if v_task.poster_id <> auth.uid() then raise exception 'Only the poster can release escrow'; end if;
  if v_task.status not in ('WORK_DONE','REVISION_REQUESTED') then
    raise exception 'The worker has not marked this done yet';
  end if;
  if v_task.funded_at is null then
    raise exception 'No escrow was ever paid for this task, so there is nothing to release';
  end if;

  select worker_id into v_worker from public.assignments
   where task_id = p_task_id and status = 'started' limit 1;
  if v_worker is null then raise exception 'No active worker on this task'; end if;

  v_commission := private.setting_num('worker_commission_pct', 0.20);
  v_clear_days := private.setting_num('clearing_period_days', 7);
  v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));

  -- Earnings clear before they can be withdrawn.
  update public.wallets set clearing_minor = clearing_minor + v_net where user_id = v_worker;

  update public.assignments set status = 'released'
   where task_id = p_task_id and worker_id = v_worker;

  update public.tasks
     set status = 'COMPLETED', completed_at = now(),
         clear_at = now() + (v_clear_days || ' days')::interval
   where id = p_task_id returning * into v_task;

  return v_task;
end $fn$;
