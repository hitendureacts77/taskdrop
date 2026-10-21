-- 110 — a payment can be for a promotion (Phase 2, known bug).
--
-- PromoteScreen paid for a campaign with purpose 'escrow'. For an open post
-- that has no locked quote the razorpay function refused it ("No quote has been
-- locked"), and for a post that did have one it would have priced the link as
-- the escrow and funded the task with what was meant to buy advertising.
--
-- A promotion now has its own purpose. This file only adds the value; it is
-- used from migration 111 and from the razorpay Edge Function. (A new enum
-- value cannot be used in the transaction that adds it, hence two files.)
-- Nothing old changes: the old app keeps sending 'escrow' and 'topup'.

alter type public.payment_purpose add value if not exists 'promotion';
