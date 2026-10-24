-- 121 — staff can remove a review (Phase 7).
--
-- A review feeds the author's counterpart's rating, so "remove" has to do two
-- things together: stop showing the review, and take it out of the average.
-- Nothing is deleted, so a mistake can be undone and the record stays for the
-- audit.
--
--   * review_moderation: one row per hidden review, with who hid it and why.
--   * reviews_hide_moderated: a restrictive select policy, like the ones for
--     jobs (093) and messages (118), so a hidden review disappears from every
--     screen and from the `api` function (which reads with the caller's own
--     login). Staff still see it.
--   * private.recompute_ratings: the one place that works out a person's
--     average and count from the visible reviews. submit_review now calls it,
--     so a hidden review stays out even after someone edits another review.
--   * admin_hide_review / admin_unhide_review: the people area of staff
--     (admin or support), a reason, an audit-log row, and the rating is
--     recomputed in the same transaction.
--
-- submit_review keeps its signature and what it returns; only the average is
-- now worked out by the helper instead of inline.

create table if not exists public.review_moderation (
  review_id uuid primary key references public.reviews (id) on delete cascade,
  hidden_by uuid references auth.users (id) on delete set null,
  reason    text not null check (char_length(btrim(reason)) between 1 and 500),
  hidden_at timestamptz not null default now()
);
alter table public.review_moderation enable row level security;
drop policy if exists review_moderation_admin_read on public.review_moderation;
create policy review_moderation_admin_read on public.review_moderation
  for select to authenticated using (private.is_admin());
revoke all on public.review_moderation from anon, authenticated;
grant select on public.review_moderation to authenticated;

create or replace function private.review_is_hidden(p_review uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.review_moderation m where m.review_id = p_review);
$$;
revoke all on function private.review_is_hidden(uuid) from public;
grant execute on function private.review_is_hidden(uuid) to anon, authenticated;

-- Restrictive: ANDed with the existing "anyone can read" policy, never widening it.
drop policy if exists reviews_hide_moderated on public.reviews;
create policy reviews_hide_moderated on public.reviews
  as restrictive for select
  using (not private.review_is_hidden(id) or private.is_admin());

-- A person's average and count, from the reviews that are showing.
create or replace function private.recompute_ratings(p_subject uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.profiles p
     set worker_rating_avg   = coalesce(s.avg_rating, 0),
         worker_rating_count = coalesce(s.n, 0)
    from (
      select round(avg(r.rating)::numeric, 2) as avg_rating, count(*) as n
        from public.reviews r
       where r.subject_id = p_subject and r.about_role = 'worker'
         and not exists (select 1 from public.review_moderation m where m.review_id = r.id)
    ) s
   where p.id = p_subject;

  update public.profiles p
     set poster_rating_avg   = coalesce(s.avg_rating, 0),
         poster_rating_count = coalesce(s.n, 0)
    from (
      select round(avg(r.rating)::numeric, 2) as avg_rating, count(*) as n
        from public.reviews r
       where r.subject_id = p_subject and r.about_role = 'poster'
         and not exists (select 1 from public.review_moderation m where m.review_id = r.id)
    ) s
   where p.id = p_subject;
end;
$$;
revoke all on function private.recompute_ratings(uuid) from public, anon, authenticated;

-- submit_review: same inputs and result, ratings now come from the helper.
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
  perform private.recompute_ratings(v_subject);

  return v_row;
end;
$$;
revoke all on function public.submit_review(uuid, smallint, text) from public;
revoke execute on function public.submit_review(uuid, smallint, text) from anon;
grant execute on function public.submit_review(uuid, smallint, text) to authenticated;

create or replace function public.admin_hide_review(p_review uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_reason  text := left(btrim(coalesce(p_reason, '')), 500);
  v_subject uuid;
begin
  perform private.require_people_staff();
  if v_reason = '' then raise exception 'Say why you are removing it'; end if;
  select subject_id into v_subject from public.reviews where id = p_review;
  if not found then raise exception 'That review does not exist'; end if;

  insert into public.review_moderation (review_id, hidden_by, reason)
  values (p_review, auth.uid(), v_reason)
  on conflict (review_id) do update set hidden_by = excluded.hidden_by, reason = excluded.reason, hidden_at = now();

  perform private.recompute_ratings(v_subject);
  perform public.admin_log_event('review.hide', p_review::text, left(v_reason, 400));
end;
$fn$;
revoke all on function public.admin_hide_review(uuid, text) from public, anon;
grant execute on function public.admin_hide_review(uuid, text) to authenticated;

create or replace function public.admin_unhide_review(p_review uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_subject uuid;
begin
  perform private.require_people_staff();
  select subject_id into v_subject from public.reviews where id = p_review;
  if not found then raise exception 'That review does not exist'; end if;
  delete from public.review_moderation where review_id = p_review;
  perform private.recompute_ratings(v_subject);
  perform public.admin_log_event('review.unhide', p_review::text, null);
end;
$fn$;
revoke all on function public.admin_unhide_review(uuid) from public, anon;
grant execute on function public.admin_unhide_review(uuid) to authenticated;
