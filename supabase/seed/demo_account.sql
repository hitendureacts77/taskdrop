-- Demo data for one account, so every screen has something real to show.
--
-- Fills @helooo (phone 9000000000) with a worker's history -- finished jobs
-- (cleared and still clearing), one in progress, one waiting to start, one
-- awaiting approval, open quotes, saved jobs, a service listing, a
-- withdrawal and reviews -- and a poster's side: an open request with three
-- quotes, one in progress, one finished and reviewed, and an urgent one.
-- The other party on each job is one of the project's existing test accounts.
--
-- Every row is logged in private.demo_seed; demo_account_remove.sql deletes
-- exactly those. Triggers are off for this transaction so old quotes don't
-- notify anyone; the few notifications meant for this account are added here.

begin;
set local session_replication_role = replica;

do $$
declare
  h       uuid := 'b74bef3a-41f4-470e-9e58-10d9cfac032d'; -- @helooo, 9000000000
  p6789   uuid := '3c96c4a3-6e40-4aa9-84dc-058be9e52e3c'; -- Tasker 6789
  phiten  uuid := 'd3e399c9-2377-4217-ab4c-f4cf5f2edaeb'; -- hitendureacts
  p3313   uuid := 'ec7ca544-48d7-403d-9f54-bcd7312abbd9'; -- Tasker 3313
  wpro    uuid := '0204f528-4053-4838-80af-3b82f1b21701'; -- workerPro
  wnenu   uuid := 'a96569f1-ea83-4924-b6d6-0d46574d07da'; -- nenu worker
  lat     double precision := 17.4627;
  lng     double precision := 78.3709;
  t uuid; b uuid; a uuid; pay uuid; r uuid;

