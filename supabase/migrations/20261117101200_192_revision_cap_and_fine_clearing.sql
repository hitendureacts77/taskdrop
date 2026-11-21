-- 192: two money rules in a task's life (debug round 8, S2-5 and S2-6).
--
-- 1. Asking for changes has a limit (S2-5). request_revision cleared the 3-day review clock and
--    nothing capped how often a poster could send the work back, so a poster could hold the
--    worker's money for ever: send it back, the worker re-sends, send it back again. Now a poster
--    may ask for changes at most settings.max_revision_rounds times (2, packages/rules
--    REVISIONS.MAX_ROUNDS) per run of the job (counted from when the current worker started).
--    After that the only answers are approve, or report a problem; and every re-send starts the
--    3-day review clock again (mark_work_done), so the auto-complete always comes in the end.
--    Each request is kept in private.task_revision_requests (task and time only, no text).
--
-- 2. The cancel fine clears like any other earnings (S2-6). cancel_task paid the 5% post-start
--    fine straight into the worker's spendable balance: no 7-day clearing (AGENTS "earnings clear
--    after 7 days") and no record of where that money was in the clearing pipeline. Now the fine
--    goes to the worker's clearing balance and a row in private.cancel_fine_clearing records it
--    (task, worker, amount, when it clears, when it cleared). The clearing sweeps that already run
--    (public.settle_cleared_earnings on its existing schedule, and settle_my_cleared_earnings when
--    the worker opens their wallet) move it to the spendable balance once clear_at has passed.
--    With clearing_period_days at 0 the fine is paid at once, as before, and the row is written
--    already cleared. No commission is taken on the fine: whether it should be is an owner
--    decision (S2-6 note), so the amount the worker receives does not change here.
--    Fines paid before this migration were already credited to the balance and have no row, so
--    the sweep cannot pay them twice.
--
-- Additive (rule 2): two private tables, one setting, and new bodies for request_revision,
-- cancel_task, settle_cleared_earnings and settle_my_cleared_earnings (same signatures and grants).
-- No new schedule (rule 8): the existing sweeps do the clearing.

-- ------------------------------------------------------------------ the setting --
insert into public.settings (key, value)
values ('max_revision_rounds', '2'::jsonb)
on conflict (key) do nothing;

