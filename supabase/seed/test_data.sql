-- Fake test data, for the cloud test project and for CI (Phase 0, "reset to the seed").
--
-- Run with `npm run seed:reset` (it asks first). Safe to run again: it deletes the four
-- test accounts below, which takes everything they own with them (tasks, quotes, chats,
-- wallets, payments, reviews: every table cascades from auth.users), then rebuilds them.
-- It never touches any other account, so testers' own data survives a reset.
--
--   Asha  (poster)   phone 9990000001   Rs 5,000 available to spend
--   Ravi  (worker)   phone 9990000002   Rs 2,000 available, Rs 1,000 clearing, a withdrawal waiting
--   Meera (both)     phone 9990000003   Rs 500 available
--   Test Admin       no phone, no password: sign in with Google or set a password yourself
--
-- Sign-in: while public.settings 'dev_otp_for_all' is true (it is on the test project),
-- phone-auth hands back a code for any number and the app fills it in; once MSG91 is set up,
-- add the three numbers to the phone-auth secret TEST_PHONES instead. The accounts use the
-- same shape phone-auth creates (p<number>@phone.taskdrop.app), so signing in as them
-- reaches these rows.
--
-- Tasks: one in every status (OPEN, LOCKED, TASK_STARTED, OVERDUE, WORK_DONE, REVISION_REQUESTED,
-- COMPLETED, AUTO_COMPLETED, CANCELLED, DISPUTED), local and remote, a posted request and a
-- service listing. All money is fake (provider 'seed').
--
-- NEVER run this on production: it is for the shared test project and throwaway databases only.

begin;

-- ---------------------------------------------------------------- reset ----
delete from auth.users where id in (
  '5eed0000-0000-4000-8000-000000000001', '5eed0000-0000-4000-8000-000000000002',
  '5eed0000-0000-4000-8000-000000000003', '5eed0000-0000-4000-8000-000000000009');

-- ----------------------------------------------------------------- people ----
-- The new-user trigger gives each one a profile, a wallet and the poster and worker roles.
-- The four token columns are '' and not NULL on purpose: GoTrue's admin user list (which
-- phone-auth uses to look a number up) answers 500 if any row has NULL there, and that breaks
-- sign-in for every account, not just these.
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at,
                        raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
                        confirmation_token, recovery_token, email_change_token_new, email_change)
select v.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', v.email, now(),
       '{"provider":"email","providers":["email"]}'::jsonb,
       jsonb_build_object('display_name', v.name) || case when v.phone is null then '{}'::jsonb else jsonb_build_object('phone', v.phone) end,
       now(), now(), '', '', '', ''
from (values
  ('5eed0000-0000-4000-8000-000000000001'::uuid, 'Asha (seed poster)',  'p9990000001@phone.taskdrop.app', '9990000001'),
  ('5eed0000-0000-4000-8000-000000000002'::uuid, 'Ravi (seed worker)',  'p9990000002@phone.taskdrop.app', '9990000002'),
  ('5eed0000-0000-4000-8000-000000000003'::uuid, 'Meera (seed both)',  'p9990000003@phone.taskdrop.app', '9990000003'),
  ('5eed0000-0000-4000-8000-000000000009'::uuid, 'Test Admin (seed)',  'admin@seed.taskdrop.test',        null)
) as v(id, name, email, phone);

insert into auth.identities (id, user_id, provider_id, provider, identity_data, last_sign_in_at, created_at, updated_at)
select gen_random_uuid(), u.id, u.email, 'email',
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       now(), now(), now()
from auth.users u
where u.id::text like '5eed0000-0000-4000-8000-00000000000%';

insert into public.user_roles (user_id, role) values ('5eed0000-0000-4000-8000-000000000009', 'admin') on conflict do nothing;
insert into public.admin_staff (user_id, staff_role, notify) values ('5eed0000-0000-4000-8000-000000000009', 'admin', true) on conflict do nothing;

-- Everyone is an adult who finished onboarding, so no screen stops them.
insert into public.age_checks (user_id, birth_date, passed, min_age)
select id, date '1995-06-15', true, 18 from auth.users where id::text like '5eed0000-0000-4000-8000-00000000000%'
on conflict (user_id) do update set birth_date = excluded.birth_date, passed = true, min_age = 18;

