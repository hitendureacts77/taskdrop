-- 251: the "Pay per task: releases and refunds" list for the admin (design v2, WP1).
--
-- admin_plan_b_overview() (Plan B) gives totals and the failed holds, but not which job, whom the money
-- goes to or how much, and task_holds is readable only by its poster and worker. This read-only function
-- lists the holds that are moving, failed, just settled or expired, with the job title and the names, for
-- the money moves table. It changes nothing. Retrying still goes through admin_plan_b_retry_move.

create or replace function public.admin_plan_b_moves(p_limit integer default 60)
returns table (
  hold_id uuid, task_id uuid, task_title text,
  poster_id uuid, poster_name text, worker_id uuid, worker_name text,
  status text, failed_from text,
  charged_minor bigint, release_minor bigint, refund_minor bigint,
  attempts integer, note text,
  expires_at timestamptz, paid_at timestamptz, asked_at timestamptz, settled_at timestamptz, updated_at timestamptz)
language plpgsql
stable
security definer
set search_path to 'public', 'private', 'pg_temp'
as $$
begin
  perform private.assert_not_money_blind();
  if not private.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if not coalesce(private.staff_can(auth.uid(), 'money') or private.staff_role(auth.uid()) = 'viewer', false) then
    raise exception 'Your staff role (%) can''t see this.', private.staff_role(auth.uid()) using errcode = '42501';
  end if;
  return query
    select h.id, h.task_id, t.title,
           h.poster_id, pp.display_name, h.worker_id, pw.display_name,
           h.status, h.failed_from,
           h.charged_minor, h.release_minor, h.refund_minor,
           h.attempts, left(h.note, 300),
           h.expires_at, h.paid_at, h.asked_at, h.settled_at, h.updated_at
      from public.task_holds h
      left join public.tasks t on t.id = h.task_id
      left join public.profiles pp on pp.id = h.poster_id
      left join public.profiles pw on pw.id = h.worker_id
     where h.status in ('failed', 'release_asked', 'refund_asked', 'split_asked')
        or (h.status in ('released', 'refunded', 'split') and h.updated_at > now() - interval '14 days')
        or (h.status = 'expired' and h.updated_at > now() - interval '14 days')
     order by (h.status = 'failed') desc, h.updated_at desc
     limit greatest(1, least(coalesce(p_limit, 60), 300));
end;
$$;

revoke all on function public.admin_plan_b_moves(integer) from public, anon;
grant execute on function public.admin_plan_b_moves(integer) to authenticated;
