-- Migration 195: Plan B money flow (task 2.21, locked by the owner 18 Nov 2026).
--
-- Pay per task; the payment company holds the money until the poster approves; TaskDrop never holds
-- a balance. Design: docs/design/plan-b-money/DESIGN.md.
--
-- Everything here sits behind the `money_flow` setting:
--   'wallet' (the default, today's behaviour) or 'plan_b'.
-- New hires follow the setting. A task that already has a Plan B hold keeps following Plan B, and a
-- task paid from the wallet keeps following the wallet, whatever the setting says later, so the
-- switch is safe to flip either way at any time. Flipping it back to 'wallet' is the quick undo; the
-- full undo is docs/design/plan-b-money/undo_195.sql.
--
-- Adds only. Changed functions keep their signatures, grants and, under 'wallet', their behaviour.

-- ============================================================================ settings ===

insert into public.settings (key, value) values
  ('money_flow', to_jsonb('wallet'::text)),
  ('money_provider', to_jsonb('simulated'::text)),
  ('money_paused', 'false'::jsonb),
  ('plan_b_unpaid_hours', to_jsonb(24))
on conflict (key) do nothing;

create or replace function private.plan_b_on()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select s.value #>> '{}' from public.settings s where s.key = 'money_flow'), 'wallet') = 'plan_b';
$$;

create or replace function private.money_paused()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select s.value = 'true'::jsonb from public.settings s where s.key = 'money_paused'), false);
$$;