-- -------------------------------------------------------- 1. revision requests --
create table if not exists private.task_revision_requests (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists task_revision_requests_task_idx
  on private.task_revision_requests (task_id, created_at);
alter table private.task_revision_requests enable row level security;
revoke all on private.task_revision_requests from public, anon, authenticated;

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
  v_me     uuid := auth.uid();
  v_task   public.tasks;
  v_max    integer := greatest(coalesce(private.setting_num('max_revision_rounds', 2), 2), 0)::integer;
  v_asked  integer;
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

  -- Counted for this run of the job: a worker who left and a new one hired starts again at zero.
  select count(*) into v_asked
    from private.task_revision_requests r
   where r.task_id = p_task_id
     and r.created_at >= coalesce(v_task.started_at, '-infinity'::timestamptz);
  if v_asked >= v_max then
    raise exception 'You have already asked for changes % times. Approve the work, or report a problem if it is still not right.', v_max;
  end if;

  insert into private.task_revision_requests (task_id) values (p_task_id);

  update public.tasks
     set status = 'REVISION_REQUESTED',
         -- The worker re-sends; mark_work_done starts the review window again from then.
         work_done_at = null,
         auto_complete_at = null
   where id = p_task_id
  returning * into v_task;

  return v_task;
end;
$$;
revoke all on function public.request_revision(uuid, text) from public, anon;
grant execute on function public.request_revision(uuid, text) to authenticated;

-- -------------------------------------------------------- 2. the cancel fine --
create table if not exists private.cancel_fine_clearing (
  task_id    uuid primary key references public.tasks (id) on delete cascade,
  worker_id  uuid not null references auth.users (id) on delete cascade,
  fine_minor bigint not null check (fine_minor > 0),
  created_at timestamptz not null default now(),
  clear_at   timestamptz not null,
  cleared_at timestamptz
);
create index if not exists cancel_fine_clearing_due_idx
  on private.cancel_fine_clearing (clear_at) where cleared_at is null;
create index if not exists cancel_fine_clearing_worker_idx
  on private.cancel_fine_clearing (worker_id) where cleared_at is null;
alter table private.cancel_fine_clearing enable row level security;
revoke all on private.cancel_fine_clearing from public, anon, authenticated;

-- cancel_task: as in 128, except the fine goes to clearing (or straight to the balance when the
-- clearing period is 0) and is recorded in private.cancel_fine_clearing.
create or replace function public.cancel_task(p_task_id uuid, p_reason text default null)
returns public.tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me         uuid := auth.uid();
  v_task       public.tasks;
  v_assign     public.assignments;
  v_is_poster  boolean;
  v_phase      text;
  v_fine       bigint := 0;
  v_clear_days numeric := private.setting_num('clearing_period_days', 7);
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
        if coalesce(v_clear_days, 0) <= 0 then
          update public.wallets
             set balance_minor = balance_minor + v_fine, updated_at = now()
           where user_id = v_assign.worker_id;
          insert into private.cancel_fine_clearing (task_id, worker_id, fine_minor, clear_at, cleared_at)
          values (p_task_id, v_assign.worker_id, v_fine, now(), now())
          on conflict (task_id) do nothing;
          perform private.notify(
            v_assign.worker_id, 'cancel_fine',
            private.who(v_task.poster_id, 'The customer') || ' cancelled after you started',
            'You were paid ' || private.rupees(v_fine) || ' for your time on '
              || private.label(v_task.title) || '. It is in your wallet.',
            v_task.id);
        else
          -- Earnings clear before they can be withdrawn; the fine is earnings (S2-6).
          update public.wallets
             set clearing_minor = clearing_minor + v_fine, updated_at = now()
           where user_id = v_assign.worker_id;
          insert into private.cancel_fine_clearing (task_id, worker_id, fine_minor, clear_at)
          values (p_task_id, v_assign.worker_id, v_fine, now() + make_interval(days => ceil(v_clear_days)::int))
          on conflict (task_id) do nothing;
          perform private.notify(
            v_assign.worker_id, 'cancel_fine',
            private.who(v_task.poster_id, 'The customer') || ' cancelled after you started',
            'You were paid ' || private.rupees(v_fine) || ' for your time on '
              || private.label(v_task.title) || '. It clears into your wallet in '
              || ceil(v_clear_days)::int || case when ceil(v_clear_days)::int = 1 then ' day.' else ' days.' end,
            v_task.id);
        end if;
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
revoke all on function public.cancel_task(uuid, text) from public, anon;
grant execute on function public.cancel_task(uuid, text) to authenticated;

-- The clearing sweeps: as in 066, plus fines whose clearing period has run.
create or replace function public.settle_cleared_earnings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task        record;
  v_fine        record;
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
    v_worker := null;
    select a.worker_id into v_worker
      from public.assignments a
     where a.task_id = v_task.id
     order by (a.status = 'released') desc, a.created_at desc
     limit 1;

    if v_worker is not null then
      v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));
      -- Never move more than is actually sitting in clearing.
      update public.wallets w
         set clearing_minor = w.clearing_minor - least(v_net, w.clearing_minor),
             balance_minor  = w.balance_minor  + least(v_net, w.clearing_minor)
       where w.user_id = v_worker;
    end if;

    update public.tasks set cleared_at = now() where id = v_task.id;
    v_count := v_count + 1;
  end loop;

  for v_fine in
    select f.task_id, f.worker_id, f.fine_minor
      from private.cancel_fine_clearing f
     where f.cleared_at is null
       and f.clear_at <= now()
     order by f.clear_at
     for update skip locked
  loop
    update public.wallets w
       set clearing_minor = w.clearing_minor - least(v_fine.fine_minor, w.clearing_minor),
           balance_minor  = w.balance_minor  + least(v_fine.fine_minor, w.clearing_minor),
           updated_at     = now()
     where w.user_id = v_fine.worker_id;
    update private.cancel_fine_clearing set cleared_at = now() where task_id = v_fine.task_id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;

create or replace function public.settle_my_cleared_earnings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_task       record;
  v_fine       record;
  v_me         uuid := auth.uid();
  v_commission numeric;
  v_net        bigint;
  v_count      integer := 0;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  v_commission := private.setting_num('worker_commission_pct', 0.20);

  for v_task in
    select t.id, t.locked_minor
      from public.tasks t
     where t.cleared_at is null
       and t.clear_at is not null
       and t.clear_at <= now()
       and t.status in ('COMPLETED', 'AUTO_COMPLETED')
       and ( select a.worker_id
               from public.assignments a
              where a.task_id = t.id
              order by (a.status = 'released') desc, a.created_at desc
              limit 1 ) = v_me
     order by t.clear_at
     for update
  loop
    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));

    update public.wallets w
       set clearing_minor = w.clearing_minor - least(v_net, w.clearing_minor),
           balance_minor  = w.balance_minor  + least(v_net, w.clearing_minor)
     where w.user_id = v_me;

    update public.tasks set cleared_at = now() where id = v_task.id;
    v_count := v_count + 1;
  end loop;

  for v_fine in
    select f.task_id, f.fine_minor
      from private.cancel_fine_clearing f
     where f.worker_id = v_me
       and f.cleared_at is null
       and f.clear_at <= now()
     order by f.clear_at
     for update skip locked
  loop
    update public.wallets w
       set clearing_minor = w.clearing_minor - least(v_fine.fine_minor, w.clearing_minor),
           balance_minor  = w.balance_minor  + least(v_fine.fine_minor, w.clearing_minor),
           updated_at     = now()
     where w.user_id = v_me;
    update private.cancel_fine_clearing set cleared_at = now() where task_id = v_fine.task_id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$fn$;
