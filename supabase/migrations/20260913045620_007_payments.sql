-- ===========================================================================
-- Payments (migration 007)
-- One row per Razorpay payment link: funding a task's escrow, or topping up
-- the wallet. Only the Edge Function (service role) writes here; users can read
-- their own rows so the app can show status.
-- ===========================================================================
create type payment_purpose as enum ('escrow', 'topup');
create type payment_status  as enum ('created', 'paid', 'failed', 'cancelled');

create table public.payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  task_id       uuid references public.tasks(id) on delete set null,
  purpose       payment_purpose not null,
  amount_minor  bigint not null check (amount_minor > 0),
  status        payment_status not null default 'created',
  provider      text not null default 'razorpay',
  provider_ref  text,                 -- Razorpay payment-link id
  link_url      text,
  paid_at       timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index payments_user_idx on public.payments(user_id, created_at desc);
create index payments_ref_idx  on public.payments(provider_ref);

create trigger trg_payments_updated before update on public.payments
  for each row execute function public.set_updated_at();

alter table public.payments enable row level security;

-- Users read their own payments; all writes happen server-side.
create policy payments_select_own on public.payments
  for select using ((select auth.uid()) = user_id);
