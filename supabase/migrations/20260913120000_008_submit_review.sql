-- 008_submit_review
--
-- Reviews are insertable directly under RLS, but the rating averages on
-- public.profiles must never be. This RPC is the only writer of those columns:
-- it works out who the counterparty is from the task, refuses anyone who is not
-- a participant, and recomputes the subject's average from the review rows
-- rather than trusting a number sent by the client.

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

  insert into public.reviews (task_id, author_id, subject_id, about_role, rating, comment)
  values (p_task_id, v_me, v_subject, v_role, p_rating, nullif(btrim(coalesce(p_comment, '')), ''))
  on conflict (task_id, author_id, about_role) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_row;

  -- Recompute from source so an edited review cannot drift the average.
  if v_role = 'worker' then
    update public.profiles p
       set worker_rating_avg   = coalesce(s.avg_rating, 0),
           worker_rating_count = coalesce(s.n, 0)
      from (
        select round(avg(rating)::numeric, 2) as avg_rating, count(*) as n
        from public.reviews
        where subject_id = v_subject and about_role = 'worker'
      ) s
     where p.id = v_subject;
  else
    update public.profiles p
       set poster_rating_avg   = coalesce(s.avg_rating, 0),
           poster_rating_count = coalesce(s.n, 0)
      from (
        select round(avg(rating)::numeric, 2) as avg_rating, count(*) as n
        from public.reviews
        where subject_id = v_subject and about_role = 'poster'
      ) s
     where p.id = v_subject;
  end if;

  return v_row;
end;
$$;

revoke all on function public.submit_review(uuid, smallint, text) from public;
grant execute on function public.submit_review(uuid, smallint, text) to authenticated;
