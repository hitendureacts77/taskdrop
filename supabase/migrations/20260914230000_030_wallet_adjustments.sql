-- A record of every time the business changes someone's balance by hand.
--
-- Correcting a wallet is not something to do silently. If a worker ever asks
-- why their clearing balance dropped, the answer has to exist somewhere, and
-- it has to be specific enough to reverse.
create table if not exists public.wallet_adjustments (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users (id) on delete cascade,
  -- Negative removes money, positive adds it.
  delta_minor     bigint not null,
  balance_before  bigint not null,
  clearing_before bigint not null,
  reason          text not null,
  created_at      timestamptz not null default now()
);

create index if not exists wallet_adjustments_user_idx
  on public.wallet_adjustments (user_id, created_at desc);

alter table public.wallet_adjustments enable row level security;

-- You can see what was done to your own wallet. That is the point of keeping it.
drop policy if exists "adjustments: own" on public.wallet_adjustments;
create policy "adjustments: own"
  on public.wallet_adjustments for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "adjustments: admin reads" on public.wallet_adjustments;
create policy "adjustments: admin reads"
  on public.wallet_adjustments for select to authenticated
  using (private.is_admin());

-- No INSERT or UPDATE policy: rows are written by migrations and the service
-- role. A ledger anyone can edit is not a ledger.
