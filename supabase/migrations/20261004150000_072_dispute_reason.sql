-- 072 -- Keep the reason a person gives when they report a problem.
--
-- open_dispute() took a reason from the first day and threw it away: it only
-- flipped the task to DISPUTED, so the admin deciding it saw no explanation.
-- Now every report is written to task_disputes with who raised it, when, and
-- why, and the admin panel shows it beside the decision.
--
-- The table is read-only to signed-in users (the poster, the hired worker, or an
-- admin); it is written only by open_dispute(), which is security definer.

set check_function_bodies = off;

create table if not exists public.task_disputes (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks (id) on delete cascade,
  opened_by  uuid references auth.users (id) on delete set null,
  reason     text not null check (char_length(btrim(reason)) between 1 and 1000),
  created_at timestamptz not null default now()
);
create index if not exists task_disputes_task_idx on public.task_disputes (task_id, created_at desc);

alter table public.task_disputes enable row level security;

drop policy if exists task_disputes_read on public.task_disputes;
create policy task_disputes_read on public.task_disputes
  for select to authenticated
  using (
    private.is_admin()
    or opened_by = auth.uid()
    or exists (select 1 from public.tasks t where t.id = task_disputes.task_id and t.poster_id = auth.uid())
    or exists (select 1 from public.assignments a where a.task_id = task_disputes.task_id and a.worker_id = auth.uid())
  );

revoke all on public.task_disputes from anon, authenticated;
grant select on public.task_disputes to authenticated;

create or replace function public.open_dispute(p_task_id uuid, p_reason text default null)
returns public.tasks
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me     uuid := auth.uid();
  v_task   public.tasks;
  v_worker uuid;
  v_reason text := left(nullif(btrim(coalesce(p_reason, '')), ''), 1000);
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then
    raise exception 'Task not found';
  end if;

  select a.worker_id into v_worker
  from public.assignments a
  where a.task_id = p_task_id and a.status in ('started', 'released')
  order by a.created_at desc
  limit 1;

  if v_me <> v_task.poster_id and (v_worker is null or v_me <> v_worker) then
    raise exception 'You were not part of this task';
  end if;
  if v_task.status in ('COMPLETED', 'AUTO_COMPLETED', 'CANCELLED') then
    raise exception 'This task is already closed';
  end if;
  if v_task.status = 'DISPUTED' then
    raise exception 'A dispute is already open on this task';
  end if;

  update public.tasks set status = 'DISPUTED' where id = p_task_id
  returning * into v_task;

  insert into public.task_disputes (task_id, opened_by, reason)
  values (p_task_id, v_me, coalesce(v_reason, 'No reason given'));

  return v_task;
end;
$$;

revoke all on function public.open_dispute(uuid, text) from public, anon;
grant execute on function public.open_dispute(uuid, text) to authenticated;
