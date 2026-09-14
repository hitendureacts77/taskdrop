-- 013_payout_destination
--
-- The withdraw screen showed a hardcoded UPI handle and handed that same
-- invented string to request_withdrawal, so every payout row recorded a
-- destination belonging to nobody. It has to be the user's own; profiles
-- already restricts updates to the owner, so it belongs there.
alter table public.profiles
  add column if not exists payout_upi text;

-- A UPI handle is always name@bank.
alter table public.profiles
  drop constraint if exists profiles_payout_upi_shape;
alter table public.profiles
  add constraint profiles_payout_upi_shape
  check (payout_upi is null or payout_upi ~ '^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9.-]{1,32}$');
