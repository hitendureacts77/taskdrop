-- Earnings were going in and never coming out.
--
-- confirm_release puts the worker's net into wallets.clearing_minor and stamps
-- tasks.clear_at seven days out. Nothing, anywhere in the database, ever moved
-- that money into balance_minor -- so a worker's earnings landed in clearing
-- and stayed there permanently, and request_withdrawal (which spends
-- balance_minor) could never see a rupee of it.
--
-- Two live wallets were already holding money in this state when this was
-- written. This is the missing half of the payout loop.

-- Which tasks have already been swept. Without this the sweep is not
-- idempotent, and running it twice pays the worker twice.
alter table public.tasks
  add column if not exists cleared_at timestamptz;

create index if not exists tasks_due_to_clear_idx
  on public.tasks (clear_at)
  where cleared_at is null and clear_at is not null;

-- Move every earning whose clearing period has elapsed into the spendable
-- balance. Safe to run as often as you like: a task is swept at most once,
-- enforced by cleared_at and the row lock. Returns how many it settled.
create or replace function public.settle_cleared_earnings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task        record;
  v_worker      uuid;
  v_commission  numeric;
  v_net         bigint;
  v_count       integer := 0;
begin
  v_commission := private.setting_num('worker_commission_pct', 0.20);

  for v_task in
    select t.id, t.locked_minor
      from public.tasks t
     where t.cleared_at is null
       and t.clear_at is not null
       and t.clear_at <= now()
       and t.status in ('COMPLETED', 'AUTO_COMPLETED')
     order by t.clear_at
     for update
  loop
    select a.worker_id into v_worker
      from public.assignments a
     where a.task_id = v_task.id
     order by a.created_at desc
     limit 1;

    -- No worker means nothing to pay; still mark it so it stops being scanned.
    if v_worker is not null then
      v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));

      -- Never move more than is actually sitting in clearing. If the two ever
      -- disagree, paying out the smaller number is the safe direction.
      update public.wallets w
         set clearing_minor = w.clearing_minor - least(v_net, w.clearing_minor),
             balance_minor  = w.balance_minor  + least(v_net, w.clearing_minor)
       where w.user_id = v_worker;
    end if;

    update public.tasks set cleared_at = now() where id = v_task.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

-- Anyone may trigger the sweep for themselves being paid; it only ever moves
-- money that is already owed, and only after its clearing period. Running it
-- is not a privilege, and gating it behind an admin would mean workers wait on
-- someone remembering.
revoke all on function public.settle_cleared_earnings() from public, anon;
grant execute on function public.settle_cleared_earnings() to authenticated;

comment on function public.settle_cleared_earnings() is
  'Moves cleared earnings from wallets.clearing_minor to balance_minor. Idempotent via tasks.cleared_at.';
