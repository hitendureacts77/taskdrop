-- A withdrawal could only be requested, paid or failed, which left no way to
-- take one back: money left the wallet the instant the request was made and the
-- only paths out were "paid" or "failed". Real payout systems have a window
-- before the transfer is actually handed to the bank, and that window is the
-- one a person wants when they fat-finger an amount.
--
-- 'processing' is the honest end of that window: once an operator has picked
-- the payout up, cancelling is no longer ours to offer.
--
-- NOTE: adding an enum value and using it must not share a transaction, so the
-- ALTER TYPEs below are deliberately in their own migration ahead of the
-- function that references them.
alter type public.payout_status add value if not exists 'processing' after 'requested';
alter type public.payout_status add value if not exists 'cancelled';
