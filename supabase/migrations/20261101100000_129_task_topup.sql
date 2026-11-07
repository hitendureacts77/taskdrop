-- 129: remember a task's top-up, so its card can say "topped up 5%".
--
-- Owner decision 2026-11-01: the Budget step lost its suggested price range and
-- gained a top-up bar (0, 2, 3, 5, 10, 15, 20 or 25% on top of the poster's own
-- price). benchmark_minor already holds the topped-up total, which is what a
-- worker is offered; this column only records the share that was added, for the
-- badge. Money never reads it.
--
-- Additive only: one column with a default, so the old app and every existing
-- row keep working. A poster sets it when posting (insert grant); it is not
-- editable afterwards, like kind and poster_id.

alter table public.tasks
  add column if not exists topup_pct smallint not null default 0;

alter table public.tasks drop constraint if exists tasks_topup_pct_range;
alter table public.tasks
  add constraint tasks_topup_pct_range check (topup_pct between 0 and 25);

comment on column public.tasks.topup_pct is
  'Percent the poster added on top of their own price with the top-up bar (0-25). benchmark_minor already includes it; shown as a badge only.';

grant insert (topup_pct) on public.tasks to authenticated;