begin
  if exists (select 1 from private.demo_seed) then
    raise exception 'Demo data is already there. Run demo_account_remove.sql first.';
  end if;

  ------------------------------------------------------------------ worker --

  -- W1: finished 12 days ago, earnings already cleared.
  t := gen_random_uuid(); b := gen_random_uuid(); a := gen_random_uuid(); pay := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
    loc_label, loc_lat, loc_lng, locked_bid_id, locked_minor, payout_mode, started_at, work_done_at, completed_at,
    clear_at, cleared_at, created_at, funded_at, funding_payment_id, category, skills, difficulty, due_at)
  values (t, p6789, 'services', 'Write 5 blog posts for a bakery website',
    'Five 600-word posts about our cakes, custom orders and baking tips. Friendly tone, SEO keywords provided.',
    120000, 4320, 'COMPLETED', 'Remote', null, null, b, 120000, 'one_time',
    now() - interval '15 days', now() - interval '12 days 4 hours', now() - interval '12 days',
    now() - interval '5 days', now() - interval '5 days', now() - interval '16 days', now() - interval '15 days 2 hours',
    pay, 'Writing & Content', '{Content writing}', 'medium', now() - interval '12 days');
  insert into bids values (b, t, h, 120000, 4320, 'I write for food brands - two samples in my profile.', true, now() - interval '16 days');
  insert into payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at)
  values (pay, p6789, t, 'escrow', 123600, 'paid', 'demo', now() - interval '15 days 2 hours', now() - interval '15 days 2 hours');
  insert into assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at)
  values (a, t, b, h, 'released', 123600, 'one_time', now() - interval '15 days 2 hours', now() - interval '12 days');
  insert into reviews (task_id, author_id, subject_id, about_role, rating, comment, created_at)
  values (t, p6789, h, 'worker', 5, 'Lovely writing and delivered a day early. Will hire again.', now() - interval '12 days')
  returning id into r;
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b), ('payments', pay), ('assignments', a), ('reviews', r);

  -- W2: finished 2 days ago, still clearing.
  t := gen_random_uuid(); b := gen_random_uuid(); a := gen_random_uuid(); pay := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
    loc_label, locked_bid_id, locked_minor, payout_mode, started_at, work_done_at, completed_at,
    clear_at, created_at, funded_at, funding_payment_id, category, skills, difficulty, due_at)
  values (t, phiten, 'services', 'Product descriptions for 20 handloom sarees',
    'Short, vivid descriptions (60-80 words each) for our online store. Photos and fabric details shared in chat.',
    80000, 2880, 'COMPLETED', 'Remote', b, 80000, 'one_time',
    now() - interval '4 days', now() - interval '2 days 3 hours', now() - interval '2 days',
    now() + interval '5 days', now() - interval '5 days', now() - interval '4 days 1 hour',
    pay, 'Writing & Content', '{Content writing}', 'easy', now() - interval '2 days');
  insert into bids values (b, t, h, 80000, 2880, 'Done this for two boutiques before. Can start today.', true, now() - interval '5 days');
  insert into payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at)
  values (pay, phiten, t, 'escrow', 82400, 'paid', 'demo', now() - interval '4 days 1 hour', now() - interval '4 days 1 hour');
  insert into assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at)
  values (a, t, b, h, 'released', 82400, 'one_time', now() - interval '4 days 1 hour', now() - interval '2 days');
  insert into reviews (task_id, author_id, subject_id, about_role, rating, comment, created_at)
  values (t, phiten, h, 'worker', 4, 'Good work, needed one small round of changes.', now() - interval '2 days')
  returning id into r;
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b), ('payments', pay), ('assignments', a), ('reviews', r);

  -- W3: finished 25 days ago, cleared.
  t := gen_random_uuid(); b := gen_random_uuid(); a := gen_random_uuid(); pay := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
    loc_label, loc_lat, loc_lng, locked_bid_id, locked_minor, payout_mode, started_at, work_done_at, completed_at,
    clear_at, cleared_at, created_at, funded_at, funding_payment_id, category, skills, difficulty, due_at)
  values (t, p3313, 'services', 'Translate a restaurant menu into Hindi',
    'Two-page menu, about 70 dishes. Keep dish names, translate the descriptions.',
    150000, 2880, 'COMPLETED', 'Madhapur, Hyderabad', lat + 0.004, lng - 0.003, b, 150000, 'one_time',
    now() - interval '27 days', now() - interval '25 days 5 hours', now() - interval '25 days',
    now() - interval '18 days', now() - interval '18 days', now() - interval '28 days', now() - interval '27 days 3 hours',
    pay, 'Writing & Content', '{Content writing,Translation}', 'medium', now() - interval '25 days');
  insert into bids values (b, t, h, 150000, 2880, 'Native Hindi speaker, food vocabulary is my thing.', true, now() - interval '28 days');
  insert into payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at)
  values (pay, p3313, t, 'escrow', 154500, 'paid', 'demo', now() - interval '27 days 3 hours', now() - interval '27 days 3 hours');
  insert into assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at)
  values (a, t, b, h, 'released', 154500, 'one_time', now() - interval '27 days 3 hours', now() - interval '25 days');
  insert into reviews (task_id, author_id, subject_id, about_role, rating, comment, created_at)
  values (t, p3313, h, 'worker', 5, 'Accurate and quick. Customers love the new menu.', now() - interval '25 days')
  returning id into r;
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b), ('payments', pay), ('assignments', a), ('reviews', r);

  -- W4: in progress, started 3 hours ago, with a chat.
  t := gen_random_uuid(); b := gen_random_uuid(); a := gen_random_uuid(); pay := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
    loc_label, locked_bid_id, locked_minor, payout_mode, started_at, created_at, funded_at, funding_payment_id,
    category, skills, difficulty, due_at)
  values (t, p6789, 'services', 'Instagram captions for a café launch (30 posts)',
    'Thirty captions with hashtags for our opening month. Brand notes and photos are in the chat.',
    90000, 1440, 'TASK_STARTED', 'Remote', b, 90000, 'one_time',
    now() - interval '3 hours', now() - interval '1 day', now() - interval '5 hours', pay,
    'Writing & Content', '{Content writing,Social media}', 'easy', now() + interval '21 hours');
  insert into bids values (b, t, h, 90000, 1440, 'Punchy, on-brand captions - happy to share a few first for your OK.', true, now() - interval '20 hours');
  insert into payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at)
  values (pay, p6789, t, 'escrow', 92700, 'paid', 'demo', now() - interval '5 hours', now() - interval '5 hours');
  insert into assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at)
  values (a, t, b, h, 'started', 92700, 'one_time', now() - interval '5 hours', now() - interval '3 hours');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b), ('payments', pay), ('assignments', a);
  insert into messages (task_id, sender_id, body, created_at) values
    (t, p6789, 'Hi! Sharing the menu and a few photos of the space. We open on the 1st.', now() - interval '4 hours 40 minutes'),
    (t, h, 'Got them, thanks. I''ll send the first 5 captions in an hour so you can check the tone.', now() - interval '4 hours 30 minutes'),
    (t, p6789, 'Perfect 👍', now() - interval '4 hours 28 minutes'),
    (t, h, 'First five are up - let me know what you think.', now() - interval '1 hour 10 minutes');
  insert into private.demo_seed (tbl, row_id) select 'messages', id from messages where task_id = t;

  -- W5: assigned and funded, not started yet.
  t := gen_random_uuid(); b := gen_random_uuid(); a := gen_random_uuid(); pay := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
    loc_label, locked_bid_id, locked_minor, payout_mode, created_at, funded_at, funding_payment_id,
    category, skills, difficulty, due_at)
  values (t, phiten, 'services', 'Proofread a 12-page college project',
    'Grammar, flow and references. APA style. File shared once you start.',
    60000, 2880, 'LOCKED', 'Remote', b, 60000, 'one_time',
    now() - interval '10 hours', now() - interval '2 hours', pay,
    'Tutoring & Education', '{Content writing,Proofreading}', 'easy', now() + interval '2 days');
  insert into bids values (b, t, h, 60000, 2880, 'Careful proofreader, APA included.', true, now() - interval '8 hours');
  insert into payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at)
  values (pay, phiten, t, 'escrow', 61800, 'paid', 'demo', now() - interval '2 hours', now() - interval '2 hours');
  insert into assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at)
  values (a, t, b, h, 'assigned', 61800, 'one_time', now() - interval '2 hours', now() - interval '2 hours');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b), ('payments', pay), ('assignments', a);

  -- W6: work submitted, waiting for the poster to approve.
  t := gen_random_uuid(); b := gen_random_uuid(); a := gen_random_uuid(); pay := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
    loc_label, locked_bid_id, locked_minor, payout_mode, started_at, work_done_at, auto_complete_at, created_at,
    funded_at, funding_payment_id, category, skills, difficulty, due_at)
  values (t, p3313, 'services', 'Write an About Us page for a yoga studio',
    'Around 400 words: our story, the teachers, and what a first class is like.',
    70000, 1440, 'WORK_DONE', 'Remote', b, 70000, 'one_time',
    now() - interval '1 day', now() - interval '2 hours', now() + interval '46 hours', now() - interval '2 days',
    now() - interval '1 day 2 hours', pay, 'Writing & Content', '{Content writing}', 'easy', now() - interval '1 hour');
  insert into bids values (b, t, h, 70000, 1440, 'Warm, calm copy - that suits a studio.', true, now() - interval '1 day 20 hours');
  insert into payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at)
  values (pay, p3313, t, 'escrow', 72100, 'paid', 'demo', now() - interval '1 day 2 hours', now() - interval '1 day 2 hours');
  insert into assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at)
  values (a, t, b, h, 'started', 72100, 'one_time', now() - interval '1 day 2 hours', now() - interval '2 hours');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b), ('payments', pay), ('assignments', a);

  -- Two open requests from others that this account has quoted on.
  t := gen_random_uuid(); b := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, loc_label,
    loc_lat, loc_lng, created_at, category, skills, difficulty, due_at)
  values (t, p3313, 'services', 'Blog post: 10 tips for first-time home loan buyers',
    '1,200 words, simple language, for a mortgage advisor''s website.', 100000, 2880, 'Kondapur, Hyderabad',
    lat + 0.01, lng - 0.008, now() - interval '6 hours', 'Writing & Content', '{Content writing}', 'medium', now() + interval '3 days');
  insert into bids values (b, t, h, 95000, 2880, 'Finance explainers are my strength - samples on request.', false, now() - interval '5 hours');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b);

  t := gen_random_uuid(); b := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, loc_label,
    created_at, category, skills, difficulty, due_at)
  values (t, p6789, 'services', 'Rewrite my resume for a first job in marketing',
    'Fresher, B.Com. Need it ATS-friendly with a short cover letter.', 50000, 1440, 'Remote',
    now() - interval '9 hours', 'Career & Resume', '{Content writing}', 'easy', now() + interval '2 days');
  insert into bids values (b, t, h, 45000, 1440, 'I''ve helped 15+ freshers land interviews. Cover letter included.', false, now() - interval '8 hours');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b);

  -- Open jobs nearby / remote this account saved for later.
  t := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, loc_label,
    loc_lat, loc_lng, created_at, category, skills, difficulty, due_at)
  values (t, phiten, 'services', 'Script for a 60-second explainer video',
    'For a food-delivery startup. Voice-over script plus scene notes.', 150000, 4320, 'Madhapur, Hyderabad',
    lat - 0.003, lng + 0.002, now() - interval '3 hours', 'Writing & Content', '{Content writing}', 'medium', now() + interval '4 days');
  insert into saved_tasks (user_id, task_id, created_at) values (h, t, now() - interval '2 hours');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t);

  t := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, flag, loc_label,
    created_at, category, skills, difficulty, due_at)
  values (t, p3313, 'services', 'Newsletter for a coaching institute (4 issues)',
    'Monthly newsletter - results, upcoming batches, one study tip each.', 200000, 10080, 'none', 'Remote',
    now() - interval '1 day', 'Writing & Content', '{Content writing}', 'medium', now() + interval '6 days');
  insert into saved_tasks (user_id, task_id, created_at) values (h, t, now() - interval '20 hours');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t);

  -- A service this account offers.
  t := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, loc_label,
    created_at, category, skills, difficulty, kind)
  values (t, h, 'services', 'I will write blogs, captions and product copy',
    'SEO blogs, Instagram captions and product descriptions in English and Hindi. Two free revisions.',
    50000, 1440, 'Remote', now() - interval '6 days', 'Writing & Content', '{Content writing}', 'easy', 'service');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t);

  -- A withdrawal to UPI.
  insert into payouts (user_id, amount_minor, status, destination, reference, created_at, updated_at)
  values (h, 100000, 'paid', 'helooo@upi', 'DEMO-UPI-0001', now() - interval '4 days', now() - interval '4 days')
  returning id into r;
  insert into private.demo_seed (tbl, row_id) values ('payouts', r);

  ------------------------------------------------------------------ poster --

  -- P1: open request with three quotes to compare.
  t := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, loc_label,
    loc_lat, loc_lng, created_at, category, skills, difficulty, due_at)
  values (t, h, 'services', 'Deep clean a 2BHK before moving in',
    'Kitchen, two bathrooms, floors and windows. Empty flat, bring your own supplies.',
    250000, 480, 'Ward 107 Madhapur', lat + 0.001, lng + 0.001, now() - interval '7 hours',
    'Home Services', '{Cleaning}', 'medium', now() + interval '2 days');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t);
  insert into bids (task_id, worker_id, price_minor, time_limit_minutes, message, created_at) values
    (t, wpro, 240000, 420, 'Team of two, done 40+ move-in cleans. Supplies included.', now() - interval '6 hours'),
    (t, p6789, 220000, 480, 'Can do it tomorrow morning.', now() - interval '5 hours'),
    (t, wnenu, 260000, 360, 'Deep clean with machine scrubbing for bathrooms.', now() - interval '2 hours');
  insert into private.demo_seed (tbl, row_id) select 'bids', id from bids where task_id = t;

  -- P2: in progress, workerPro started 40 minutes ago.
  t := gen_random_uuid(); b := gen_random_uuid(); a := gen_random_uuid(); pay := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
    loc_label, loc_lat, loc_lng, locked_bid_id, locked_minor, payout_mode, started_at, created_at, funded_at,
    funding_payment_id, category, skills, difficulty, due_at)
  values (t, h, 'services', 'Fix a leaking kitchen tap',
    'Constant drip from the mixer tap. Might need a new cartridge.',
    50000, 180, 'TASK_STARTED', 'Ward 107 Madhapur', lat, lng, b, 45000, 'one_time',
    now() - interval '40 minutes', now() - interval '1 day', now() - interval '2 hours', pay,
    'Repairs & Maintenance', '{Repairs}', 'easy', now() + interval '3 hours');
  insert into bids values (b, t, wpro, 45000, 120, 'Plumber, 8 years. Carry common cartridges.', true, now() - interval '20 hours');
  insert into payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at)
  values (pay, h, t, 'escrow', 46350, 'paid', 'demo', now() - interval '2 hours', now() - interval '2 hours');
  insert into assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at)
  values (a, t, b, wpro, 'started', 46350, 'one_time', now() - interval '2 hours', now() - interval '40 minutes');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b), ('payments', pay), ('assignments', a);

  -- P3: finished last week, both sides reviewed.
  t := gen_random_uuid(); b := gen_random_uuid(); a := gen_random_uuid(); pay := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
    loc_label, loc_lat, loc_lng, locked_bid_id, locked_minor, payout_mode, started_at, work_done_at, completed_at,
    clear_at, created_at, funded_at, funding_payment_id, category, skills, difficulty, due_at)
  values (t, h, 'services', 'Assemble an IKEA wardrobe',
    'PAX wardrobe, two doors, already delivered. Wall anchoring needed.',
    120000, 240, 'COMPLETED', 'Ward 107 Madhapur', lat, lng, b, 110000, 'one_time',
    now() - interval '6 days 5 hours', now() - interval '6 days 2 hours', now() - interval '6 days',
    now() + interval '1 day', now() - interval '8 days', now() - interval '6 days 6 hours', pay,
    'Home Services', '{Carpentry}', 'medium', now() - interval '6 days');
  insert into bids values (b, t, p6789, 110000, 240, 'Assembled 30+ PAX units. Anchoring kit with me.', true, now() - interval '7 days');
  insert into payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at, created_at)
  values (pay, h, t, 'escrow', 113300, 'paid', 'demo', now() - interval '6 days 6 hours', now() - interval '6 days 6 hours');
  insert into assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode, created_at, updated_at)
  values (a, t, b, p6789, 'released', 113300, 'one_time', now() - interval '6 days 6 hours', now() - interval '6 days');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t), ('bids', b), ('payments', pay), ('assignments', a);
  insert into reviews (task_id, author_id, subject_id, about_role, rating, comment, created_at) values
    (t, h, p6789, 'worker', 5, 'Quick, tidy, and anchored it properly.', now() - interval '6 days'),
    (t, p6789, h, 'poster', 5, 'Clear instructions and paid on time.', now() - interval '6 days');
  insert into private.demo_seed (tbl, row_id) select 'reviews', id from reviews where task_id = t;

  -- P4: urgent, no quotes yet.
  t := gen_random_uuid();
  insert into tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, flag, loc_label,
    loc_lat, loc_lng, created_at, category, skills, difficulty, due_at)
  values (t, h, 'local_intel', 'Collect documents from the courier office today',
    'Blue Dart, Hitech City branch. Authorisation letter will be shared with whoever takes it.',
    30000, 240, 'urgent', 'Hitech City, Hyderabad', lat + 0.006, lng + 0.004, now() - interval '25 minutes',
    'Errands & Delivery', '{Errands}', 'easy', now() + interval '5 hours');
  insert into private.demo_seed (tbl, row_id) values ('tasks', t);

  ------------------------------------------------------- wallet and profile --

  -- Earned after 20% commission: W1 960 + W3 1,200 cleared, W2 640 clearing;
  -- 1,000 withdrawn.
  insert into wallets (user_id, balance_minor, clearing_minor) values (h, 116000, 64000)
  on conflict (user_id) do update set balance_minor = 116000, clearing_minor = 64000;

  update profiles set
    worker_rating_avg = 4.67, worker_rating_count = 3,
    poster_rating_avg = 5.0, poster_rating_count = 1,
    bio = coalesce(nullif(bio, ''), 'Content writer from Hyderabad. Blogs, captions, product copy and translations in English and Hindi. Quick turnaround, two free revisions.'),
    skills = case when array_length(skills, 1) is null or array_length(skills, 1) < 3
                  then array['Content writing', 'Translation', 'Proofreading', 'Social media'] else skills end,
    languages = case when array_length(languages, 1) is null then array['English', 'Hindi', 'Telugu'] else languages end
  where id = h;

  ------------------------------------------------------------ notifications --

  with ins as (
  insert into notifications (user_id, kind, title, body, created_at) values
    (h, 'quote', 'New quote on "Deep clean a 2BHK before moving in"', 'Someone quoted ₹2,600', now() - interval '2 hours'),
    (h, 'started', 'Work started on "Fix a leaking kitchen tap"', 'The timer is running.', now() - interval '40 minutes'),
    (h, 'funded', 'Escrow funded for "Proofread a 12-page college project"', 'You can start the work now.', now() - interval '2 hours'),
    (h, 'message', 'New message on "Instagram captions for a café launch (30 posts)"', 'Perfect 👍', now() - interval '4 hours 28 minutes'),
    (h, 'released', 'Payment released for "Product descriptions for 20 handloom sarees"', 'Your earnings are clearing.', now() - interval '2 days')
  returning id
  )
  insert into private.demo_seed (tbl, row_id) select 'notifications', id from ins;

  -- Point each notification at its task, so tapping it opens the post.
  update notifications n set task_id = t.id
    from tasks t
   where n.id in (select row_id from private.demo_seed where tbl = 'notifications')
     and n.task_id is null
     and t.id in (select row_id from private.demo_seed where tbl = 'tasks')
     and n.title like '%"' || t.title || '"%';
end $$;

commit;
