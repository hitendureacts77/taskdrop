-- Undo of migration 156: puts back the schema's earlier defaults. Run by hand only.
-- Rights on existing tables and functions were not changed by 156, so nothing else is needed.
-- This reopens hole H71 for anything created after it runs.

alter default privileges in schema public grant select on tables to authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;
