-- Removing a review, and the rating that follows (migration 121).
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/hide_review.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_admin   uuid := gen_random_uuid();
  v_poster  uuid := gen_random_uuid();
  v_worker  uuid := gen_random_uuid();
  v_task1   uuid;
  v_task2   uuid;
  v_good    uuid;
  v_bad     uuid;
  v_failed  boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rev+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'Rev Admin'), (v_poster, 'Rev Poster'), (v_worker, 'Rev Worker') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_admin), (v_poster), (v_worker) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category)
  values (v_poster, 'services', 'review one', 100000, 240, 'Plumbing') returning id into v_task1;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category)
  values (v_poster, 'services', 'review two', 100000, 240, 'Plumbing') returning id into v_task2;

  insert into public.reviews (task_id, author_id, subject_id, about_role, rating, comment)
  values (v_task1, v_poster, v_worker, 'worker', 5, 'great') returning id into v_good;
  insert into public.reviews (task_id, author_id, subject_id, about_role, rating, comment)
  values (v_task2, v_poster, v_worker, 'worker', 1, 'abusive and unfair') returning id into v_bad;
  perform private.recompute_ratings(v_worker);
  assert (select worker_rating_avg from public.profiles where id = v_worker) = 3.00, 'average of 5 and 1 is 3';
  assert (select worker_rating_count from public.profiles where id = v_worker) = 2, 'two reviews count';

  -- people who are not staff cannot
  perform pg_temp.become(v_poster);
  v_failed := false;
  begin perform public.admin_hide_review(v_bad, 'unfair'); exception when others then v_failed := true; end;
  assert v_failed, 'only staff can remove a review';

  perform pg_temp.become(v_admin);
  v_failed := false;
  begin perform public.admin_hide_review(v_bad, '  '); exception when others then v_failed := true; end;
  assert v_failed, 'a reason is required';
  v_failed := false;
  begin perform public.admin_hide_review(gen_random_uuid(), 'x'); exception when others then v_failed := true; end;
  assert v_failed, 'the review must exist';

  perform public.admin_hide_review(v_bad, 'abusive');

  perform pg_temp.as_operator();
  assert private.review_is_hidden(v_bad), 'the review is marked hidden';
  assert not private.review_is_hidden(v_good), 'the other review is untouched';
  assert (select worker_rating_avg from public.profiles where id = v_worker) = 5.00, 'the average ignores the removed review';
  assert (select worker_rating_count from public.profiles where id = v_worker) = 1, 'the count ignores the removed review';
  -- A test session runs as postgres, which every admin check lets through, so a SELECT always sees
  -- every row. Assert what the policy is built from, and that nothing was deleted.
  assert exists (select 1 from pg_policy where polname = 'reviews_hide_moderated' and polrelid = 'public.reviews'::regclass
                  and polpermissive = false), 'the reviews_hide_moderated policy is missing or not restrictive';
  assert (select count(*) from public.reviews where id = v_bad) = 1, 'removed, not deleted';
  assert exists (select 1 from public.admin_audit_log where action = 'review.hide' and target_id = v_bad::text), 'audit-logged';

  -- Editing the other review must not bring the removed one back into the average.
  perform private.recompute_ratings(v_worker);
  assert (select worker_rating_count from public.profiles where id = v_worker) = 1, 'a recompute keeps it out';

  perform pg_temp.become(v_admin);
  perform public.admin_unhide_review(v_bad);
  perform pg_temp.as_operator();
  assert not private.review_is_hidden(v_bad), 'unhiding brings it back';
  assert (select worker_rating_avg from public.profiles where id = v_worker) = 3.00, 'the average is back to 3';
  assert (select worker_rating_count from public.profiles where id = v_worker) = 2, 'the count is back to 2';
  assert exists (select 1 from public.admin_audit_log where action = 'review.unhide' and target_id = v_bad::text), 'unhide is audit-logged';

  raise notice 'hide_review: all assertions passed';
end;
$$;

rollback;
