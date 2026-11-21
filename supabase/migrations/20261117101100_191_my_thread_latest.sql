-- 191: the latest message of every conversation the caller is in (round 8: S1-23).
--
-- listThreads used to read the newest 300 messages across all tasks, so an older chat fell out of
-- Messages. This returns one row per task, newest first. SECURITY INVOKER: the messages policy still
-- decides which conversations the caller may see.

create or replace function public.my_thread_latest(p_limit int default 500)
returns table (task_id uuid, sender_id uuid, body text, created_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select l.task_id, l.sender_id, l.body, l.created_at
  from (
    select distinct on (m.task_id) m.task_id, m.sender_id, m.body, m.created_at
    from public.messages m
    order by m.task_id, m.created_at desc
  ) l
  order by l.created_at desc
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;

revoke all on function public.my_thread_latest(int) from public, anon;
grant execute on function public.my_thread_latest(int) to authenticated;
