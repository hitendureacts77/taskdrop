-- 164: older tasks stop publishing their exact pin (debug loop B38).
--
-- Cause: some staging tasks (13 Sep - 31 Oct) were written with triggers off,
-- so the 074 trigger never kept their exact spot in task_private or rounded the
-- public tasks.loc_lat / loc_lng. They still show a 4-decimal pin to everyone.
--
-- Fix: the same backfill 074 ran and the end of supabase/seed/test_data.sql
-- runs, limited to tasks whose public pin is not rounded AND that have no
-- task_private row yet:
--   1. keep the exact spot privately (task_private.task_id, loc_lat, loc_lng),
--   2. publish the 2-decimal value.
-- Step 2 runs with user triggers off, as in 074: with them on, the 074 trigger
-- would copy the rounded value over the exact one, and "updated" side effects
-- would fire for a data repair.
--
-- Idempotent: a second run finds nothing. On a database where nothing matches
-- (production-like) it changes nothing and takes no table lock. Tasks that
-- already have a task_private row are never touched. Kept as a function (no
-- grants to anyone) so the SQL test can run the very same code.

create or replace function private.backfill_task_pins()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  select coalesce(array_agg(t.id), '{}')
    into v_ids
    from public.tasks t
   where t.loc_lat is not null and t.loc_lng is not null
     and (t.loc_lat <> round(t.loc_lat::numeric, 2)::double precision
          or t.loc_lng <> round(t.loc_lng::numeric, 2)::double precision)
     and not exists (select 1 from public.task_private tp where tp.task_id = t.id);

  if cardinality(v_ids) = 0 then
    return 0;
  end if;

  insert into public.task_private (task_id, loc_lat, loc_lng)
  select t.id, t.loc_lat, t.loc_lng
    from public.tasks t
   where t.id = any (v_ids)
  on conflict (task_id) do nothing;

  alter table public.tasks disable trigger user;
  update public.tasks
     set loc_lat = round(loc_lat::numeric, 2)::double precision,
         loc_lng = round(loc_lng::numeric, 2)::double precision
   where id = any (v_ids);
  alter table public.tasks enable trigger user;

  return cardinality(v_ids);
end;
$$;
revoke all on function private.backfill_task_pins() from public, anon, authenticated;

do $$
declare
  v_n integer := private.backfill_task_pins();
begin
  raise notice 'B38: kept % exact task pins privately and rounded the public value', v_n;
end;
$$;
