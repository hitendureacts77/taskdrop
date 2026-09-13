-- 012_messages
--
-- The app tells both sides "contacts revealed · use chat" the moment a task
-- starts, but the chat screen was sample data with nowhere to write. This gives
-- it a real table.
--
-- Visibility deliberately matches the escrow story: only the poster and the
-- assigned worker on a task can read or write its thread, and only once the
-- task is actually locked to that worker.

create table public.messages (
  id         uuid primary key default gen_random_uuid(),
  task_id    uuid not null references public.tasks(id) on delete cascade,
  sender_id  uuid not null references auth.users(id) on delete cascade,
  body       text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index messages_task_idx on public.messages(task_id, created_at);

alter table public.messages enable row level security;

-- Who is allowed in a task's thread. SECURITY DEFINER so the policy does not
-- re-enter the tables it is protecting.
create or replace function private.can_use_task_thread(p_task_id uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.tasks t
    where t.id = p_task_id and t.poster_id = p_user
  ) or exists (
    select 1 from public.assignments a
    where a.task_id = p_task_id
      and a.worker_id = p_user
      and a.status in ('assigned', 'started', 'released')
  );
$$;

create policy messages_select_participant on public.messages
  for select using (private.can_use_task_thread(task_id, (select auth.uid())));

create policy messages_insert_participant on public.messages
  for insert with check (
    sender_id = (select auth.uid())
    and private.can_use_task_thread(task_id, (select auth.uid()))
  );

-- Let both sides see new messages arrive without polling.
alter publication supabase_realtime add table public.messages;
