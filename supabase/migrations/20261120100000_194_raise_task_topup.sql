-- 194: a poster can raise the top-up on a task that is still open (D31 "Top up" on open posts).
--
-- Owner decision 2026-11-20: the My tasks open-post card gets a "Top up" button. Migration 129 made
-- topup_pct insert-only, so this adds one server function that raises it. Nothing else changes:
--   * only the poster, only a request (not a service listing), only while it is OPEN (nobody hired);
--   * only upward, and only to one of the top-up bar's own steps (packages/rules TOP_UP_PCTS);
--   * benchmark_minor (what a worker is offered) moves with it: base price = old total / (1 + old%),
--     new total = base * (1 + new%), rounded to the rupee, never above the ₹1,00,000 post limit;
--   * a crew task raises every slot of the crew that is still open, so the slots stay equal;
--   * the new-account task limit trigger (migration 133) still runs on the new amount.
-- Money is not moved here: the poster pays only when they accept an offer, as before. For auto-hire
-- tasks the api checks the wallet covers the new amount before calling this (same words as createTask).
--
-- Additive only: a new function. topup_pct stays without an update grant.

create or replace function public.raise_task_topup(p_task_id uuid, p_pct integer)
returns table (id uuid, topup_pct smallint, benchmark_minor bigint)
language plpgsql
security definer
set search_path = ''
as $$
#variable_conflict use_column
declare
  v_me    uuid := auth.uid();
  v_task  public.tasks%rowtype;
  v_slot  public.tasks%rowtype;
  v_crew  uuid;
  v_base  numeric;
  v_new   bigint;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  if p_pct is null or p_pct not in (2, 3, 5, 10, 15, 20, 25) then
    raise exception 'Pick one of the top-up steps' using errcode = 'P0001';
  end if;

  select * into v_task from public.tasks t
   where t.id = p_task_id and t.poster_id = v_me
   for update;
  if not found or v_task.kind <> 'request' or v_task.status <> 'OPEN' then
    raise exception 'This task can no longer be topped up' using errcode = 'P0001';
  end if;
  if p_pct <= v_task.topup_pct then
    raise exception 'Pick a bigger top-up than the % percent it already has', v_task.topup_pct using errcode = 'P0001';
  end if;

  v_crew := v_task.crew_id;
  -- Every slot of a crew gets the same raise; a single task is a crew of one.
  for v_slot in
    select * from public.tasks t
     where t.poster_id = v_me and t.status = 'OPEN' and t.kind = 'request'
       and (t.id = p_task_id or (v_crew is not null and t.crew_id = v_crew))
     order by t.crew_slot nulls first
     for update
  loop
    v_base := v_slot.benchmark_minor::numeric / (1 + v_slot.topup_pct / 100.0);
    v_new  := (round(v_base * (1 + p_pct / 100.0) / 100.0) * 100)::bigint;
    if v_new > 10000000 then
      raise exception 'The most a task can offer is Rs 1,00,000 with the top-up. Pick a smaller top-up.' using errcode = 'P0001';
    end if;
    update public.tasks t
       set topup_pct = p_pct, benchmark_minor = greatest(v_new, v_slot.benchmark_minor)
     where t.id = v_slot.id;
  end loop;

  return query
    select t.id, t.topup_pct, t.benchmark_minor from public.tasks t where t.id = p_task_id;
end;
$$;

comment on function public.raise_task_topup(uuid, integer) is
  'Poster raises the top-up on their own OPEN request (and its open crew slots) to a bigger top-up step; benchmark_minor moves with it.';

revoke all on function public.raise_task_topup(uuid, integer) from public, anon;
grant execute on function public.raise_task_topup(uuid, integer) to authenticated;
