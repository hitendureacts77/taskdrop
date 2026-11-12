-- Rating totals follow the reviews table (migration 163, debug loop B37).
-- Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/review_totals_recalc.test.sql

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
  v_poster uuid := gen_random_uuid();
  v_worker uuid := gen_random_uuid();
  v_task   uuid;
  v_bid    uuid;
  v_review uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'rtr+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_poster, 'RTR Poster'), (v_worker, 'RTR Worker') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_poster), (v_worker) on conflict (user_id) do nothing;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category)
  values (v_poster, 'services', 'review totals', 100000, 240, 'Plumbing') returning id into v_task;
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes)
  values (v_task, v_worker, 100000, 240) returning id into v_bid;
  insert into public.assignments (task_id, bid_id, worker_id, escrow_minor, status)
  values (v_task, v_bid, v_worker, 103000, 'started');
  update public.tasks set status = 'TASK_STARTED' where id = v_task;
  update public.tasks set status = 'COMPLETED' where id = v_task;
  update public.assignments set status = 'released' where task_id = v_task;

  -- The normal path: both sides review.
  perform pg_temp.become(v_poster);
  perform public.submit_review(v_task, 5::smallint, 'great');
  perform pg_temp.become(v_worker);
  perform public.submit_review(v_task, 4::smallint, 'clear brief');
  perform pg_temp.as_operator();

  assert (select worker_rating_count from public.profiles where id = v_worker) = 1, 'worker has one review';
  assert (select worker_rating_avg from public.profiles where id = v_worker) = 5.00, 'worker average is 5';
  assert (select poster_rating_count from public.profiles where id = v_poster) = 1, 'poster has one review';

  -- An edited rating outside submit_review still moves the average.
  update public.reviews set rating = 2 where task_id = v_task and about_role = 'worker';
  assert (select worker_rating_avg from public.profiles where id = v_worker) = 2.00, 'a changed rating is recounted';

  -- Hiding through review_moderation takes it out; showing it puts it back.
  select id into v_review from public.reviews where task_id = v_task and about_role = 'worker';
  insert into public.review_moderation (review_id, reason) values (v_review, 'test');
  assert (select worker_rating_count from public.profiles where id = v_worker) = 0, 'a hidden review does not count';
  delete from public.review_moderation where review_id = v_review;
  assert (select worker_rating_count from public.profiles where id = v_worker) = 1, 'an unhidden review counts again';

  -- Deleting the reviews puts both totals back to none.
  delete from public.reviews where task_id = v_task;
  assert (select worker_rating_count from public.profiles where id = v_worker) = 0, 'worker count back to 0';
  assert (select worker_rating_avg from public.profiles where id = v_worker) = 0, 'worker average back to 0';
  assert (select poster_rating_count from public.profiles where id = v_poster) = 0, 'poster count back to 0';
  assert (select poster_rating_avg from public.profiles where id = v_poster) = 0, 'poster average back to 0';

  -- The LEDGER B37 check (visible reviews only), scoped to this test's people
  -- so seed data written straight into profiles cannot make it flaky.
  assert (
    select count(*) from public.profiles p
     where p.id in (v_poster, v_worker)
       and (p.worker_rating_count <> (
             select count(*) from public.reviews r
              where r.subject_id = p.id and r.about_role = 'worker'
                and not exists (select 1 from public.review_moderation m where m.review_id = r.id))
        or p.poster_rating_count <> (
             select count(*) from public.reviews r
              where r.subject_id = p.id and r.about_role = 'poster'
                and not exists (select 1 from public.review_moderation m where m.review_id = r.id)))
  ) = 0, 'no profile has totals out of step with its reviews';
end;
$$;

rollback;
