-- 095 -- How each member of staff is doing, for the admin panel's Team
-- performance page.
--
-- admin_staff_performance(from, to) counts, per person holding the admin role,
-- what they did in the window: follow-ups finished (and how many on time),
-- notes written, help-request replies, reports handled, disputes decided,
-- suspensions made, messages sent, and the customers they currently own.
-- Everything is read from tables that already record who did it, so no new
-- tracking is needed and nothing here changes how staff work.
--
-- Read-only, admins only. Only adds a function.

create or replace function public.admin_staff_performance(p_from timestamptz, p_to timestamptz)
returns table (
  user_id          uuid,
  staff_role       text,
  tasks_done       bigint,
  tasks_on_time    bigint,
  tasks_open       bigint,
  tasks_overdue    bigint,
  notes            bigint,
  ticket_replies   bigint,
  reports_handled  bigint,
  disputes_decided bigint,
  suspensions      bigint,
  broadcasts       bigint,
  customers_owned  bigint,
  first_response_minutes numeric
)
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_from is null or p_to is null or p_to <= p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > interval '400 days' then raise exception 'At most 400 days at a time'; end if;

  return query
  select ur.user_id,
         coalesce(s.staff_role, 'admin'),
         (select count(*) from public.crm_tasks t where t.completed_by = ur.user_id and t.completed_at >= p_from and t.completed_at < p_to),
         (select count(*) from public.crm_tasks t where t.completed_by = ur.user_id and t.completed_at >= p_from and t.completed_at < p_to
                 and (t.due_at is null or t.completed_at <= t.due_at)),
         (select count(*) from public.crm_tasks t where t.owner_id = ur.user_id and t.status = 'open'),
         (select count(*) from public.crm_tasks t where t.owner_id = ur.user_id and t.status = 'open' and t.due_at < now()),
         (select count(*) from public.crm_notes n where n.author_id = ur.user_id and n.created_at >= p_from and n.created_at < p_to),
         (select count(*) from public.support_messages m where m.sender_id = ur.user_id and m.from_staff and m.created_at >= p_from and m.created_at < p_to),
         (select count(*) from public.reports r where r.handled_by = ur.user_id and r.handled_at >= p_from and r.handled_at < p_to),
         (select count(*) from public.dispute_decisions d where d.decided_by = ur.user_id and d.created_at >= p_from and d.created_at < p_to),
         (select count(*) from public.user_suspensions x where x.suspended_by = ur.user_id and x.suspended_at >= p_from and x.suspended_at < p_to),
         (select count(*) from public.crm_broadcasts b where b.sent_by = ur.user_id and b.sent_at >= p_from and b.sent_at < p_to),
         (select count(*) from public.crm_owners o where o.owner_id = ur.user_id),
         -- Minutes from a help request to the first staff reply, for requests this person answered first.
         (select round(avg(extract(epoch from (fr.first_at - tk.created_at)) / 60.0)::numeric, 1)
            from public.support_tickets tk
            join lateral (
              select m.sender_id, m.created_at as first_at
                from public.support_messages m
               where m.ticket_id = tk.id and m.from_staff
               order by m.created_at limit 1
            ) fr on true
           where fr.sender_id = ur.user_id and tk.created_at >= p_from and tk.created_at < p_to)
    from public.user_roles ur
    left join public.admin_staff s on s.user_id = ur.user_id
   where ur.role = 'admin';
end;
$fn$;
revoke all on function public.admin_staff_performance(timestamptz, timestamptz) from public, anon;
grant execute on function public.admin_staff_performance(timestamptz, timestamptz) to authenticated;