create or replace function private.money_provider()
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((select s.value #>> '{}' from public.settings s where s.key = 'money_provider'), 'simulated');
$$;

-- Only the service role (the Edge Functions and Inngest) or a database owner may call these.
create or replace function private.assert_service()
returns void
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_role text := coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '');
begin
  if not (v_role = 'service_role' or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'not authorised' using errcode = '42501';
  end if;
end;
$$;

revoke all on function private.plan_b_on() from public, anon, authenticated;
revoke all on function private.money_paused() from public, anon, authenticated;
revoke all on function private.money_provider() from public, anon, authenticated;
revoke all on function private.assert_service() from public, anon, authenticated;

-- ============================================================================== tables ===

-- The worker's account at the payment company. No bank account, UPI id or PAN is stored here:
-- those go straight from the money function to the payment company. Only its ids and status.
create table if not exists public.payout_accounts (
  user_id             uuid primary key references auth.users (id) on delete cascade,
  provider            text not null check (provider in ('razorpay_route', 'simulated')),
  provider_account_id text not null,
  status              text not null default 'pending' check (status in ('pending', 'active', 'rejected', 'suspended')),
  method              text check (method in ('bank', 'upi')),
  method_hint         text check (method_hint is null or char_length(method_hint) <= 24),
  status_note         text check (status_note is null or char_length(status_note) <= 200),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
comment on table public.payout_accounts is
  'Plan B (195): the worker''s payee account at the payment company. Provider ids and status only; never bank or UPI numbers.';
comment on column public.payout_accounts.method_hint is 'A masked hint the provider returned, like "UPI ••••@okhdfc" or "Bank ••1234".';

alter table public.payout_accounts enable row level security;
drop policy if exists payout_accounts_own_read on public.payout_accounts;
create policy payout_accounts_own_read on public.payout_accounts
  for select to authenticated using (user_id = auth.uid());
revoke all on public.payout_accounts from anon, authenticated;
grant select (user_id, provider, status, method, method_hint, status_note, created_at, updated_at)
  on public.payout_accounts to authenticated;

-- One row per hire under Plan B: what was charged, who it is held for, and where it stands.
create table if not exists public.task_holds (
  id                   uuid primary key default gen_random_uuid(),
  task_id              uuid not null references public.tasks (id) on delete cascade,
  poster_id            uuid not null references auth.users (id),
  worker_id            uuid not null references auth.users (id),
  provider             text not null check (provider in ('razorpay_route', 'simulated')),
  status               text not null default 'awaiting_payment' check (status in (
                         'awaiting_payment', 'held', 'release_asked', 'released',
                         'refund_asked', 'refunded', 'split_asked', 'split', 'expired', 'failed')),
  offer_minor          bigint not null check (offer_minor > 0),
  charged_minor        bigint not null check (charged_minor >= offer_minor),
  fee_minor            bigint not null check (fee_minor >= 0),
  commission_minor     bigint not null check (commission_minor >= 0),
  worker_share_minor   bigint not null check (worker_share_minor >= 0 and worker_share_minor <= charged_minor),
  -- What the next move sends. Set when a release, refund or split is asked for.
  release_minor        bigint check (release_minor is null or release_minor >= 0),
  refund_minor         bigint check (refund_minor is null or refund_minor >= 0),
  release_key          text unique,
  refund_key           text unique,
  release_ref          text,
  refund_ref           text,
  provider_order_id    text unique,
  provider_payment_id  text unique,
  provider_transfer_id text,
  checkout_url         text,
  -- What the move before 'failed' was, so a retry knows what to retry.
  failed_from          text check (failed_from is null or failed_from in ('release_asked', 'refund_asked', 'split_asked')),
  note                 text check (note is null or char_length(note) <= 300),
  moving_until         timestamptz,
  attempts             integer not null default 0,
  expires_at           timestamptz,
  paid_at              timestamptz,
  asked_at             timestamptz,
  settled_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.task_holds is
  'Plan B (195): one row per hire. The payment company holds charged_minor; worker_share_minor is released on approval.';

-- At most one live hold per task (a new hire after a walk-away opens a new row).
create unique index if not exists task_holds_one_live_per_task
  on public.task_holds (task_id) where status in ('awaiting_payment', 'held');
create index if not exists task_holds_task_idx on public.task_holds (task_id, created_at desc);
create index if not exists task_holds_moving_idx on public.task_holds (status)
  where status in ('release_asked', 'refund_asked', 'split_asked', 'awaiting_payment');

alter table public.task_holds enable row level security;
drop policy if exists task_holds_party_read on public.task_holds;
create policy task_holds_party_read on public.task_holds
  for select to authenticated using (poster_id = auth.uid() or worker_id = auth.uid());
revoke all on public.task_holds from anon, authenticated;
-- Parties read through my_task_hold(), which leaves the provider ids out; no direct column grants.

-- Append-only record of every money event. Closes H34. user_id null = TaskDrop's own share.
create table if not exists public.money_ledger (
  id           bigint generated always as identity primary key,
  hold_id      uuid references public.task_holds (id) on delete set null,
  task_id      uuid references public.tasks (id) on delete set null,
  user_id      uuid references auth.users (id) on delete set null,
  kind         text not null check (kind in (
                 'paid', 'on_hold', 'hold_cancelled', 'released', 'fine_paid',
                 'refunded', 'service_fee', 'commission')),
  amount_minor bigint not null check (amount_minor >= 0),
  provider_ref text,
  idem_key     text not null unique,
  created_at   timestamptz not null default now()
);
comment on table public.money_ledger is
  'Plan B (195): append-only money record. idem_key makes every write happen once. Rows are never changed.';
create index if not exists money_ledger_user_idx on public.money_ledger (user_id, created_at desc);
create index if not exists money_ledger_day_idx on public.money_ledger (created_at);

create or replace function private.money_ledger_append_only()
returns trigger
language plpgsql
as $$
begin
  raise exception 'The money ledger is append-only';
end;
$$;
drop trigger if exists money_ledger_no_change on public.money_ledger;
create trigger money_ledger_no_change before update or delete on public.money_ledger
  for each row execute function private.money_ledger_append_only();

alter table public.money_ledger enable row level security;
drop policy if exists money_ledger_own_read on public.money_ledger;
create policy money_ledger_own_read on public.money_ledger
  for select to authenticated using (user_id = auth.uid());
revoke all on public.money_ledger from anon, authenticated;
grant select (id, hold_id, task_id, user_id, kind, amount_minor, created_at) on public.money_ledger to authenticated;

-- One row per nightly match of our ledger against the payment company's report.
create table if not exists public.money_match_runs (
  id             bigint generated always as identity primary key,
  day            date not null,
  provider       text not null,
  ours_minor     bigint not null,
  theirs_minor   bigint not null,
  diff_minor     bigint generated always as (theirs_minor - ours_minor) stored,
  ok             boolean generated always as (theirs_minor = ours_minor) stored,
  detail         jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  unique (day, provider)
);
alter table public.money_match_runs enable row level security;
revoke all on public.money_match_runs from anon, authenticated;

-- Each provider message is acted on once.
create table if not exists public.money_webhook_events (
  provider    text not null,
  event_id    text not null,
  kind        text not null,
  received_at timestamptz not null default now(),
  primary key (provider, event_id)
);
alter table public.money_webhook_events enable row level security;
revoke all on public.money_webhook_events from anon, authenticated;

-- ============================================================================= helpers ===

-- The amounts for an offer, in one place (packages/rules planBSplit does the same sums).
create or replace function private.plan_b_amounts(p_offer bigint)
returns table (charged bigint, fee bigint, commission bigint, worker_share bigint, fine bigint)
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_fee_pct  numeric := private.setting_num('poster_service_fee_pct', 0.03);
  v_comm_pct numeric := private.setting_num('worker_commission_pct', 0.20);
  v_fine_pct numeric := private.setting_num('post_start_cancel_penalty_pct', 0.05);
begin
  if p_offer is null or p_offer <= 0 then raise exception 'That offer has no valid price'; end if;
  charged := round(p_offer * (1 + v_fee_pct))::bigint;
  fee := charged - p_offer;
  commission := round(p_offer * v_comm_pct)::bigint;
  worker_share := least(greatest(p_offer - commission, 0), charged);
  fine := least(greatest(round(p_offer * v_fine_pct)::bigint, 0), charged);
  return next;
end;
$$;
revoke all on function private.plan_b_amounts(bigint) from public, anon, authenticated;

create or replace function private.ledger_add(p_hold public.task_holds, p_user uuid, p_kind text,
                                              p_amount bigint, p_key text, p_ref text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(p_amount, 0) <= 0 then return; end if;
  insert into public.money_ledger (hold_id, task_id, user_id, kind, amount_minor, provider_ref, idem_key)
  values (p_hold.id, p_hold.task_id, p_user, p_kind, p_amount, p_ref, p_key)
  on conflict (idem_key) do nothing;
end;
$$;
revoke all on function private.ledger_add(public.task_holds, uuid, text, bigint, text, text) from public, anon, authenticated;

create or replace function private.payee_ready(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (select 1 from public.payout_accounts a
                  where a.user_id = p_user and a.status = 'active'
                    and a.provider = private.money_provider());
$$;
revoke all on function private.payee_ready(uuid) from public, anon, authenticated;

-- The hold that decides a task's money right now: the live one, else the newest.
create or replace function private.task_hold(p_task_id uuid)
returns public.task_holds
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select h.* from public.task_holds h
   where h.task_id = p_task_id
   order by (h.status in ('awaiting_payment', 'held')) desc, h.created_at desc
   limit 1;
$$;
revoke all on function private.task_hold(uuid) from public, anon, authenticated;

-- Open a hold for a hire. Called by lock_bid and auto-hire under Plan B.
create or replace function private.plan_b_open_hold(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task   public.tasks;
  v_worker uuid;
  v_amt    record;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'That task no longer exists'; end if;
  select a.worker_id into v_worker from public.assignments a
   where a.task_id = p_task_id and a.status = 'assigned'
   order by a.created_at desc limit 1;
  if v_worker is null then raise exception 'No offer has been chosen on this task yet'; end if;
  if not private.payee_ready(v_worker) then
    raise exception 'This worker has not set up payments yet'
      using hint = 'They will be told. You can hire them once they add their bank or UPI.';
  end if;

  -- An unpaid hold left from an earlier hire ends here.
  update public.task_holds set status = 'expired', updated_at = now(), settled_at = now()
   where task_id = p_task_id and status = 'awaiting_payment';

  select * into v_amt from private.plan_b_amounts(v_task.locked_minor);
  insert into public.task_holds (task_id, poster_id, worker_id, provider, offer_minor, charged_minor,
                                 fee_minor, commission_minor, worker_share_minor, expires_at)
  values (p_task_id, v_task.poster_id, v_worker, private.money_provider(), v_task.locked_minor,
          v_amt.charged, v_amt.fee, v_amt.commission, v_amt.worker_share,
          now() + make_interval(hours => private.setting_num('plan_b_unpaid_hours', 24)::int));

  -- The worker's assignment carries the same figure lock_bid priced.
  update public.assignments set escrow_minor = v_amt.charged
   where task_id = p_task_id and worker_id = v_worker;
  return v_task;
end;
$$;
revoke all on function private.plan_b_open_hold(uuid) from public, anon, authenticated;

-- Ask for the worker's share to be released (approval, auto-complete, dispute won by the worker).
create or replace function private.plan_b_ask_release(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_hold public.task_holds;
begin
  select * into v_hold from public.task_holds
   where task_id = p_task_id and status = 'held' for update;
  if not found then raise exception 'The money for this task is not on hold'; end if;
  update public.task_holds
     set status = 'release_asked', release_minor = worker_share_minor, refund_minor = 0,
         release_key = 'release:' || id, asked_at = now(), updated_at = now()
   where id = v_hold.id;
  perform private.emit_event('money.move', jsonb_build_object('hold_id', v_hold.id, 'task_id', p_task_id, 'move', 'release'));
end;
$$;
revoke all on function private.plan_b_ask_release(uuid) from public, anon, authenticated;

-- Ask for money back. p_fine > 0 = cancelled after start: the fine goes to the worker, the rest back.
-- An unpaid hold simply ends.
create or replace function private.plan_b_ask_refund(p_task_id uuid, p_fine bigint default 0)
returns bigint
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_hold public.task_holds;
  v_fine bigint;
begin
  select * into v_hold from public.task_holds
   where task_id = p_task_id and status in ('awaiting_payment', 'held')
   order by created_at desc limit 1 for update;
  if not found then return 0; end if;

  if v_hold.status = 'awaiting_payment' then
    update public.task_holds set status = 'expired', settled_at = now(), updated_at = now() where id = v_hold.id;
    return 0;
  end if;

  v_fine := least(greatest(coalesce(p_fine, 0), 0), v_hold.charged_minor);
  update public.task_holds
     set status = case when v_fine > 0 then 'split_asked' else 'refund_asked' end,
         release_minor = v_fine,
         refund_minor = charged_minor - v_fine,
         release_key = case when v_fine > 0 then 'fine:' || id end,
         refund_key = 'refund:' || id,
         asked_at = now(), updated_at = now()
   where id = v_hold.id;
  perform private.emit_event('money.move', jsonb_build_object('hold_id', v_hold.id, 'task_id', p_task_id,
    'move', case when v_fine > 0 then 'split' else 'refund' end));
  return v_fine;
end;
$$;
revoke all on function private.plan_b_ask_refund(uuid, bigint) from public, anon, authenticated;

-- ====================================================================== the hire path ===

-- From 167, with one change at the end: under Plan B (or for a City Hunt accept) no wallet charge.
create or replace function public.lock_bid(p_bid_id uuid, p_payout_mode payout_mode, p_expected_price_minor bigint)
returns public.tasks
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_bid    public.bids;
  v_task   public.tasks;
  v_fee    numeric;
  v_escrow bigint;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into v_bid from public.bids where id = p_bid_id;
  if not found then raise exception 'Quote not found'; end if;

  select * into v_task from public.tasks where id = v_bid.task_id for update;
  if v_task.poster_id <> auth.uid() then raise exception 'Only the poster can lock a quote'; end if;
  if v_task.status <> 'OPEN' then raise exception 'This task is no longer open'; end if;

  -- B53: hold the offer still and read its price again, so an edit cannot slip in between.
  select * into v_bid from public.bids where id = p_bid_id for update;
  if not found then raise exception 'Quote not found'; end if;

  if v_bid.price_minor is null or v_bid.price_minor <= 0 then
    raise exception 'That quote has no valid price';
  end if;
  if p_expected_price_minor is not null and v_bid.price_minor <> p_expected_price_minor then
    raise exception 'The offer changed. Please review the new price.';
  end if;

  -- B61: no hiring across a block, and no hiring a suspended person.
  if private.blocked_between(v_task.poster_id, v_bid.worker_id) then
    raise exception 'You cannot hire this person.';
  end if;
  if exists (select 1 from public.user_suspensions s
              where s.user_id = v_bid.worker_id and s.lifted_at is null) then
    raise exception 'This worker cannot be hired right now.';
  end if;

  -- 195: under Plan B a City Hunt find is paid as it is accepted, which needs the hold to be paid
  -- first. Until that flow is built, say so plainly instead of half-accepting.
  if private.plan_b_on() and coalesce(current_setting('taskdrop.hunt_accept', true), '') <> '' then
    raise exception 'City Hunt finds cannot be accepted while payments move to pay-per-task. Try again soon.';
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(v_bid.price_minor * (1 + v_fee));
  if v_escrow <= 0 then raise exception 'That quote has no valid price'; end if;

  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, v_bid.id, v_bid.worker_id, v_escrow, p_payout_mode)
  on conflict (task_id, worker_id) do update
    set escrow_minor = excluded.escrow_minor, status = 'assigned', created_at = now();

  update public.bids set is_locked = true where id = v_bid.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = v_bid.id,
         locked_minor = v_bid.price_minor,
         payout_mode = p_payout_mode
   where id = v_task.id;

  -- 195: Plan B opens a hold and the poster pays for this task at the payment company next.
  if private.plan_b_on() then
    perform private.plan_b_open_hold(v_task.id);
    select * into v_task from public.tasks where id = v_task.id;
    return v_task;
  end if;

  return private.fund_task_from_wallet(v_task.id);
end $function$;

revoke all on function public.lock_bid(uuid, payout_mode, bigint) from public, anon;
grant execute on function public.lock_bid(uuid, payout_mode, bigint) to authenticated, service_role;

-- From 167, with: under Plan B, only a worker set up to be paid is auto-hired, and a hold is opened.
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
  v_planb  boolean := private.plan_b_on();
begin
  select * into v_task from public.tasks where id = new.task_id for update;
  if not found
     or v_task.assignment_mode <> 'auto'
     or v_task.status <> 'OPEN'
     or new.price_minor is null
     or new.price_minor <= 0
     or new.price_minor > v_task.benchmark_minor
     or private.blocked_between(v_task.poster_id, new.worker_id)
     or exists (select 1 from public.user_suspensions s
                 where s.user_id = new.worker_id and s.lifted_at is null)
     or (v_planb and not private.payee_ready(new.worker_id)) then
    return new;
  end if;

  v_fee := private.setting_num('poster_service_fee_pct', 0.03);
  v_escrow := round(new.price_minor * (1 + v_fee));
  v_mode := coalesce(v_task.payout_mode, 'one_time');

  if v_escrow <= 0
     or (not v_planb and v_task.funded_at is not null and private.task_paid_in_minor(v_task.id) < v_escrow) then
    return new;
  end if;

  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, payout_mode)
  values (v_task.id, new.id, new.worker_id, v_escrow, v_mode)
  on conflict (task_id, worker_id) do update
    set escrow_minor = excluded.escrow_minor, status = 'assigned', created_at = now();

  update public.bids set is_locked = true where id = new.id;

  update public.tasks
     set status = 'LOCKED',
         locked_bid_id = new.id,
         locked_minor = new.price_minor,
         payout_mode = v_mode
   where id = v_task.id;

  if v_planb then
    perform private.plan_b_open_hold(v_task.id);
    perform private.notify(v_task.poster_id, 'auto_locked', 'Offer accepted: pay to start',
      private.who(new.worker_id, 'The worker') || ' will do ' || private.label(v_task.title)
        || '. Pay for this task so they can start. The money is held until you approve.', v_task.id);
    return new;
  end if;

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

-- Top-ups and paying from the wallet stop under Plan B. Old leftover balances can still be withdrawn.
create or replace function public.pay_task_from_wallet(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_poster uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if private.plan_b_on() then
    raise exception 'Pay for this task at checkout. Paying from the wallet has closed.';
  end if;
  select poster_id into v_poster from public.tasks where id = p_task_id;
  if v_poster is null then raise exception 'That task no longer exists'; end if;
  if v_poster <> auth.uid() then raise exception 'Only the poster pays for a task'; end if;
  return private.fund_task_from_wallet(p_task_id);
end;
$fn$;
revoke all on function public.pay_task_from_wallet(uuid) from public, anon;
grant execute on function public.pay_task_from_wallet(uuid) to authenticated;

-- From 066, with: under Plan B a paid top-up is not credited (none can be started; the money
-- function refuses new top-up links). A stray one is left uncredited for staff to refund.
create or replace function public.credit_topup(p_payment_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_pay public.payments;
begin
  if private.plan_b_on() then return; end if;
  select * into v_pay from public.payments where id = p_payment_id for update;
  if not found or v_pay.purpose <> 'topup' or v_pay.status <> 'paid' then return; end if;
  if v_pay.credited_at is not null then return; end if;

  insert into public.wallets (user_id) values (v_pay.user_id) on conflict (user_id) do nothing;
  update public.wallets
     set balance_minor = balance_minor + v_pay.amount_minor, updated_at = now()
   where user_id = v_pay.user_id;
  update public.payments set credited_at = now() where id = p_payment_id;
end;
$fn$;
revoke all on function public.credit_topup(uuid) from public, anon, authenticated;
grant execute on function public.credit_topup(uuid) to service_role;

-- ================================================================ release and refund ===

-- From 148, with: a task paid under Plan B asks for a release instead of crediting a wallet.
create or replace function public.confirm_release(p_task_id uuid)
returns public.tasks
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_task       public.tasks;
  v_worker     uuid;
  v_escrow     bigint;
  v_commission numeric;
  v_clear_days numeric;
  v_net        bigint;
  v_hold       public.task_holds;
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

  select worker_id, escrow_minor into v_worker, v_escrow from public.assignments
   where task_id = p_task_id and status = 'started' limit 1;
  if v_worker is null then raise exception 'No active worker on this task'; end if;

  v_hold := private.task_hold(p_task_id);
  if v_hold.id is not null and v_hold.status = 'held' then
    perform private.plan_b_ask_release(p_task_id);
    update public.assignments set status = 'released'
     where task_id = p_task_id and worker_id = v_worker;
    -- cleared_at too: nothing went through a wallet, so the old clearing sweep must skip this task.
    update public.tasks
       set status = 'COMPLETED', completed_at = now(), clear_at = now(), cleared_at = now()
     where id = p_task_id
    returning * into v_task;
    return v_task;
  end if;

  v_commission := private.setting_num('worker_commission_pct', 0.20);
  v_clear_days := private.setting_num('clearing_period_days', 7);
  v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));
  v_net := private.cap_worker_net(p_task_id, v_net, v_escrow, v_task.locked_minor);

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
end $function$;

-- From 148, with the same Plan B branch.
create or replace function private.auto_complete_due()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task       record;
  v_worker     uuid;
  v_escrow     bigint;
  v_commission numeric := private.setting_num('worker_commission_pct', 0.20);
  v_clear_days numeric := private.setting_num('clearing_period_days', 7);
  v_net        bigint;
  v_count      integer := 0;
  v_hold       public.task_holds;
begin
  for v_task in
    select t.id, t.locked_minor
      from public.tasks t
     where t.status = 'WORK_DONE'
       and t.auto_complete_at is not null
       and t.auto_complete_at <= now()
       and t.funded_at is not null
     order by t.auto_complete_at
     for update skip locked
  loop
    v_worker := null;
    v_escrow := null;
    select a.worker_id, a.escrow_minor into v_worker, v_escrow from public.assignments a
     where a.task_id = v_task.id and a.status = 'started' limit 1;
    if v_worker is null then continue; end if;

    v_hold := private.task_hold(v_task.id);
    if v_hold.id is not null and v_hold.status = 'held' then
      perform private.plan_b_ask_release(v_task.id);
      update public.assignments set status = 'released' where task_id = v_task.id and worker_id = v_worker;
      update public.tasks
         set status = 'AUTO_COMPLETED', completed_at = now(), clear_at = now(), cleared_at = now()
       where id = v_task.id;
      v_count := v_count + 1;
      continue;
    end if;

    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));
    v_net := private.cap_worker_net(v_task.id, v_net, v_escrow, v_task.locked_minor);
    update public.wallets set clearing_minor = clearing_minor + v_net where user_id = v_worker;
    update public.assignments set status = 'released' where task_id = v_task.id and worker_id = v_worker;
    update public.tasks
       set status = 'AUTO_COMPLETED',
           completed_at = now(),
           clear_at = now() + (v_clear_days || ' days')::interval
     where id = v_task.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- From 128, with: a task with a Plan B hold asks for a refund (or the fine split) instead of
-- touching wallets; a walk-away refunds in full and the task opens unfunded.
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
  v_hold      public.task_holds;
  v_planb     boolean;
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
  v_hold := private.task_hold(p_task_id);
  v_planb := v_hold.id is not null and v_hold.status in ('awaiting_payment', 'held');

  -- ---- worker walks away: hand the task back to the market --------------
  if not v_is_poster then
    update public.assignments set status = 'refunded' where id = v_assign.id;
    update public.bids set is_locked = false where id = v_assign.bid_id;

    if v_planb then
      perform private.plan_b_ask_refund(p_task_id, 0);
      update public.tasks
         set status = 'OPEN', locked_bid_id = null, locked_minor = null, started_at = null,
             funded_at = null, funded_via = null, funded_minor = null
       where id = p_task_id
      returning * into v_task;
    else
      update public.tasks
         set status = 'OPEN',
             locked_bid_id = null,
             locked_minor = null,
             started_at = null
       where id = p_task_id
      returning * into v_task;
    end if;

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
      if v_fine > 0 and not v_planb then
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
      elsif v_fine > 0 then
        perform private.notify(
          v_assign.worker_id, 'cancel_fine',
          private.who(v_task.poster_id, 'The customer') || ' cancelled after you started',
          'You get ' || private.rupees(v_fine) || ' for your time on '
            || private.label(v_task.title) || '. It is being sent to your bank or UPI.',
          v_task.id);
      end if;
    end if;

    update public.assignments set status = 'refunded' where id = v_assign.id;
    update public.bids set is_locked = false where id = v_assign.bid_id;
  end if;

  if v_planb then
    v_fine := private.plan_b_ask_refund(p_task_id, v_fine);
  end if;

  update public.tasks
     set status = 'CANCELLED',
         completed_at = now()
   where id = p_task_id
  returning * into v_task;

  -- The wallet refund trigger reads penalty_or_refund_minor and returns the
  -- escrow less the fine (wallet-paid tasks only; it ignores Plan B ones).
  insert into public.cancellations_log
    (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
  values (p_task_id, 'poster', 'normal', v_phase, v_task.locked_minor, v_fine);

  return v_task;
end;
$$;

-- From 148, with: a Plan B task's dispute asks for a release (worker wins) or a full refund (poster
-- wins) at the payment company; nothing touches a wallet.
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
  v_hold       public.task_holds;
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

  v_hold := private.task_hold(p_task_id);

  if v_hold.id is not null and v_hold.status = 'held' then
    if p_outcome = 'worker' then
      if v_assign.id is null then raise exception 'No worker on this task to pay'; end if;
      perform private.plan_b_ask_release(p_task_id);
      v_net := v_hold.worker_share_minor;
      update public.assignments set status = 'released' where id = v_assign.id;
      update public.tasks
         set status = 'COMPLETED', completed_at = now(), clear_at = now(), cleared_at = now(), updated_at = now()
       where id = p_task_id;
    else
      perform private.plan_b_ask_refund(p_task_id, 0);
      v_back := v_hold.charged_minor;
      update public.assignments set status = 'refunded'
       where task_id = p_task_id and status in ('assigned', 'started');
      update public.tasks
         set status = 'CANCELLED', completed_at = now(), updated_at = now()
       where id = p_task_id;
      insert into public.cancellations_log (task_id, cancelled_by, reason, phase, locked_minor, penalty_or_refund_minor)
      values (p_task_id, 'poster', 'normal', 'DISPUTED', v_task.locked_minor, 0);
    end if;

    insert into public.dispute_decisions (task_id, decided_by, outcome, note, worker_paid_minor, poster_refunded_minor)
    values (p_task_id, auth.uid(), p_outcome, nullif(btrim(coalesce(p_note, '')), ''), v_net, v_back);
    select * into v_task from public.tasks where id = p_task_id;
    return v_task;
  end if;

  if p_outcome = 'worker' then
    if v_task.funded_at is null then
      raise exception 'Nothing was paid for this job, so there is nothing to pay the worker';
    end if;
    if v_assign.id is null then
      raise exception 'No worker on this task to pay';
    end if;

    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - private.setting_num('worker_commission_pct', 0.20)));
    -- Never more than the money paid in for this job covers.
    v_net := private.cap_worker_net(p_task_id, v_net, v_assign.escrow_minor, v_task.locked_minor);
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
revoke all on function public.admin_resolve_dispute(uuid, text, text) from public, anon;
grant execute on function public.admin_resolve_dispute(uuid, text, text) to authenticated;

-- From 128, with: a Plan B hold is refunded in full (TaskDrop's decision, no fine).
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

  -- 195: money held at the payment company goes back in full (an unpaid hold just ends).
  perform private.plan_b_ask_refund(p_task_id, 0);

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
revoke all on function public.admin_cancel_task_with_refund(uuid, text) from public, anon;
grant execute on function public.admin_cancel_task_with_refund(uuid, text) to authenticated;

-- ============================================== service-role calls (the money function) ===

-- What the money function needs to start the payment for a task. The caller must be its poster.
create or replace function public.plan_b_checkout_terms(p_task_id uuid, p_user uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hold public.task_holds;
  v_acc  public.payout_accounts;
  v_task public.tasks;
begin
  perform private.assert_service();
  select * into v_task from public.tasks where id = p_task_id;
  if not found then raise exception 'That task no longer exists'; end if;
  if v_task.poster_id <> p_user then raise exception 'Only the poster pays for a task'; end if;
  if private.money_paused() then
    raise exception 'Payments are paused for a few minutes. Nothing was charged. Please try again soon.';
  end if;
  select * into v_hold from public.task_holds where task_id = p_task_id and status in ('awaiting_payment', 'held')
   order by created_at desc limit 1;
  if not found then raise exception 'Hire someone first, then pay for the task'; end if;
  if v_hold.status = 'held' then
    return jsonb_build_object('hold_id', v_hold.id, 'status', 'held');
  end if;
  if v_hold.expires_at is not null and v_hold.expires_at < now() then
    raise exception 'This hire waited too long for payment. Choose the offer again.';
  end if;
  select * into v_acc from public.payout_accounts where user_id = v_hold.worker_id;
  if v_acc.status is distinct from 'active' or v_acc.provider <> v_hold.provider then
    raise exception 'This worker has not set up payments yet';
  end if;
  return jsonb_build_object(
    'hold_id', v_hold.id, 'status', v_hold.status, 'provider', v_hold.provider,
    'task_id', v_hold.task_id, 'task_title', left(coalesce(v_task.title, 'TaskDrop task'), 60),
    'charged_minor', v_hold.charged_minor, 'worker_share_minor', v_hold.worker_share_minor,
    'payee_account_id', v_acc.provider_account_id,
    'provider_order_id', v_hold.provider_order_id, 'checkout_url', v_hold.checkout_url,
    'hold_until', (now() + interval '45 days'));
end;
$$;
revoke all on function public.plan_b_checkout_terms(uuid, uuid) from public, anon, authenticated;
grant execute on function public.plan_b_checkout_terms(uuid, uuid) to service_role;

-- The payment company made an order for the hold: keep its id and checkout reference for re-use.
-- The first order wins: if two taps made two orders, both callers get the first one back, so the
-- poster is only ever shown one order to pay.
create or replace function public.plan_b_set_order(p_hold_id uuid, p_order_id text, p_checkout_url text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hold public.task_holds;
begin
  perform private.assert_service();
  update public.task_holds
     set provider_order_id = p_order_id, checkout_url = left(p_checkout_url, 1000), updated_at = now()
   where id = p_hold_id and status = 'awaiting_payment' and provider_order_id is null;
  select * into v_hold from public.task_holds where id = p_hold_id;
  return jsonb_build_object('order_id', v_hold.provider_order_id, 'checkout_url', v_hold.checkout_url,
                            'status', v_hold.status);
end;
$$;
revoke all on function public.plan_b_set_order(uuid, text, text) from public, anon, authenticated;
grant execute on function public.plan_b_set_order(uuid, text, text) to service_role;

-- The payment company says it has the money. Safe to call any number of times.
-- Returns 'held', 'already', 'amount_mismatch', 'refund' (paid for a hire that had ended) or 'unknown'.
create or replace function public.plan_b_mark_paid(p_order_id text, p_payment_id text, p_transfer_id text, p_amount_minor bigint)
returns text
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_hold    public.task_holds;
  v_task    public.tasks;
  v_task_id uuid;
begin
  perform private.assert_service();
  -- Lock the task before the hold, in the same order cancel_task and confirm_release use.
  select h.task_id into v_task_id from public.task_holds h where h.provider_order_id = p_order_id;
  if v_task_id is null then return 'unknown'; end if;
  select * into v_task from public.tasks where id = v_task_id for update;
  select * into v_hold from public.task_holds where provider_order_id = p_order_id for update;
  if v_hold.status not in ('awaiting_payment', 'expired') then return 'already'; end if;

  if p_amount_minor is distinct from v_hold.charged_minor then
    update public.task_holds
       set note = 'amount_mismatch: paid ' || coalesce(p_amount_minor::text, 'null'),
           provider_payment_id = coalesce(provider_payment_id, p_payment_id), updated_at = now()
     where id = v_hold.id;
    return 'amount_mismatch';
  end if;

  -- Paid for a hire that ended meanwhile (expired, cancelled, re-hired): send it all straight back.
  -- This hold never becomes 'held', so it cannot clash with a newer hire's live hold.
  if v_hold.status <> 'awaiting_payment' or v_task.id is null or v_task.status <> 'LOCKED'
     or v_task.funded_at is not null
     or not exists (select 1 from public.assignments a
                     where a.task_id = v_task.id and a.worker_id = v_hold.worker_id and a.status = 'assigned') then
    update public.task_holds
       set status = 'refund_asked', paid_at = now(), provider_payment_id = p_payment_id,
           provider_transfer_id = coalesce(p_transfer_id, provider_transfer_id),
           release_minor = 0, refund_minor = charged_minor, refund_key = 'refund:' || id,
           asked_at = now(), settled_at = null, updated_at = now()
     where id = v_hold.id
    returning * into v_hold;
    perform private.ledger_add(v_hold, v_hold.poster_id, 'paid', v_hold.charged_minor, 'paid:' || v_hold.id, p_payment_id);
    perform private.ledger_add(v_hold, v_hold.worker_id, 'on_hold', v_hold.worker_share_minor, 'on_hold:' || v_hold.id, p_transfer_id);
    perform private.emit_event('money.move', jsonb_build_object('hold_id', v_hold.id, 'task_id', v_hold.task_id, 'move', 'refund'));
    return 'refund';
  end if;

  update public.task_holds
     set status = 'held', paid_at = now(), provider_payment_id = p_payment_id,
         provider_transfer_id = coalesce(p_transfer_id, provider_transfer_id), updated_at = now()
   where id = v_hold.id
  returning * into v_hold;
  perform private.ledger_add(v_hold, v_hold.poster_id, 'paid', v_hold.charged_minor, 'paid:' || v_hold.id, p_payment_id);
  perform private.ledger_add(v_hold, v_hold.worker_id, 'on_hold', v_hold.worker_share_minor, 'on_hold:' || v_hold.id, p_transfer_id);

  update public.tasks
     set funded_at = now(), funded_via = 'payment', funded_minor = v_hold.charged_minor, updated_at = now()
   where id = v_task.id;

  perform private.notify(v_hold.worker_id, 'task_funded', 'Paid and held: you can start',
    'The payment for ' || private.label(v_task.title) || ' is held safely until the work is approved.', v_task.id);
  return 'held';
end;
$$;
revoke all on function public.plan_b_mark_paid(text, text, text, bigint) from public, anon, authenticated;
grant execute on function public.plan_b_mark_paid(text, text, text, bigint) to service_role;

-- Claim the next outside call for a hold, for ten minutes. Returns null when there is nothing to do
-- (already done, someone else has it, or releases are paused). Refunds run even when paused.
create or replace function public.plan_b_claim_move(p_hold_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_hold public.task_holds;
  v_part text;
  v_acc  public.payout_accounts;
begin
  perform private.assert_service();
  select * into v_hold from public.task_holds where id = p_hold_id for update;
  if not found or v_hold.status not in ('release_asked', 'refund_asked', 'split_asked') then return null; end if;
  if v_hold.moving_until is not null and v_hold.moving_until > now() then return null; end if;

  -- A split refunds first (money back to the poster never waits on the stop), then pays the fine.
  v_part := case
    when v_hold.status = 'release_asked' then 'release'
    when v_hold.status = 'refund_asked' then 'refund'
    when v_hold.refund_ref is null then 'refund'
    else 'release' end;
  if v_part = 'release' and private.money_paused() then return null; end if;

  select * into v_acc from public.payout_accounts where user_id = v_hold.worker_id;
  update public.task_holds set moving_until = now() + interval '10 minutes', attempts = attempts + 1, updated_at = now()
   where id = v_hold.id;
  return jsonb_build_object(
    'hold_id', v_hold.id, 'part', v_part, 'provider', v_hold.provider, 'status', v_hold.status,
    'amount_minor', case when v_part = 'release' then v_hold.release_minor else v_hold.refund_minor end,
    'charged_minor', v_hold.charged_minor, 'worker_share_minor', v_hold.worker_share_minor,
    'key', case when v_part = 'release' then v_hold.release_key else v_hold.refund_key end,
    'provider_order_id', v_hold.provider_order_id, 'provider_payment_id', v_hold.provider_payment_id,
    'provider_transfer_id', v_hold.provider_transfer_id, 'payee_account_id', v_acc.provider_account_id);
end;
$$;
revoke all on function public.plan_b_claim_move(uuid) from public, anon, authenticated;
grant execute on function public.plan_b_claim_move(uuid) to service_role;

-- Record what the payment company said about a claimed move. ok = false marks the hold failed for
-- a person to look at (staff retry with plan_b_retry_move).
create or replace function public.plan_b_record_move(p_hold_id uuid, p_part text, p_ok boolean, p_ref text, p_note text default null)
returns text
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_hold  public.task_holds;
  v_title text;
begin
  perform private.assert_service();
  if p_part not in ('release', 'refund') then raise exception 'part is release or refund'; end if;
  select * into v_hold from public.task_holds where id = p_hold_id for update;
  if not found then raise exception 'That hold does not exist'; end if;
  if v_hold.status not in ('release_asked', 'refund_asked', 'split_asked') then return v_hold.status; end if;
  select left(t.title, 60) into v_title from public.tasks t where t.id = v_hold.task_id;

  if not coalesce(p_ok, false) then
    update public.task_holds
       set failed_from = status, status = 'failed', moving_until = null,
           note = left(coalesce(p_note, 'The payment company refused'), 300), updated_at = now()
     where id = v_hold.id;
    perform private.emit_event('money.move_failed', jsonb_build_object('hold_id', v_hold.id, 'task_id', v_hold.task_id, 'part', p_part));
    return 'failed';
  end if;

  if p_part = 'release' then
    update public.task_holds set release_ref = coalesce(release_ref, p_ref), moving_until = null, updated_at = now()
     where id = v_hold.id returning * into v_hold;
    if v_hold.status = 'release_asked' then
      perform private.ledger_add(v_hold, v_hold.worker_id, 'released', v_hold.release_minor, 'released:' || v_hold.id, p_ref);
      perform private.ledger_add(v_hold, null, 'service_fee', v_hold.fee_minor, 'service_fee:' || v_hold.id, null);
      perform private.ledger_add(v_hold, null, 'commission', v_hold.charged_minor - v_hold.fee_minor - v_hold.release_minor,
                                 'commission:' || v_hold.id, null);
      perform private.notify(v_hold.worker_id, 'money_released', 'Your money is on its way',
        private.rupees(v_hold.release_minor) || ' for ' || private.label(v_title) || ' was sent to your bank or UPI.', v_hold.task_id);
    else
      perform private.ledger_add(v_hold, v_hold.worker_id, 'fine_paid', v_hold.release_minor, 'fine_paid:' || v_hold.id, p_ref);
    end if;
  else
    update public.task_holds set refund_ref = coalesce(refund_ref, p_ref), moving_until = null, updated_at = now()
     where id = v_hold.id returning * into v_hold;
    perform private.ledger_add(v_hold, v_hold.poster_id, 'refunded', v_hold.refund_minor, 'refunded:' || v_hold.id, p_ref);
    perform private.ledger_add(v_hold, v_hold.worker_id, 'hold_cancelled', v_hold.worker_share_minor, 'hold_cancelled:' || v_hold.id, null);
    perform private.notify(v_hold.poster_id, 'money_refunded', 'Your money is coming back',
      private.rupees(v_hold.refund_minor) || ' for ' || private.label(v_title) || ' is going back to the card or UPI you paid with.', v_hold.task_id);
  end if;

  -- Finished?
  if v_hold.status = 'release_asked' then
    update public.task_holds set status = 'released', settled_at = now(), updated_at = now() where id = v_hold.id;
    return 'released';
  elsif v_hold.status = 'refund_asked' then
    update public.task_holds set status = 'refunded', settled_at = now(), updated_at = now() where id = v_hold.id;
    return 'refunded';
  elsif v_hold.release_ref is not null and v_hold.refund_ref is not null then
    update public.task_holds set status = 'split', settled_at = now(), updated_at = now() where id = v_hold.id;
    return 'split';
  end if;
  return v_hold.status; -- a split with one half still to go
end;
$$;
revoke all on function public.plan_b_record_move(uuid, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.plan_b_record_move(uuid, text, boolean, text, text) to service_role;

-- Holds whose move is waiting (for the 10-minute Inngest sweep), and unpaid hires that ran out.
create or replace function public.plan_b_moves_due(p_limit integer default 50)
returns setof uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform private.assert_service();
  return query
    select h.id from public.task_holds h
     where h.status in ('release_asked', 'refund_asked', 'split_asked')
       and (h.moving_until is null or h.moving_until < now())
     order by h.asked_at nulls first
     limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;
revoke all on function public.plan_b_moves_due(integer) from public, anon, authenticated;
grant execute on function public.plan_b_moves_due(integer) to service_role;

create or replace function public.plan_b_expire_unpaid()
returns integer
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_hold  record;
  v_count integer := 0;
begin
  perform private.assert_service();
  for v_hold in
    select h.id, h.task_id, h.worker_id, h.poster_id from public.task_holds h
     where h.status = 'awaiting_payment' and h.expires_at < now()
     for update skip locked
  loop
    update public.task_holds set status = 'expired', settled_at = now(), updated_at = now() where id = v_hold.id;
    update public.assignments set status = 'refunded'
     where task_id = v_hold.task_id and worker_id = v_hold.worker_id and status = 'assigned';
    update public.bids set is_locked = false where task_id = v_hold.task_id and worker_id = v_hold.worker_id;
    update public.tasks set status = 'OPEN', locked_bid_id = null, locked_minor = null
     where id = v_hold.task_id and status = 'LOCKED' and funded_at is null;
    perform private.notify(v_hold.poster_id, 'hire_expired', 'Your hire waited too long',
      'Nobody paid for this task within a day, so it is open for offers again.', v_hold.task_id);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function public.plan_b_expire_unpaid() from public, anon, authenticated;
grant execute on function public.plan_b_expire_unpaid() to service_role;

-- A worker's payee account, written by the money function after the payment company answered.
create or replace function public.plan_b_save_payee(p_user uuid, p_provider text, p_account_id text,
                                                    p_status text, p_method text, p_hint text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform private.assert_service();
  insert into public.payout_accounts as a (user_id, provider, provider_account_id, status, method, method_hint, status_note)
  values (p_user, p_provider, p_account_id, p_status, p_method, left(p_hint, 24), left(p_note, 200))
  on conflict (user_id) do update
    set provider = excluded.provider, provider_account_id = excluded.provider_account_id,
        status = excluded.status, method = coalesce(excluded.method, a.method),
        method_hint = coalesce(excluded.method_hint, a.method_hint),
        status_note = excluded.status_note, updated_at = now();
end;
$$;
revoke all on function public.plan_b_save_payee(uuid, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.plan_b_save_payee(uuid, text, text, text, text, text, text) to service_role;

-- A provider webhook said a payee account changed.
create or replace function public.plan_b_payee_status(p_provider text, p_account_id text, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  perform private.assert_service();
  if p_status not in ('pending', 'active', 'rejected', 'suspended') then raise exception 'Unknown payee status'; end if;
  update public.payout_accounts
     set status = p_status, status_note = left(p_note, 200), updated_at = now()
   where provider = p_provider and provider_account_id = p_account_id;
end;
$$;
revoke all on function public.plan_b_payee_status(text, text, text, text) from public, anon, authenticated;
grant execute on function public.plan_b_payee_status(text, text, text, text) to service_role;

-- A provider message is acted on once. Returns false for a repeat.
create or replace function public.plan_b_first_webhook(p_provider text, p_event_id text, p_kind text)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rows integer;
begin
  perform private.assert_service();
  insert into public.money_webhook_events (provider, event_id, kind) values (p_provider, p_event_id, left(p_kind, 60))
  on conflict do nothing;
  get diagnostics v_rows = row_count;
  return v_rows = 1;
end;
$$;
revoke all on function public.plan_b_first_webhook(text, text, text) from public, anon, authenticated;
grant execute on function public.plan_b_first_webhook(text, text, text) to service_role;

-- The nightly match. ours = what our ledger says was paid in that day (IST).
create or replace function public.record_money_match(p_day date, p_provider text, p_theirs_minor bigint, p_detail jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_ours bigint;
  v_row  public.money_match_runs;
begin
  perform private.assert_service();
  select coalesce(sum(l.amount_minor), 0) into v_ours
    from public.money_ledger l join public.task_holds h on h.id = l.hold_id
   where l.kind = 'paid' and h.provider = p_provider
     and (l.created_at at time zone 'Asia/Kolkata')::date = p_day;
  insert into public.money_match_runs (day, provider, ours_minor, theirs_minor, detail)
  values (p_day, p_provider, v_ours, coalesce(p_theirs_minor, 0), coalesce(p_detail, '{}'::jsonb))
  on conflict (day, provider) do update
    set ours_minor = excluded.ours_minor, theirs_minor = excluded.theirs_minor, detail = excluded.detail, created_at = now()
  returning * into v_row;
  if not v_row.ok then
    perform private.emit_event('money.mismatch', jsonb_build_object('day', p_day, 'provider', p_provider,
      'ours_minor', v_row.ours_minor, 'theirs_minor', v_row.theirs_minor));
  end if;
  return to_jsonb(v_row);
end;
$$;
revoke all on function public.record_money_match(date, text, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.record_money_match(date, text, bigint, jsonb) to service_role;

-- Which flow and provider run now (for the money function).
create or replace function public.plan_b_config()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select jsonb_build_object('flow', case when private.plan_b_on() then 'plan_b' else 'wallet' end,
                            'provider', private.money_provider(),
                            'paused', private.money_paused(),
                            'environment', coalesce((select c.environment from public.app_controls c where c.platform = 'all'), 'staging'));
$$;
revoke all on function public.plan_b_config() from public, anon, authenticated;
grant execute on function public.plan_b_config() to service_role;

-- ================================================================== reads for the app ===

-- Which money flow the app should show. No provider ids, no secrets.
create or replace function public.my_money_mode()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
  select jsonb_build_object(
    'flow', case when private.plan_b_on() then 'plan_b' else 'wallet' end,
    'provider', private.money_provider(),
    'paused', private.money_paused(),
    'payee', (select jsonb_build_object('status', a.status, 'method', a.method, 'hint', a.method_hint, 'note', a.status_note)
                from public.payout_accounts a where a.user_id = auth.uid()));
$$;
revoke all on function public.my_money_mode() from public, anon;
grant execute on function public.my_money_mode() to authenticated;

-- The hold on one task, for its poster or worker. Provider ids stay on the server.
create or replace function public.my_task_hold(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_hold public.task_holds;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  v_hold := private.task_hold(p_task_id);
  if v_hold.id is null or auth.uid() not in (v_hold.poster_id, v_hold.worker_id) then return null; end if;
  return jsonb_build_object(
    'status', case when v_hold.status = 'failed' then v_hold.failed_from else v_hold.status end,
    'stuck', v_hold.status = 'failed',
    'offer_minor', v_hold.offer_minor, 'charged_minor', v_hold.charged_minor, 'fee_minor', v_hold.fee_minor,
    'worker_share_minor', v_hold.worker_share_minor,
    'release_minor', v_hold.release_minor, 'refund_minor', v_hold.refund_minor,
    'expires_at', v_hold.expires_at, 'paid_at', v_hold.paid_at, 'settled_at', v_hold.settled_at,
    'provider', v_hold.provider, 'mine', case when auth.uid() = v_hold.poster_id then 'poster' else 'worker' end);
end;
$$;
revoke all on function public.my_task_hold(uuid) from public, anon;
grant execute on function public.my_task_hold(uuid) to authenticated;

-- The Money screen: each task's money for this person, newest first, plus totals.
create or replace function public.my_money_ledger(p_limit integer default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return jsonb_build_object(
    'totals', (select jsonb_build_object(
        'paid_minor', coalesce(sum(l.amount_minor) filter (where l.kind = 'paid'), 0),
        'refunded_minor', coalesce(sum(l.amount_minor) filter (where l.kind = 'refunded'), 0),
        'released_minor', coalesce(sum(l.amount_minor) filter (where l.kind in ('released', 'fine_paid')), 0))
      from public.money_ledger l where l.user_id = v_me),
    'on_hold_for_me_minor', (select coalesce(sum(h.worker_share_minor), 0) from public.task_holds h
       where h.worker_id = v_me and h.status in ('held', 'release_asked')),
    'my_money_held_minor', (select coalesce(sum(h.charged_minor), 0) from public.task_holds h
       where h.poster_id = v_me and h.status = 'held'),
    'rows', coalesce((select jsonb_agg(r order by r.created_at desc) from (
        select l.kind, l.amount_minor, l.created_at, l.task_id, left(t.title, 80) as task_title
          from public.money_ledger l left join public.tasks t on t.id = l.task_id
         where l.user_id = v_me
         order by l.created_at desc
         limit greatest(1, least(coalesce(p_limit, 100), 300))) r), '[]'::jsonb));
end;
$$;
revoke all on function public.my_money_ledger(integer) from public, anon;
grant execute on function public.my_money_ledger(integer) to authenticated;

-- ===================================================================== admin controls ===

-- The emergency stop for money. Admin role, authenticator code, a reason, an audit row.
create or replace function public.admin_set_money_paused(p_paused boolean, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_claims jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_mfa    boolean;
begin
  if not private.is_admin() or not private.staff_can(auth.uid(), 'admin') then
    raise exception 'Only a full admin can stop or start money' using errcode = '42501';
  end if;
  select s.value = 'true'::jsonb into v_mfa from public.settings s where s.key = 'admin_require_mfa';
  if coalesce(v_mfa, true) and coalesce(v_claims ->> 'aal', '') <> 'aal2' then
    raise exception 'Verify your authenticator code first (Security page in the admin panel)' using errcode = '42501';
  end if;
  if p_paused is null then raise exception 'Say on or off'; end if;
  if nullif(btrim(coalesce(p_reason, '')), '') is null then raise exception 'Give a reason'; end if;

  insert into public.settings (key, value) values ('money_paused', to_jsonb(p_paused))
  on conflict (key) do update set value = excluded.value, updated_at = now();

  perform public.admin_log_event(case when p_paused then 'money_paused' else 'money_resumed' end,
    'settings:money_paused', left('reason: ' || btrim(p_reason), 300));
  return jsonb_build_object('paused', p_paused, 'at', now());
end;
$$;
revoke all on function public.admin_set_money_paused(boolean, text) from public, anon;
grant execute on function public.admin_set_money_paused(boolean, text) to authenticated;

-- What the admin Money page shows: the switch, the waiting and stuck holds, the last matches.
create or replace function public.admin_plan_b_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.assert_not_money_blind();
  perform private.assert_money_staff();
  return jsonb_build_object(
    'flow', case when private.plan_b_on() then 'plan_b' else 'wallet' end,
    'provider', private.money_provider(),
    'paused', private.money_paused(),
    'paused_since', (select s.updated_at from public.settings s where s.key = 'money_paused'),
    'counts', (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                 from (select status, count(*) n from public.task_holds group by status) c),
    'held_minor', (select coalesce(sum(charged_minor), 0) from public.task_holds where status in ('held', 'release_asked', 'refund_asked', 'split_asked', 'failed')),
    'stuck', coalesce((select jsonb_agg(jsonb_build_object('hold_id', h.id, 'task_id', h.task_id, 'from', h.failed_from,
                         'note', h.note, 'attempts', h.attempts, 'updated_at', h.updated_at) order by h.updated_at desc)
                  from public.task_holds h where h.status = 'failed'), '[]'::jsonb),
    'matches', coalesce((select jsonb_agg(to_jsonb(m) order by m.day desc)
                  from (select * from public.money_match_runs order by day desc limit 14) m), '[]'::jsonb));
end;
$$;
revoke all on function public.admin_plan_b_overview() from public, anon;
grant execute on function public.admin_plan_b_overview() to authenticated;

-- Staff send a failed move again after fixing its cause. Money staff, audited.
create or replace function public.admin_plan_b_retry_move(p_hold_id uuid, p_reason text)
returns text
language plpgsql
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
declare
  v_hold public.task_holds;
begin
  perform private.assert_not_money_blind();
  perform private.assert_money_staff();
  select * into v_hold from public.task_holds where id = p_hold_id for update;
  if not found or v_hold.status <> 'failed' or v_hold.failed_from is null then
    raise exception 'That hold is not waiting for a retry';
  end if;
  update public.task_holds set status = failed_from, failed_from = null, moving_until = null, updated_at = now()
   where id = p_hold_id;
  perform private.emit_event('money.move', jsonb_build_object('hold_id', p_hold_id, 'task_id', v_hold.task_id, 'move', 'retry'));
  perform public.admin_log_event('money_move_retry', 'task_holds:' || p_hold_id,
    left('reason: ' || coalesce(nullif(btrim(p_reason), ''), 'none given'), 300));
  return v_hold.failed_from;
end;
$$;
revoke all on function public.admin_plan_b_retry_move(uuid, text) from public, anon;
grant execute on function public.admin_plan_b_retry_move(uuid, text) to authenticated;
