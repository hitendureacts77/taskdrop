-- Migration 152: daily caps against abuse (holes H43, H44, H47).
--
-- What is asserted:
--   1. Ads (H43): a viewer's repeated clicks on one promotion count once a day; the advertiser's and the
--      job poster's own clicks count never; a signed-out click counts never; the daily click number is a
--      setting; impressions are capped per viewer per promotion per day; the hourly housekeeping deletes
--      old free events and keeps old paid ones.
--   2. Files (H44): media_begin refuses past the uploads-per-day number and past the bytes-per-day number
--      (both settings), and a retried call for the same path is not a new upload.
--   3. Posting (H47): a new account gets the lower daily cap for jobs and for private feedback notes, an
--      established account the higher one; a crew counts once; the next job a Repeat posts by itself is
--      neither blocked nor counted; the server (operator) is not limited at all.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/abuse_caps.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
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

create or replace function pg_temp.make_user(p_name text) returns uuid
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
begin
  perform pg_temp.as_operator();
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'caps+' || v_user || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_user, p_name) on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_user) on conflict (user_id) do nothing;
  return v_user;
end;
$$;

create or replace function pg_temp.refusal(p_sql text) returns text
language plpgsql as $$
begin
  execute p_sql;
  return null;
exception when others then
  return sqlerrm;
end;
$$;

-- Finishing a job is a server step (the app cannot edit a task's status); it runs as the table's owner while the
-- session is still the signed-in person, which is how the real approve functions run.
create or replace function pg_temp.finish_job(p_task uuid) returns void
language plpgsql security definer as $
begin
  update public.tasks set status = 'COMPLETED' where id = p_task;
end;
$;

-- ---- the seeded numbers -------------------------------------------------------------------------
do $$
begin
  assert private.setting_num('ad_click_viewer_promo_day', -1) = 1, 'one click per viewer per promotion per day';
  assert private.setting_num('ad_impression_viewer_promo_day', -1) = 5, 'five impressions per viewer per promotion per day';
  assert private.setting_num('media_uploads_day', -1) = 300, '300 uploads a day';
  assert private.setting_num('media_bytes_day', -1) = 524288000, '500 MB a day';
  assert private.setting_num('post_cap_day', -1) = 20, '20 jobs a day';
  assert private.setting_num('post_cap_new_day', -1) = 5, '5 jobs a day for a new account';
  assert private.setting_num('feedback_cap_day', -1) = 20, '20 feedback notes a day';
  assert private.setting_num('feedback_cap_new_day', -1) = 5, '5 feedback notes a day for a new account';
end;
$$;

-- ---- 1. ads -------------------------------------------------------------------------------------
do $$
declare
  v_adv    uuid := pg_temp.make_user('Advertiser');
  v_poster uuid := pg_temp.make_user('Poster');
  v_view   uuid := pg_temp.make_user('Viewer');
  v_view2  uuid := pg_temp.make_user('Viewer two');
  v_task   uuid;
  v_promo  uuid;
  i        integer;
  v_out    jsonb;
begin
  -- A job posted by `Poster`, promoted by `Advertiser`.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Sponsored', 100000, 240) returning id into v_task;
  insert into public.task_promotions (task_id, user_id, amount_minor, days, status, starts_at, ends_at, audience)
  values (v_task, v_adv, 100000, 1, 'active', now() - interval '1 hour', now() + interval '1 day', 'city')
  returning id into v_promo;

  -- The advertiser and the poster click as often as they like: nothing is counted.
  perform pg_temp.become(v_adv);
  for i in 1..5 loop perform public.record_ad_click(v_task); end loop;
  perform pg_temp.become(v_poster);
  for i in 1..5 loop perform public.record_ad_click(v_task); end loop;
  -- Signed out: nothing is counted either.
  perform set_config('request.jwt.claims', '', true);
  perform public.record_ad_click(v_task);
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = v_promo and kind = 'click') = 0,
    'own clicks and signed-out clicks must not be counted';

  -- A viewer clicks many times: one counted. A second viewer: one more.
  perform pg_temp.become(v_view);
  for i in 1..60 loop perform public.record_ad_click(v_task); end loop;
  perform pg_temp.become(v_view2);
  perform public.record_ad_click(v_task);
  perform public.record_ad_click(v_task);
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = v_promo and kind = 'click' and viewer_id = v_view) = 1,
    'one viewer, one counted click a day';
  assert (select count(*) from public.ad_events where promotion_id = v_promo and kind = 'click') = 2,
    'two viewers, two counted clicks';

  -- A day later the same viewer may click again.
  update public.ad_events set created_at = now() - interval '25 hours' where promotion_id = v_promo and kind = 'click' and viewer_id = v_view;
  perform pg_temp.become(v_view);
  perform public.record_ad_click(v_task);
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = v_promo and kind = 'click' and viewer_id = v_view) = 2,
    'the next day a click counts again';

  -- The number is a setting.
  update public.settings set value = '2'::jsonb where key = 'ad_click_viewer_promo_day';
  perform pg_temp.become(v_view2);
  for i in 1..5 loop perform public.record_ad_click(v_task); end loop;
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = v_promo and kind = 'click' and viewer_id = v_view2) = 2,
    'the daily click number follows the setting';
  update public.settings set value = '1'::jsonb where key = 'ad_click_viewer_promo_day';

  -- Impressions: backdate four (past the 30-minute rule) and the fifth is still counted, the sixth is not.
  insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor)
  select v_promo, v_task, v_view, 'impression', 1 from generate_series(1, 4);
  update public.ad_events set created_at = now() - interval '3 hours' where promotion_id = v_promo and kind = 'impression';
  perform pg_temp.become(v_view);
  perform public.record_ad_impression(v_task);
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = v_promo and kind = 'impression' and viewer_id = v_view) = 5,
    'the fifth impression of the day is counted';
  update public.ad_events set created_at = now() - interval '2 hours'
   where promotion_id = v_promo and kind = 'impression' and viewer_id = v_view and created_at > now() - interval '1 hour';
  perform pg_temp.become(v_view);
  perform public.record_ad_impression(v_task);
  perform pg_temp.as_operator();
  assert (select count(*) from public.ad_events where promotion_id = v_promo and kind = 'impression' and viewer_id = v_view) = 5,
    'a sixth impression for the same promotion in a day is not counted';

  -- Housekeeping: old free events go, old paid events and fresh free events stay.
  insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor, created_at) values
    (v_promo, v_task, v_view, 'click', 0, now() - interval '400 days'),
    (v_promo, v_task, v_view, 'impression', 7, now() - interval '400 days');
  v_out := public.run_housekeeping();
  assert not exists (select 1 from public.ad_events where promotion_id = v_promo and cost_minor = 0 and created_at < now() - interval '300 days'),
    'a free ad event past its keep time must be deleted';
  assert exists (select 1 from public.ad_events where promotion_id = v_promo and cost_minor = 7 and created_at < now() - interval '300 days'),
    'an old ad event that carries a cost is a money record and must stay';
  assert (select count(*) from public.ad_events where promotion_id = v_promo and kind = 'click') >= 2, 'fresh clicks stay';
  assert (v_out ->> 'ad_events')::int >= 1, 'housekeeping reports the ad events it removed: ' || v_out::text;
  assert v_out ? 'notifications' and v_out ? 'admin_live_events', 'the earlier housekeeping steps are still reported';
