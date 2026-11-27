-- 197: new counters start closed too (task 2.18 part C, hole H71, after migration 156).
--
-- Migration 156 took away the schema's default rights on new tables and functions. One default was
-- left: a new sequence (the counter behind a `serial` or `bigserial` id) still gave the signed-in role
-- USAGE, SELECT and UPDATE. UPDATE lets a role call setval and move the counter. No app door reaches
-- setval today (the data API only runs functions in `public`, and setval lives in pg_catalog), so
-- this is the same kind of trap 156 closed, not a leak: a new door that starts open.
--
-- A new sequence now gives nobody any right until its migration grants one. Identity columns
-- (`generated ... as identity`) need no right on their sequence to insert; a `serial` column that the
-- signed-in role fills by itself needs `grant usage on sequence ... to authenticated` in its migration.
--
-- Only the default changes. Rights already given on the 5 existing sequences stay as they are
-- (migrations only add; plan task 2.18 part C). supabase/tests/new_doors_closed.test.sql proves it.
-- Undo: supabase/undo/197_new_sequences_closed.down.sql

alter default privileges in schema public revoke all on sequences from anon, authenticated;
