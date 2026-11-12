-- 174 — Signed-out callers can no longer ask whether two accounts blocked each other.
--
-- Debug round ledger B66. Migration 117 granted EXECUTE on private.blocked_between to
-- anon as well as authenticated, so anyone with the public key could test any two
-- account ids for a block. Nothing signed-out needs it:
--   * the only row rule that calls it is tasks_hide_blocked on public.tasks, and anon
--     has no SELECT on public.tasks, so that rule never runs as anon;
--   * every function that calls it is SECURITY DEFINER (runs as the owner);
--   * guest reads go through the api function with the service key and SECURITY
--     DEFINER guest_* functions.
-- authenticated keeps EXECUTE (Postgres runs the row rule as the person asking).
-- Grants only: no function body changes.
--
-- B65 (cancel fine on card-paid jobs) needs no change: the card refund path
-- (public.escrow_refund_due, used by the razorpay function, and the
-- refunds_outstanding view) already subtracts the logged fine from what goes back
-- to the card. supabase/tests/blocked_between_and_card_fine.test.sql asserts both.

revoke execute on function private.blocked_between(uuid, uuid) from public, anon;
grant execute on function private.blocked_between(uuid, uuid) to authenticated;