update public.profiles set
  username = case id when '5eed0000-0000-4000-8000-000000000001' then 'seed_asha'
                     when '5eed0000-0000-4000-8000-000000000002' then 'seed_ravi'
                     when '5eed0000-0000-4000-8000-000000000003' then 'seed_meera'
                     else 'seed_admin' end,
  bio = 'Fake test account from supabase/seed/test_data.sql.',
  intent = case id when '5eed0000-0000-4000-8000-000000000001' then 'post'
                   when '5eed0000-0000-4000-8000-000000000002' then 'earn' else 'both' end,
  skills = '{Handyman,Writing,Design}',
  languages = '{English,Hindi,Telugu}',
  loc_label = 'Madhapur, Hyderabad', loc_lat = 17.4486, loc_lng = 78.3908,
  onboarded_at = now(), worker_onboarded_at = now(), last_seen_at = now()
where id::text like '5eed0000-0000-4000-8000-00000000000%';

update public.wallets set
  -- Since migration 066 there is one spendable pool, balance_minor; credits_minor stays 0.
  credits_minor  = 0,
  balance_minor  = case user_id when '5eed0000-0000-4000-8000-000000000001' then 500000
                                when '5eed0000-0000-4000-8000-000000000002' then 200000
                                when '5eed0000-0000-4000-8000-000000000003' then 50000 else 0 end,
  clearing_minor = case user_id when '5eed0000-0000-4000-8000-000000000002' then 100000 else 0 end,
  updated_at = now()
where user_id::text like '5eed0000-0000-4000-8000-00000000000%';

-- ------------------------------------------------------------------ tasks ----
-- From here the table triggers are off, so nothing notifies, bills or fuzzes while we lay data down.
set local session_replication_role = replica;

do $$
declare
  asha  uuid := '5eed0000-0000-4000-8000-000000000001';
  ravi  uuid := '5eed0000-0000-4000-8000-000000000002';
  meera uuid := '5eed0000-0000-4000-8000-000000000003';
  r record;
  t uuid; b uuid; p uuid; a uuid;
  escrow bigint;
  n int := 0;
