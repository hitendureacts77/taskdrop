-- 156: new doors start closed (task 2.18 part C, hole H71).
--
-- Until now a table created by a migration could be read by every signed-in person until row rules
-- were added, because the schema's default rights gave `authenticated` SELECT on it. Nothing is open
-- today: all 68 tables have row rules. This is a trap for the next change, so the default goes.
--
-- A new table now gives nobody any right until its migration grants one, and the api runs as the
-- caller, so a table the app reads needs its own `grant select ... to authenticated`.
--
-- Functions: the explicit anon and authenticated defaults go too, but PostgreSQL also gives PUBLIC
-- EXECUTE on every new function, and that default can only be removed for all schemas at once. That
-- would also close the temporary helpers in 51 SQL test files, so it stays, and a new function must
-- keep doing what every migration here does: `revoke all ... from public, anon, authenticated`, then
-- grant what it needs. supabase/tests/new_doors_closed.test.sql fails the build if one does not.
--
-- Only defaults change. Rights already granted stay exactly as they are, and nothing is dropped.
-- Undo: supabase/undo/156_new_doors_closed.down.sql

alter default privileges in schema public revoke all on tables from authenticated;
alter default privileges in schema public revoke execute on functions from anon, authenticated;
