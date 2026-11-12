-- 163: rating totals follow the reviews table (debug loop B37).
--
-- Cause: profiles.worker_/poster_rating_avg and _count are worked out by
-- private.recompute_ratings (121), but only submit_review and the staff
-- hide/unhide functions call it. A review that is deleted any other way
-- (a task deleted with its reviews, a data clean-up, an account removal on
-- the author's side) left the old totals behind: "5.0 - 1 review" with an
-- empty list.
--
-- Fix: triggers call the same helper whenever a review row is deleted, or its
-- rating / subject / role changes, and whenever a review is hidden or shown
-- again through review_moderation. The visibility rule stays the one in
-- recompute_ratings (hidden reviews do not count). A one-off pass then puts
-- every profile whose totals disagree back in step.
--
-- Nothing is dropped or renamed; recompute_ratings is reused unchanged.

create or replace function private.reviews_recompute_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('DELETE', 'UPDATE') then
    perform private.recompute_ratings(old.subject_id);
  end if;
  if tg_op = 'UPDATE' then
    if new.subject_id is distinct from old.subject_id then
      perform private.recompute_ratings(new.subject_id);
    end if;
  end if;
  return null;
end;
$$;
revoke all on function private.reviews_recompute_totals() from public, anon, authenticated;

drop trigger if exists reviews_recompute_totals on public.reviews;
create trigger reviews_recompute_totals
  after delete or update of rating, subject_id, about_role on public.reviews
  for each row execute function private.reviews_recompute_totals();

-- Hiding or showing a review (review_moderation insert / delete, including a
-- cascade from a deleted review) changes what counts.
create or replace function private.review_moderation_recompute_totals()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject uuid;
begin
  if tg_op = 'DELETE' then
    select r.subject_id into v_subject from public.reviews r where r.id = old.review_id;
  else
    select r.subject_id into v_subject from public.reviews r where r.id = new.review_id;
  end if;
  if v_subject is not null then
    perform private.recompute_ratings(v_subject);
  end if;
  return null;
end;
$$;
revoke all on function private.review_moderation_recompute_totals() from public, anon, authenticated;

drop trigger if exists review_moderation_recompute_totals on public.review_moderation;
create trigger review_moderation_recompute_totals
  after insert or delete on public.review_moderation
  for each row execute function private.review_moderation_recompute_totals();

-- One-off: every profile whose totals disagree with its visible reviews.
do $$
declare
  v_id uuid;
begin
  for v_id in
    select p.id
      from public.profiles p
      left join lateral (
        select count(*) filter (where r.about_role = 'worker') as w_n,
               coalesce(round((avg(r.rating) filter (where r.about_role = 'worker'))::numeric, 2), 0) as w_avg,
               count(*) filter (where r.about_role = 'poster') as p_n,
               coalesce(round((avg(r.rating) filter (where r.about_role = 'poster'))::numeric, 2), 0) as p_avg
          from public.reviews r
         where r.subject_id = p.id
           and not exists (select 1 from public.review_moderation m where m.review_id = r.id)
      ) s on true
     where p.worker_rating_count <> s.w_n
        or p.worker_rating_avg   <> s.w_avg
        or p.poster_rating_count <> s.p_n
        or p.poster_rating_avg   <> s.p_avg
  loop
    perform private.recompute_ratings(v_id);
  end loop;
end;
$$;