begin
  for r in
    select * from (values
      -- status, poster, worker, kind, title, place (null = remote), price in paise
      ('OPEN',               asha,  null::uuid, 'request', 'Fix a leaking kitchen tap',               'Madhapur, Hyderabad',  60000),
      ('OPEN',               asha,  null,       'request', 'Design a logo for a home bakery',          null,                  250000),
      ('OPEN',               meera, null,       'service', 'Weekend event photography',                null,                  300000),
      ('LOCKED',             asha,  ravi,       'request', 'Assemble an IKEA wardrobe',                'Gachibowli, Hyderabad',120000),
      ('TASK_STARTED',       asha,  meera,      'request', 'Translate a brochure into Hindi',          null,                   80000),
      ('OVERDUE',            asha,  ravi,       'request', 'Paint one bedroom wall',                   'Kondapur, Hyderabad', 150000),
      ('WORK_DONE',          meera, ravi,       'request', 'Write 5 product descriptions',             null,                   90000),
      ('REVISION_REQUESTED', meera, ravi,       'request', 'Edit a two-minute product video',          null,                  110000),
      ('COMPLETED',          asha,  ravi,       'request', 'Proofread a 10-page report',               null,                  100000),
      ('AUTO_COMPLETED',     meera, ravi,       'request', 'Make 20 Instagram story templates',        null,                   70000),
      ('CANCELLED',          asha,  null,       'request', 'Deliver a parcel across town',             'Banjara Hills, Hyderabad', 40000),
      ('DISPUTED',           asha,  meera,      'request', 'Build a three-page website',               null,                  200000)
    ) as x(status, poster, worker, kind, title, place, price)
  loop
    n := n + 1;
    t := gen_random_uuid(); b := gen_random_uuid(); p := gen_random_uuid(); a := gen_random_uuid();
    escrow := round(r.price * 1.03);

    insert into public.tasks (id, poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status,
      loc_label, loc_lat, loc_lng, kind, category, skills, difficulty, assignment_mode, due_at, created_at,
      locked_bid_id, locked_minor, payout_mode, funded_at, funding_payment_id, funded_via, funded_minor,
      started_at, work_done_at, auto_complete_at, completed_at, clear_at)
    values (t, r.poster, 'services', r.title, 'Fake task ' || n || ' from the test seed. ' || r.title || '.',
      r.price, 2880, r.status::public.task_status,
      coalesce(r.place, 'Remote'),
      case when r.place is null then null else 17.4486 + n * 0.002 end,
      case when r.place is null then null else 78.3908 + n * 0.002 end,
      r.kind, 'Writing & Content', '{Handyman}', 'easy', 'bids',
      case r.status when 'OVERDUE' then now() - interval '1 day' else now() + interval '3 days' end,
      now() - (n || ' hours')::interval,
      case when r.worker is null then null else b end,
      case when r.worker is null then null else r.price end,
      'one_time',
      case when r.worker is null then null else now() - interval '2 days' end,
      case when r.worker is null then null else p end,
      case when r.worker is null then null else 'payment' end,
      case when r.worker is null then null else escrow end,
      case when r.status in ('TASK_STARTED','OVERDUE','WORK_DONE','REVISION_REQUESTED','COMPLETED','AUTO_COMPLETED','DISPUTED') then now() - interval '2 days' end,
      case when r.status in ('WORK_DONE','REVISION_REQUESTED','COMPLETED','AUTO_COMPLETED','DISPUTED') then now() - interval '1 day' end,
      case when r.status in ('WORK_DONE','REVISION_REQUESTED') then now() + interval '2 days' end,
      case when r.status in ('COMPLETED','AUTO_COMPLETED') then now() - interval '12 hours' end,
      case when r.status in ('COMPLETED','AUTO_COMPLETED') then now() + interval '7 days' end);

    -- Open tasks collect a couple of quotes; the rest have one locked quote and a funded escrow.
    if r.worker is null then
      if r.status = 'OPEN' and r.kind = 'request' then
        insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, message)
        values (t, ravi,  r.price,                 1440, 'I can do this today. Happy to chat first.'),
               (t, meera, round(r.price * 0.9)::bigint, 2880, 'Can start tomorrow, slightly lower price.');
      end if;
    else
      insert into public.bids (id, task_id, worker_id, price_minor, time_limit_minutes, message, is_locked)
      values (b, t, r.worker, r.price, 2880, 'Quote for ' || r.title, true);
      insert into public.payments (id, user_id, task_id, purpose, amount_minor, status, provider, paid_at)
      values (p, r.poster, t, 'escrow', escrow, 'paid', 'seed', now() - interval '2 days');
      insert into public.assignments (id, task_id, bid_id, worker_id, status, escrow_minor, payout_mode)
      values (a, t, b, r.worker,
        case when r.status = 'LOCKED' then 'assigned'
             when r.status in ('COMPLETED','AUTO_COMPLETED') then 'released'
             else 'started' end::public.assignment_status,
        escrow, 'one_time');

      if r.status not in ('LOCKED') then
        insert into public.messages (task_id, sender_id, body, created_at) values
          (t, r.poster, 'Hi! Details are in the task. Shout if anything is unclear.', now() - interval '47 hours'),
          (t, r.worker, 'Got it. I will start now.',                                   now() - interval '46 hours');
      end if;
      if r.status in ('WORK_DONE','REVISION_REQUESTED','COMPLETED','AUTO_COMPLETED','DISPUTED') then
        insert into public.task_proofs (task_id, worker_id, summary) values (t, r.worker, 'Finished as agreed. Files are in the chat.');
      end if;
      if r.status = 'COMPLETED' then
        insert into public.reviews (task_id, author_id, subject_id, about_role, rating, comment)
        values (t, r.poster, r.worker, 'worker', 5, 'Careful and on time. Would hire again.');
      end if;
      if r.status = 'DISPUTED' then
        insert into public.task_disputes (task_id, opened_by, reason)
        values (t, r.poster, 'The pages do not match the brief we agreed.');
      end if;
    end if;
  end loop;

  -- A withdrawal waiting for review, and a few notifications to look at.
  insert into public.payouts (user_id, amount_minor, status, destination)
  values (ravi, 60000, 'requested', 'seed.ravi@upi');
  insert into public.notifications (user_id, kind, title, body) values
    (asha,  'bid',    'New quote on your task', 'Ravi quoted on "Fix a leaking kitchen tap".'),
    (ravi,  'locked', 'You were chosen',        'Asha chose you for "Assemble an IKEA wardrobe".'),
    (meera, 'review', 'Work submitted',         'Ravi sent work for "Write 5 product descriptions".');

  -- Saved tasks, and ratings that match the reviews above.
  insert into public.saved_tasks (user_id, task_id)
  select ravi, id from public.tasks where status = 'OPEN' and poster_id = asha limit 1;
  update public.profiles p set
    worker_rating_avg   = coalesce((select avg(rv.rating) from public.reviews rv where rv.subject_id = p.id and rv.about_role = 'worker'), 0),
    worker_rating_count = (select count(*) from public.reviews rv where rv.subject_id = p.id and rv.about_role = 'worker')
  where p.id = ravi;
end $$;

commit;
