-- 043 — the company's own money.
--
-- Until now the platform's cut existed only as an absence: confirm_release
-- credited the worker round(locked * 0.80) and the remaining 20% was simply
-- never moved anywhere. The money was real -- it stays in the Razorpay balance
-- because it was never disbursed -- but nothing in Postgres recorded that we
-- had earned it, so "what has TaskDrop made" could only ever be re-derived
-- from task prices rather than read from booked revenue.
--
-- This adds the ledger that was missing: one row per earning, per task, with
-- the company balance being their sum. Two kinds are booked when a task
-- completes:
--   worker_commission -- the locked price minus what the worker actually nets
--   poster_fee        -- what the poster paid into escrow above the locked price
--
-- Booked by a trigger on the task's status rather than inside confirm_release,
-- because three different functions can finish a task (confirm_release,
-- admin_resolve_dispute, and whatever comes next) and revenue that depends on
-- remembering to call it from each one is revenue that eventually goes
-- unrecorded.

create table if not exists public.platform_ledger (
  id           uuid primary key default gen_random_uuid(),
  task_id      uuid references public.tasks (id) on delete set null,
  kind         text not null check (kind in ('worker_commission', 'poster_fee', 'adjustment')),
  amount_minor bigint not null,
  currency     text not null default 'INR',
  note         text,
  created_at   timestamptz not null default now()
);

comment on table public.platform_ledger is
  'TaskDrop''s own earnings, in paise. One row per earning; the company balance is their sum.';

-- A task earns each kind exactly once, ever. This is what makes booking
-- idempotent: a retried release, or a task that somehow re-enters COMPLETED,
-- cannot double-count revenue.
create unique index if not exists platform_ledger_once_per_task_kind
  on public.platform_ledger (task_id, kind)
  where kind in ('worker_commission', 'poster_fee');

create index if not exists platform_ledger_created_at_idx
  on public.platform_ledger (created_at desc);

alter table public.platform_ledger enable row level security;

-- Admins read it. Nobody writes it from the API: rows are inserted only by the
-- security-definer trigger below, which is the same rule the rest of the money
-- tables follow.
drop policy if exists platform_ledger_admin_read on public.platform_ledger;
create policy platform_ledger_admin_read on public.platform_ledger
  for select using (private.is_admin());

revoke all on public.platform_ledger from anon, authenticated;
grant select on public.platform_ledger to authenticated;

-- ---------------------------------------------------------------------------

create or replace function private.book_platform_revenue(
  p_task_id     uuid,
  p_locked_minor bigint,
  p_net_minor    bigint,
  p_escrow_minor bigint
) returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_commission bigint;
  v_fee        bigint;
begin
  -- Derived by subtraction, never by re-applying the percentage. The worker's
  -- net is already rounded; recomputing round(locked * 0.20) separately can
  -- land a paisa off, and then the ledger and the wallets disagree forever.
  -- Subtracting guarantees commission + net = locked, exactly.
  v_commission := greatest(coalesce(p_locked_minor, 0) - coalesce(p_net_minor, 0), 0);
  if v_commission > 0 then
    insert into public.platform_ledger (task_id, kind, amount_minor, note)
    values (p_task_id, 'worker_commission', v_commission, 'commission on completed order')
    on conflict do nothing;
  end if;

  -- Whatever the poster paid above the locked price is the service fee, taken
  -- from what was actually collected rather than from the percentage, so a
  -- changed fee setting never rewrites history.
  v_fee := greatest(coalesce(p_escrow_minor, 0) - coalesce(p_locked_minor, 0), 0);
  if v_fee > 0 then
    insert into public.platform_ledger (task_id, kind, amount_minor, note)
    values (p_task_id, 'poster_fee', v_fee, 'poster service fee on completed order')
    on conflict do nothing;
  end if;
end;
$fn$;

revoke all on function private.book_platform_revenue(uuid, bigint, bigint, bigint) from public, anon, authenticated;

-- ---------------------------------------------------------------------------

create or replace function private.book_revenue_on_completion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_escrow bigint;
  v_net    bigint;
begin
  if new.status in ('COMPLETED', 'AUTO_COMPLETED')
     and old.status is distinct from new.status then

    select a.escrow_minor into v_escrow
      from public.assignments a
     where a.task_id = new.id
     order by a.created_at desc
     limit 1;

    -- Same expression the paying functions use, so the ledger's idea of the
    -- worker's net is the one that was actually credited.
    v_net := round(coalesce(new.locked_minor, 0)
                   * (1 - private.setting_num('worker_commission_pct', 0.20)));

    perform private.book_platform_revenue(
      new.id, coalesce(new.locked_minor, 0), v_net, coalesce(v_escrow, 0)
    );
  end if;
  return new;
end;
$fn$;

drop trigger if exists tasks_book_platform_revenue on public.tasks;
create trigger tasks_book_platform_revenue
  after update of status on public.tasks
  for each row
  execute function private.book_revenue_on_completion();

-- ---------------------------------------------------------------------------

-- The company wallet, read as a balance rather than stored as one: a stored
-- number can drift from the rows that justify it, a sum cannot.
create or replace function public.platform_earnings()
returns table (
  balance_minor    bigint,
  commission_minor bigint,
  poster_fee_minor bigint,
  orders           bigint
)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then
    raise exception 'Admins only';
  end if;

  return query
    select coalesce(sum(l.amount_minor), 0)::bigint,
           coalesce(sum(l.amount_minor) filter (where l.kind = 'worker_commission'), 0)::bigint,
           coalesce(sum(l.amount_minor) filter (where l.kind = 'poster_fee'), 0)::bigint,
           count(distinct l.task_id) filter (where l.kind = 'worker_commission')::bigint
      from public.platform_ledger l;
end;
$fn$;

revoke all on function public.platform_earnings() from public, anon;
grant execute on function public.platform_earnings() to authenticated;
