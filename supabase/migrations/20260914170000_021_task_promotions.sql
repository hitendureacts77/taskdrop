-- Paid placement.
--
-- The Promote screen collected a budget and a duration, said "Campaign live ·
-- sponsored placement", and wrote nothing anywhere. Nothing was charged and no
-- listing was ever promoted. This is the table that makes it real.
--
-- A promotion is only active once its payment has settled, so the row starts
-- as 'pending' and the payment flow moves it on. That ordering matters: the
-- alternative is free advertising for anyone who abandons the payment page.
create table if not exists public.task_promotions (
  id            uuid primary key default gen_random_uuid(),
  task_id       uuid not null references public.tasks (id) on delete cascade,
  user_id       uuid not null references auth.users (id) on delete cascade,
  amount_minor  bigint not null check (amount_minor > 0),
  days          integer not null check (days between 1 and 30),
  status        text not null default 'pending'
                check (status in ('pending', 'active', 'expired', 'cancelled')),
  payment_id    uuid references public.payments (id) on delete set null,
  starts_at     timestamptz,
  ends_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists task_promotions_task_idx
  on public.task_promotions (task_id, status);
create index if not exists task_promotions_user_idx
  on public.task_promotions (user_id, created_at desc);
-- The feed asks "which tasks are promoted right now"; this answers it directly.
create index if not exists task_promotions_live_idx
  on public.task_promotions (status, ends_at)
  where status = 'active';

alter table public.task_promotions enable row level security;

-- You can see your own campaigns. Nobody needs to read anyone else's: the feed
-- learns what is sponsored from the view below, not from this table.
drop policy if exists "promotions: own reads" on public.task_promotions;
create policy "promotions: own reads"
  on public.task_promotions for select to authenticated
  using (user_id = (select auth.uid()));

-- Writes go through the RPCs only, exactly like payouts. No INSERT/UPDATE
-- policy exists on purpose: a client that could insert its own 'active' row
-- would be giving itself free placement.

-- Which tasks are sponsored at this moment, readable by anyone signed in.
-- A view rather than the table itself, so the feed can mark a card sponsored
-- without being able to read who paid what.
create or replace view public.sponsored_tasks
with (security_invoker = false) as
  select distinct p.task_id
  from public.task_promotions p
  where p.status = 'active'
    and p.starts_at <= now()
    and p.ends_at > now();

revoke all on public.sponsored_tasks from anon;
grant select on public.sponsored_tasks to authenticated;