end;
$$;

-- ---- 2. files -----------------------------------------------------------------------------------
do $$
declare
  v_me   uuid := pg_temp.make_user('Uploader');
  v_you  uuid := pg_temp.make_user('Other uploader');
  v_id   uuid;
  v_msg  text;
  i      integer;
begin
  -- Count cap (a setting).
  update public.settings set value = '3'::jsonb where key = 'media_uploads_day';
  perform pg_temp.become(v_me);
  for i in 1..3 loop
    perform public.media_begin(gen_random_uuid(), 'imagekit', 'task', 'image', 'image/jpeg',
                               '/local/u/' || v_me || '/' || gen_random_uuid() || '.jpg');
  end loop;
  v_msg := pg_temp.refusal(format(
    'select public.media_begin(gen_random_uuid(), ''imagekit'', ''task'', ''image'', ''image/jpeg'', %L)',
    '/local/u/' || v_me || '/' || gen_random_uuid() || '.jpg'));
  assert v_msg like 'You have reached today%upload limit%', 'the fourth upload of the day is refused: ' || coalesce(v_msg, 'it was accepted');
  v_msg := pg_temp.refusal(format(
    'select public.media_begin(gen_random_uuid(), ''supabase'', ''proof'', ''file'', null, %L)', v_me || '/proof-x.pdf'));
  assert v_msg like 'You have reached today%upload limit%', 'a Supabase Storage file counts too: ' || coalesce(v_msg, 'it was accepted');

  -- Another person has their own allowance.
  perform pg_temp.become(v_you);
  perform public.media_begin(gen_random_uuid(), 'supabase', 'proof', 'file', null, v_you || '/proof-1.pdf');

  -- A retried call for a path already registered is the same upload.
  perform pg_temp.as_operator();
  select id into v_id from public.media where owner = v_me limit 1;
  perform pg_temp.become(v_me);
  perform public.media_begin(gen_random_uuid(), 'imagekit', 'task', 'image', 'image/jpeg',
                             (select path from public.media where id = v_id));

  -- Byte cap (a setting): two unsized videos count 50 MB each while fresh.
  perform pg_temp.as_operator();
  update public.settings set value = '300'::jsonb where key = 'media_uploads_day';
  update public.settings set value = '104857600'::jsonb where key = 'media_bytes_day'; -- 100 MB
  delete from public.media where owner = v_me;
  perform pg_temp.become(v_me);
  perform public.media_begin(gen_random_uuid(), 'supabase', 'proof', 'video', null, v_me || '/a.mp4');
  perform public.media_begin(gen_random_uuid(), 'supabase', 'proof', 'video', null, v_me || '/b.mp4');
  v_msg := pg_temp.refusal(format(
    'select public.media_begin(gen_random_uuid(), ''supabase'', ''proof'', ''video'', null, %L)', v_me || '/c.mp4'));
  assert v_msg like 'You have uploaded a lot of files today%', 'the upload past the byte cap is refused: ' || coalesce(v_msg, 'it was accepted');

  -- A size ImageKit confirmed is used instead of the guess.
  perform pg_temp.as_operator();
  update public.media set bytes = 1000 where owner = v_me;
  perform pg_temp.become(v_me);
  perform public.media_begin(gen_random_uuid(), 'supabase', 'proof', 'video', null, v_me || '/c.mp4');

  -- The earlier checks are still there.
  v_msg := pg_temp.refusal(format(
    'select public.media_begin(gen_random_uuid(), ''supabase'', ''proof'', ''file'', null, %L)', v_you || '/steal.pdf'));
  assert v_msg like 'Invalid upload%', 'a path in somebody else''s folder is still refused: ' || coalesce(v_msg, 'it was accepted');
  perform pg_temp.as_operator();
  update public.settings set value = '524288000'::jsonb where key = 'media_bytes_day';
