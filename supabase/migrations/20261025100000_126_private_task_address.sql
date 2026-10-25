-- 125 -- A job's typed address lives in the owner-only table, not in the public label.
--
-- Found by the break-it test (2026-10-24, docs/PHASE2_PROBLEMS.md P2-21): when a poster types the
-- flat, building and landmark, the whole line was stored in tasks.loc_label, which every signed-in
-- person can read. The app only hid it on screen. Product rule: only the area shows until a worker
-- is chosen; the exact address is for the poster and the person hired.
--
-- Migration 074 already keeps the exact coordinates in task_private (readable by the poster, the
-- assigned worker and admins). This adds the typed address next to them.
--
-- Additive only: one new column and one new function. The old app keeps writing and reading
-- tasks.loc_label as before (its posts stay as public as they were until Phase 9); the upgraded
-- `api` function now sends the area as the label and the full line here.

alter table public.task_private add column if not exists address text;

-- The poster stores (or clears) the typed address of their own task. Nobody else can.
create or replace function public.set_task_address(p_task_id uuid, p_address text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
  v_address text := nullif(btrim(coalesce(p_address, '')), '');
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if v_address is not null and length(v_address) > 400 then
    raise exception 'That address is too long';
  end if;
  if not exists (select 1 from public.tasks t where t.id = p_task_id and t.poster_id = v_me) then
    raise exception 'Only the poster can set a task''s address';
  end if;
  insert into public.task_private (task_id, address, updated_at)
  values (p_task_id, v_address, now())
  on conflict (task_id) do update set address = excluded.address, updated_at = now();
end;
$$;
revoke all on function public.set_task_address(uuid, text) from public;
revoke execute on function public.set_task_address(uuid, text) from anon;
grant execute on function public.set_task_address(uuid, text) to authenticated;
