-- 124 -- A review can only be written once the work is approved.
--
-- Found by the break-it test (2026-10-24, docs/PHASE2_PROBLEMS.md P2-22): submit_review accepted a
-- review as soon as the work had started, so a poster could rate a worker (and a worker a poster)
-- before anything was delivered. The review button only shows after approval, so the screens never
-- did it; a direct call did.
--
-- Same inputs, same result, same edit-your-own-review behaviour. The only change is the status check
-- (COMPLETED or AUTO_COMPLETED). Nothing is dropped or renamed, so the old app keeps working: it also
-- only shows the review screen after approval.

create or replace function public.submit_review(
  p_task_id uuid,
  p_rating  smallint,
  p_comment text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me       uuid := auth.uid();
  v_task     public.tasks;
  v_worker   uuid;
  v_subject  uuid;
  v_role     app_role;
  v_row      public.reviews;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  select a.worker_id into v_worker
  from public.assignments a
  where a.task_id = p_task_id and a.status in ('started','released')
  order by a.created_at desc
  limit 1;

  if v_worker is null then
    raise exception 'This task has no worker to review yet';
  end if;

  -- Whoever is calling reviews the other side.
  if v_me = v_task.poster_id then
    v_subject := v_worker;
    v_role    := 'worker';
  elsif v_me = v_worker then
    v_subject := v_task.poster_id;
    v_role    := 'poster';
  else
    raise exception 'You were not part of this task';
  end if;

  -- Only a finished job can be reviewed.
  if v_task.status::text not in ('COMPLETED', 'AUTO_COMPLETED') then
    raise exception 'You can leave a review once the work is approved';
  end if;

  insert into public.reviews (task_id, author_id, subject_id, about_role, rating, comment)
  values (p_task_id, v_me, v_subject, v_role, p_rating, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (task_id, author_id, about_role) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_row;

  -- Recompute from source so an edited review cannot drift the average.
  perform private.recompute_ratings(v_subject);

  return v_row;
end;
$$;
revoke all on function public.submit_review(uuid, smallint, text) from public;
revoke execute on function public.submit_review(uuid, smallint, text) from anon;
grant execute on function public.submit_review(uuid, smallint, text) to authenticated;
