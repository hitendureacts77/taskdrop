-- A task now has to be paid for before anyone works on it.
--
-- Until this migration, nothing in the money path ever read the payments
-- table. lock_bid wrote an escrow_minor figure, the app opened a Razorpay
-- page, and whether anyone actually paid was never checked again -- so a task
-- could be locked, started, finished and released to a worker with nothing
-- collected. The live database already showed four tasks "released" worth
-- 8,200 rupees against zero settled payments.
--
-- This is the rule every marketplace that holds money works to, Fiverr
-- included: the order does not begin until the buyer's money is in.

alter table public.tasks
  add column if not exists funded_at timestamptz,
  add column if not exists funding_payment_id uuid references public.payments (id);

comment on column public.tasks.funded_at is
  'When escrow for this task was actually paid. Null means no money has been collected, whatever the status says.';

create index if not exists tasks_awaiting_funding_idx
  on public.tasks (status, funded_at)
  where funded_at is null;

-- Mark a task as funded, having checked that it really was. Called by the app
-- after a payment settles; funding twice is a no-op rather than an error.
create or replace function public.fund_task(p_task_id uuid, p_payment_id uuid)
returns public.tasks
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me uuid := auth.uid();
  v_task public.tasks;
  v_payment public.payments;
  v_escrow bigint;
begin
  if v_me is null then raise exception 'Not signed in'; end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'That task no longer exists'; end if;
  if v_task.poster_id <> v_me then raise exception 'Only the poster funds a task'; end if;

  -- Already funded: say yes rather than fail, so a retry or a second poll is
  -- harmless. Money is never counted twice because funded_at is only set once.
  if v_task.funded_at is not null then return v_task; end if;

  select * into v_payment from public.payments where id = p_payment_id;
  if not found then raise exception 'That payment does not exist'; end if;
  if v_payment.user_id <> v_me then raise exception 'That payment is not yours'; end if;
  if v_payment.status <> 'paid' then raise exception 'That payment has not settled yet'; end if;
  if v_payment.purpose <> 'escrow' then raise exception 'That payment was not for escrow'; end if;
  -- A top-up for one task must not be able to fund another.
  if v_payment.task_id is distinct from p_task_id then
    raise exception 'That payment was raised for a different task';
  end if;

  select a.escrow_minor into v_escrow from public.assignments a
   where a.task_id = p_task_id order by a.created_at desc limit 1;
  if v_escrow is null then raise exception 'No quote has been locked on this task yet'; end if;
  -- Underpaying must not fund the task. Overpaying is left alone; refunding a
  -- difference is an operator decision, not something to guess at.
  if v_payment.amount_minor < v_escrow then
    raise exception 'That payment does not cover the escrow for this task';
  end if;

  update public.tasks
     set funded_at = now(), funding_payment_id = p_payment_id, updated_at = now()
   where id = p_task_id returning * into v_task;

  return v_task;
end;
$fn$;

revoke all on function public.fund_task(uuid, uuid) from public, anon;
grant execute on function public.fund_task(uuid, uuid) to authenticated;

-- Funding must not depend on the payer still having the app open. fund_task
-- reads auth.uid(), which is useless to the webhook: Razorpay has no Supabase
-- session. Same checks, owner derived from the payment rather than the caller.
create or replace function public.fund_task_from_payment(p_payment_id uuid)
returns public.tasks
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_payment public.payments;
  v_task public.tasks;
  v_escrow bigint;
begin
  -- Service role only. This one cannot check a user, so it checks the role.
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and current_user <> 'service_role' and current_user <> 'postgres' then
    raise exception 'not authorised';
  end if;

  select * into v_payment from public.payments where id = p_payment_id;
  if not found then raise exception 'That payment does not exist'; end if;
  if v_payment.status <> 'paid' or v_payment.purpose <> 'escrow' then return null; end if;
  if v_payment.task_id is null then return null; end if;

  select * into v_task from public.tasks where id = v_payment.task_id for update;
  if not found then return null; end if;
  if v_task.poster_id <> v_payment.user_id then
    raise exception 'That payment was not made by the poster of this task';
  end if;
  if v_task.funded_at is not null then return v_task; end if;

  select a.escrow_minor into v_escrow from public.assignments a
   where a.task_id = v_task.id order by a.created_at desc limit 1;
  -- Under the agreed escrow, or no quote locked yet: leave it unfunded so a
  -- person looks at it, rather than quietly starting work on short money.
  if v_escrow is null or v_payment.amount_minor < v_escrow then return v_task; end if;

  update public.tasks
     set funded_at = now(), funding_payment_id = p_payment_id, updated_at = now()
   where id = v_task.id returning * into v_task;

  return v_task;
end;
$fn$;

revoke all on function public.fund_task_from_payment(uuid) from public, anon, authenticated;
grant execute on function public.fund_task_from_payment(uuid) to service_role;
