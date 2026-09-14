-- 014_cancel_task
--
-- You cannot run a marketplace where a poster is unable to withdraw a request,
-- or a worker is stuck on a job they can no longer do. The schema anticipated
-- this from the start — CANCELLED status, cancellations_log, a 5% post-start
-- fine in the rules — but nothing ever called it.
--
-- The shape of it:
--
--   Poster, task still OPEN          free; nobody has committed anything.
--   Poster, LOCKED but not started   free; the worker has not invested time.
--                                    The hold is released.
--   Poster, TASK_STARTED             the worker is paid a 5% fine out of the
--                                    locked amount for the time they have
--                                    already put in. The rest is released.
--   Worker, LOCKED or TASK_STARTED   the assignment is dropped and the task
--                                    goes back to OPEN rather than dying —
--                                    the poster still wants the job done, and
--                                    stranding them punishes the wrong person.
--   After WORK_DONE                  refused. That is what disputes are for.

create or replace function public.cancel_task(
  p_task_id uuid,
  p_reason  text default null
)
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
  v_fine      bigint := 0;
  v_phase     text;
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
    -- Only once the worker has actually started does a fine apply.
    if v_task.status = 'TASK_STARTED' then
      v_fine := round(coalesce(v_task.locked_minor, 0) * 0.05);
      if v_fine > 0 then
        update public.wallets
           set clearing_minor = clearing_minor + v_fine
         where user_id = v_assign.worker_id;
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

  insert into public.cancellations_log
    (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
  values (p_task_id, 'poster', 'normal', v_phase, v_task.locked_minor, v_fine);

  return v_task;
end;
$$;

revoke all on function public.cancel_task(uuid, text) from public;
grant execute on function public.cancel_task(uuid, text) to authenticated;
