-- 049_auto_accept_payout_mode
--
-- Auto-accept (048) never locked anything. An OPEN task has no payout_mode yet
-- -- lock_bid() is what sets it -- so the trigger copied a NULL into
-- assignments.payout_mode, hit its NOT NULL constraint, and its exception
-- handler quietly left the quote as an ordinary one. Default to 'one_time',
-- which is lock_bid()'s own default, and write it to the task as lock_bid does.
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
  on conflict (task_id, worker_id) do update set escrow_minor = excluded.escrow_minor;

  update public.bids set is_locked = true where id = new.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = new.id,
         locked_minor = new.price_minor,
         payout_mode = v_mode
   where id = v_task.id;

  perform private.notify(v_task.poster_id, 'auto_locked',
    'A quote was auto-accepted on "' || left(v_task.title, 60) || '"',
    'Fund the escrow so the worker can start.', v_task.id);
  return new;
exception when others then
  return new;
end;
$$;
revoke all on function private.auto_accept_bid() from public;
