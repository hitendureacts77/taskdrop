-- 011_revision_and_dispute
--
-- "Request changes" and "Open a dispute" on the confirm screen only ever
-- flashed a toast, so a poster who pressed either believed something had
-- happened when nothing had. Both are real transitions in task_status, so they
-- get real RPCs with the same rules as the rest of the lifecycle: the caller
-- must be a participant, and the state must make sense to move from.

-- Poster sends the work back for changes. Escrow stays exactly where it is.
create or replace function public.request_revision(
  p_task_id uuid,
  p_note    text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_task public.tasks;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;
  if v_task.poster_id <> v_me then
    raise exception 'Only the poster can ask for changes';
  end if;
  if v_task.status <> 'WORK_DONE' then
    raise exception 'There is no submitted work to send back';
  end if;

  update public.tasks
     set status = 'REVISION_REQUESTED',
         -- The worker gets the review window back; the clock restarts from now.
         work_done_at = null,
         auto_complete_at = null
   where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

-- Either side can escalate. Escrow is frozen until an admin resolves it, so
-- this deliberately does not move money.
create or replace function public.open_dispute(
  p_task_id uuid,
  p_reason  text default null
)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me     uuid := auth.uid();
  v_task   public.tasks;
  v_worker uuid;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;

  select a.worker_id into v_worker
  from public.assignments a
  where a.task_id = p_task_id and a.status in ('started', 'released')
  order by a.created_at desc
  limit 1;

  if v_me <> v_task.poster_id and (v_worker is null or v_me <> v_worker) then
    raise exception 'You were not part of this task';
  end if;
  if v_task.status in ('COMPLETED', 'AUTO_COMPLETED', 'CANCELLED') then
    raise exception 'This task is already closed';
  end if;
  if v_task.status = 'DISPUTED' then
    raise exception 'A dispute is already open on this task';
  end if;

  update public.tasks set status = 'DISPUTED' where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;

revoke all on function public.request_revision(uuid, text) from public;
revoke all on function public.open_dispute(uuid, text) from public;
grant execute on function public.request_revision(uuid, text) to authenticated;
grant execute on function public.open_dispute(uuid, text) to authenticated;