end;
$$;

-- ---- 3. posting ---------------------------------------------------------------------------------
do $$
declare
  v_new    uuid := pg_temp.make_user('Fresh poster');
  v_old    uuid := pg_temp.make_user('Established poster');
  v_crew   uuid := pg_temp.make_user('Crew poster');
  v_rep    uuid := pg_temp.make_user('Repeat poster');
  v_sys    uuid := pg_temp.make_user('Seeded poster');
  v_task   uuid;
  v_copy   uuid;
  v_msg    text;
  i        integer;
begin
  -- A new account: five jobs, then refused.
  perform pg_temp.become(v_new);
  for i in 1..5 loop
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
    values (v_new, 'services', 'job ' || i, 20000, 60);
  end loop;
  v_msg := pg_temp.refusal(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (%L, ''services'', ''one too many'', 20000, 60)', v_new));
  assert v_msg like 'You can post up to 5 jobs a day%', 'a new account is stopped at five: ' || coalesce(v_msg, 'it was accepted');

  -- An established account (old enough, enough finished jobs): twenty.
  perform pg_temp.as_operator();
  update public.profiles set created_at = now() - interval '60 days' where id = v_old;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, status, created_at)
  select v_old, 'services', 'done ' || g, 20000, 60, 'COMPLETED', now() - interval '10 days' from generate_series(1, 3) g;
  assert not private.is_new_account(v_old), 'the fixture account must count as established';
  perform pg_temp.become(v_old);
  for i in 1..20 loop
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
    values (v_old, 'services', 'job ' || i, 20000, 60);
  end loop;
  v_msg := pg_temp.refusal(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (%L, ''services'', ''one too many'', 20000, 60)', v_old));
  assert v_msg like 'You can post up to 20 jobs a day%', 'an established account is stopped at twenty: ' || coalesce(v_msg, 'it was accepted');

  -- A crew of four is one post: 1 + 4 = 5 posts is fine, the next is refused.
  perform pg_temp.become(v_crew);
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, crew_id, crew_size, crew_slot)
  select v_crew, 'services', 'Move a flat', 50000, 120, '77777777-7777-4777-8777-777777777777', 4, g from generate_series(1, 4) g;
  for i in 1..4 loop
    insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
    values (v_crew, 'services', 'single ' || i, 20000, 60);
  end loop;
  v_msg := pg_temp.refusal(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (%L, ''services'', ''one too many'', 20000, 60)', v_crew));
  assert v_msg like 'You can post up to 5 jobs a day%', 'a crew of four counts once, the sixth post is refused: ' || coalesce(v_msg, 'it was accepted');

  -- Reusing a crew id to post without end is refused: a crew of four has four rows.
  v_msg := pg_temp.refusal(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, crew_id, crew_size, crew_slot) values (%L, ''services'', ''Fifth slot'', 50000, 120, ''77777777-7777-4777-8777-777777777777'', 4, 1)', v_crew));
  assert v_msg like 'That crew is already full%', 'a crew cannot grow past its size: ' || coalesce(v_msg, 'it was accepted');

  -- Repeat: the next copy is posted by the system and is not blocked, even at the cap.
  perform pg_temp.as_operator();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, due_at, repeat_every, status)
  values (v_rep, 'services', 'Weekly water cans', 20000, 60, now() + interval '1 day', 'week', 'OPEN')
  returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  select v_rep, 'services', 'filler ' || g, 20000, 60 from generate_series(1, 4) g;   -- operator: not limited
  perform pg_temp.become(v_rep);
  perform pg_temp.finish_job(v_task);   -- finished through a server function, as the real approve step is
  perform pg_temp.as_operator();
  assert (select status from public.tasks where id = v_task) = 'COMPLETED', 'the fixture job should be finished by its poster';
  select id into v_copy from public.tasks where repeated_from = v_task;
  assert v_copy is not null, 'the repeating job must post its next copy even when the poster is at the daily cap';
  perform pg_temp.become(v_rep);
  v_msg := pg_temp.refusal(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (%L, ''services'', ''by hand'', 20000, 60)', v_rep));
  assert v_msg like 'You can post up to 5 jobs a day%', 'the poster is still limited by hand (the system copy is not counted, the 5 own posts are): ' || coalesce(v_msg, 'it was accepted');

  -- The server and the seed script are never limited.
  perform pg_temp.as_operator();
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  select v_sys, 'services', 'seeded ' || g, 20000, 60 from generate_series(1, 30) g;
  assert (select count(*) from public.tasks where poster_id = v_sys) = 30, 'thirty seeded jobs went in';

  -- The numbers are settings.
  update public.settings set value = '2'::jsonb where key = 'post_cap_new_day';
  perform pg_temp.become(v_sys);
  v_msg := pg_temp.refusal(format(
    'insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes) values (%L, ''services'', ''over'', 20000, 60)', v_sys));
  assert v_msg like 'You can post up to 2 jobs a day%', 'the new-account cap follows the setting: ' || coalesce(v_msg, 'it was accepted');
  perform pg_temp.as_operator();
  update public.settings set value = '5'::jsonb where key = 'post_cap_new_day';
end;
$$;

-- ---- 3b. private feedback notes -----------------------------------------------------------------
do $$
declare
  v_new  uuid := pg_temp.make_user('Feedback new');
  v_old  uuid := pg_temp.make_user('Feedback established');
  v_msg  text;
  i      integer;
begin
  perform pg_temp.become(v_new);
  for i in 1..5 loop
    insert into public.feedback (user_id, kind, body) values (v_new, 'idea', 'note number ' || i);
  end loop;
  v_msg := pg_temp.refusal(format('insert into public.feedback (user_id, kind, body) values (%L, ''idea'', ''one too many'')', v_new));
  assert v_msg like 'You can send up to 5 feedback notes a day%', 'a new account is stopped at five notes: ' || coalesce(v_msg, 'it was accepted');

  perform pg_temp.as_operator();
  update public.profiles set created_at = now() - interval '60 days' where id = v_old;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, status, created_at)
  select v_old, 'services', 'done ' || g, 20000, 60, 'COMPLETED', now() - interval '10 days' from generate_series(1, 3) g;
  perform pg_temp.become(v_old);
  for i in 1..20 loop
    insert into public.feedback (user_id, kind, body) values (v_old, 'praise', 'note number ' || i);
  end loop;
  v_msg := pg_temp.refusal(format('insert into public.feedback (user_id, kind, body) values (%L, ''idea'', ''one too many'')', v_old));
  assert v_msg like 'You can send up to 20 feedback notes a day%', 'an established account is stopped at twenty notes: ' || coalesce(v_msg, 'it was accepted');

  -- The server is not limited.
  perform pg_temp.as_operator();
  insert into public.feedback (user_id, kind, body) select v_new, 'idea', 'server note ' || g from generate_series(1, 30) g;
end;
$$;

rollback;
