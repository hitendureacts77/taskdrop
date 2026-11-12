-- 173: two read rules brought in line with the product rules.
--
-- B64. public.worker_proof_photos (a helper's shared before/after photos, signed-in callers) skipped three
-- checks that guest_proof_photos (151) has: the helper's account is not deleted, the task is not hidden by
-- moderation, and each file is the helper's own (a 'media:<id>' they own, or a path in their folder).
-- Same signature, columns and grants as 135; the body now follows guest_proof_photos. The matching read
-- rule (the shared-photo branch of can_read_task_media) was fixed in 171.
--
-- B60. task_private (the exact pin and the typed address) was readable by anyone with ANY assignment row
-- on the task (private.user_assigned_task has no status check). So a locked offer, even an unpaid
-- auto-hire, showed the exact door before work started, and a worker refunded off the job kept it for
-- good. Product rule: the exact address unlocks when work starts. The hired worker now reads it only
-- while their assignment is live (assigned, started or released) and the task has started or gone past
-- it: the same two lists task_contact_phone (058) uses. The poster and admins read it as before.
-- private.user_assigned_task is left as it is: tasks_select_visible and can_read_task_media use it.
-- The policy is changed in place (alter policy), nothing is dropped.

create or replace function public.worker_proof_photos(p_worker uuid)
returns table (task_id uuid, title text, category text, completed_at timestamptz, files jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select x.task_id, x.title, x.category, x.completed_at,
         coalesce((select jsonb_agg(f) from jsonb_array_elements(x.files) f
                    where f ->> 'label' in ('before', 'after')
                      and private.guest_owns_media(p_worker, f ->> 'path')), '[]'::jsonb)
    from (
      select distinct on (t.id) t.id as task_id, t.title, t.category, t.completed_at, tp.files
        from public.tasks t
        join public.task_proofs tp on tp.task_id = t.id and tp.worker_id = p_worker
        join public.profiles w on w.id = p_worker and w.deleted_at is null
       where t.photos_public
         and t.status in ('COMPLETED', 'AUTO_COMPLETED')
         and not private.task_is_hidden(t.id)
         and (select auth.uid()) is not null
       order by t.id, tp.created_at desc
    ) x
   order by x.completed_at desc nulls last
   limit 12;
$$;
revoke all on function public.worker_proof_photos(uuid) from public, anon;
grant execute on function public.worker_proof_photos(uuid) to authenticated;

-- The worker on the job, once the work has started (task_contact_phone's lists).
create or replace function private.user_working_task(p_task uuid, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_uid is not null and exists (
    select 1 from public.assignments a
      join public.tasks t on t.id = a.task_id
     where a.task_id = p_task
       and a.worker_id = p_uid
       and a.status in ('assigned', 'started', 'released')
       and t.status in ('TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED',
                        'COMPLETED', 'AUTO_COMPLETED', 'DISPUTED')
  );
$$;
revoke all on function private.user_working_task(uuid, uuid) from public, anon;
grant execute on function private.user_working_task(uuid, uuid) to authenticated;

alter policy task_private_parties_read on public.task_private
  using (
    private.is_admin()
    or exists (select 1 from public.tasks t
                where t.id = task_private.task_id and t.poster_id = (select auth.uid()))
    or private.user_working_task(task_private.task_id, (select auth.uid()))
  );
