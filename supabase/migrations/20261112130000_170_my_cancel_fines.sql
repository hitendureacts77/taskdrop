-- 170: the wallet list can show a cancellation fine honestly.
--
-- B58 (Medium) When a poster cancels after the work started, the worker is paid a fine (5% of the
--     offer) out of the escrow and the poster gets the rest back (cancel_task, 128;
--     refund_wallet_on_cancel). The fine is only recorded in cancellations_log, which app users
--     cannot read, so the wallet list said "full refund" with the whole amount and the worker
--     never saw the fine at all. This read gives the caller their own fines: as the poster who
--     paid one, or as the worker who received one.
--
-- Only adds one read function. Signed-in callers only; each row is the caller's own.

create or replace function public.my_cancel_fines()
returns table (task_id uuid, fine_minor bigint, side text, at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select l.task_id,
         l.penalty_or_refund_minor::bigint,
         case when t.poster_id = (select auth.uid()) then 'poster' else 'worker' end,
         l.created_at
    from public.cancellations_log l
    join public.tasks t on t.id = l.task_id
   where (select auth.uid()) is not null
     and l.cancelled_by = 'poster'
     and coalesce(l.penalty_or_refund_minor, 0) > 0
     and (
       t.poster_id = (select auth.uid())
       -- The worker paid the fine: the hire the cancel refunded, the newest one on the task.
       or (select a.worker_id from public.assignments a
            where a.task_id = t.id and a.status = 'refunded'
            order by a.created_at desc limit 1) = (select auth.uid())
     )
   order by l.created_at desc
   limit 500;
$$;
revoke all on function public.my_cancel_fines() from public, anon;
grant execute on function public.my_cancel_fines() to authenticated, service_role;
