-- 057: proof of work, and the 3-day auto-release that was only promised.
--
-- Proof: when a worker finishes, they say what they did and attach photos
-- or documents. The poster sees it before approving. mark_work_done now
-- requires one.
--
-- Auto-release: mark_work_done has always set auto_complete_at to three
-- days out (review_window_days), and the app told workers they would be paid
-- then -- but nothing ever acted on it. A poster who never answered left the
-- worker unpaid forever. private.auto_complete_due() now pays those out, on
-- a 15-minute schedule, exactly as confirm_release would.

create table if not exists public.task_proofs (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  worker_id   uuid not null references public.profiles(id) on delete cascade,
  summary     text not null check (length(btrim(summary)) >= 10 and length(summary) <= 2000),
  -- [{ "path": "<uid>/...", "kind": "image" | "video" | "file", "name": "report.pdf" }]
  files       jsonb not null default '[]'::jsonb check (jsonb_typeof(files) = 'array' and jsonb_array_length(files) <= 10),
  created_at  timestamptz not null default now()
);
create index if not exists task_proofs_task_idx on public.task_proofs (task_id);
create index if not exists task_proofs_worker_idx on public.task_proofs (worker_id);

alter table public.task_proofs enable row level security;

-- The worker doing the job adds proof while it is in progress.
drop policy if exists task_proofs_worker_insert on public.task_proofs;
create policy task_proofs_worker_insert on public.task_proofs
  for insert to authenticated
  with check (
    worker_id = (select auth.uid())
    and exists (
      select 1 from public.assignments a
        join public.tasks t on t.id = a.task_id
       where a.task_id = task_proofs.task_id
         and a.worker_id = (select auth.uid())
         and a.status = 'started'
         and t.status in ('TASK_STARTED', 'OVERDUE', 'REVISION_REQUESTED')
    )
  );

-- The worker who wrote it and the poster of the task can read it.
drop policy if exists task_proofs_parties_read on public.task_proofs;
create policy task_proofs_parties_read on public.task_proofs
  for select to authenticated
  using (
    worker_id = (select auth.uid())
    or exists (select 1 from public.tasks t where t.id = task_proofs.task_id and t.poster_id = (select auth.uid()))
  );

-- Documents as well as photos and video.
update storage.buckets
   set allowed_mime_types = array[
     'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
     'video/mp4', 'video/quicktime', 'video/webm',
     'application/pdf', 'text/plain', 'text/csv',
     'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
     'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
   ]
 where id = 'task-media';

-- Marking done needs proof.
create or replace function public.mark_work_done(p_task_id uuid)
returns tasks
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_task public.tasks; v_days numeric;
begin
  select * into v_task from public.tasks where id = p_task_id for update;
  if not found then raise exception 'Task not found'; end if;
  if not exists (select 1 from public.assignments
                  where task_id = p_task_id and worker_id = auth.uid() and status = 'started') then
    raise exception 'You are not the worker on this task';
  end if;
  if v_task.status not in ('TASK_STARTED','OVERDUE','REVISION_REQUESTED') then
    raise exception 'This task is not in progress';
  end if;
  if not exists (select 1 from public.task_proofs where task_id = p_task_id and worker_id = auth.uid()) then
    raise exception 'Add proof of work first: say what you did, with photos or documents';
  end if;

  v_days := private.setting_num('review_window_days', 3);

  update public.tasks
     set status = 'WORK_DONE',
         work_done_at = now(),
         auto_complete_at = now() + (v_days || ' days')::interval
   where id = p_task_id
  returning * into v_task;

  return v_task;
end $function$;

-- Pay out work the poster never answered, once the review window has run.
create or replace function private.auto_complete_due()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task       record;
  v_worker     uuid;
  v_commission numeric := private.setting_num('worker_commission_pct', 0.20);
  v_clear_days numeric := private.setting_num('clearing_period_days', 7);
  v_net        bigint;
  v_count      integer := 0;
begin
  for v_task in
    select t.id, t.locked_minor
      from public.tasks t
     where t.status = 'WORK_DONE'
       and t.auto_complete_at is not null
       and t.auto_complete_at <= now()
       and t.funded_at is not null
     order by t.auto_complete_at
     for update skip locked
  loop
    select a.worker_id into v_worker from public.assignments a
     where a.task_id = v_task.id and a.status = 'started' limit 1;
    if v_worker is null then continue; end if;

    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));
    update public.wallets set clearing_minor = clearing_minor + v_net where user_id = v_worker;
    update public.assignments set status = 'released' where task_id = v_task.id and worker_id = v_worker;
    update public.tasks
       set status = 'AUTO_COMPLETED',
           completed_at = now(),
           clear_at = now() + (v_clear_days || ' days')::interval
     where id = v_task.id;
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;
revoke all on function private.auto_complete_due() from public;

select cron.unschedule(jobid) from cron.job where jobname = 'auto-complete-due';
select cron.schedule('auto-complete-due', '*/15 * * * *', $$select private.auto_complete_due()$$);
