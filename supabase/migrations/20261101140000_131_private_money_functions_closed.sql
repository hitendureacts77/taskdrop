-- 131: two private money functions are closed to the app's roles again (security round 1, task 2.7).
--
-- Migration 066 revoked EXECUTE on private.move_card_payment_to_wallet from public, anon and
-- authenticated. Migration 128 replaced the function and the grant fell back to the default (everyone
-- may execute). The same default applied to the trigger function private.book_revenue_on_completion.
--
-- Not reachable today: the `private` schema is not exposed by the REST door (only `public` and
-- `graphql_public` are), and the app's roles have no direct database connection. This puts the intended
-- closed door back so that it does not depend on that, and the new SQL test (rpc_caller_checks.test.sql)
-- fails if a private function that is not a row-rule helper is ever open again.
--
-- Additive: grants only. Every caller is another SECURITY DEFINER function or a trigger, which run with
-- the owner's rights and need no grant.

revoke all on function private.move_card_payment_to_wallet(uuid) from public, anon, authenticated;
revoke all on function private.book_revenue_on_completion() from public, anon, authenticated;
