-- Undo of migration 197: puts back the schema's earlier default for new sequences. Run by hand only.
-- Rights on existing sequences were not changed by 197, so nothing else is needed.
-- This reopens the sequence part of hole H71 for anything created after it runs.

alter default privileges in schema public grant usage, select, update on sequences to authenticated;
