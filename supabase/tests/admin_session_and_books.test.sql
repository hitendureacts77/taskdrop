-- Migration 229: an admin token's session limits (H37) and the Plan B books check (H34). Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/admin_session_and_books.test.sql

begin;

create or replace function pg_temp.claims(p_user uuid, p_session text) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    case when p_session is null then json_build_object('sub', p_user, 'role', 'authenticated')
         else json_build_object('sub', p_user, 'role', 'authenticated', 'session_id', p_session) end::text, true);
end;
$$;

do $$
declare
  v_admin   uuid := gen_random_uuid();
  v_poster  uuid := gen_random_uuid();
  v_worker  uuid := gen_random_uuid();
  v_fresh   uuid := gen_random_uuid();
  v_old     uuid := gen_random_uuid();
  v_idle    uuid := gen_random_uuid();
  v_busy    uuid := gen_random_uuid();
  v_task    uuid;
  v_good    uuid := gen_random_uuid();
  v_bad     uuid := gen_random_uuid();
  v_unpaid  uuid := gen_random_uuid();
  v_codes   text[];
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'sess229+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_poster), (v_worker)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'Admin 229'), (v_poster, 'Poster 229'), (v_worker, 'Worker 229') on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  insert into auth.sessions (id, user_id, created_at, updated_at, refreshed_at) values
    (v_fresh, v_admin, now() - interval '5 minutes', now() - interval '5 minutes', null),
    (v_old,   v_admin, now() - interval '13 hours',  now() - interval '1 minute',  (now() - interval '1 minute') at time zone 'UTC'),
    (v_idle,  v_admin, now() - interval '3 hours',   now() - interval '2 hours',   (now() - interval '2 hours') at time zone 'UTC'),
    (v_busy,  v_admin, now() - interval '3 hours',   now() - interval '2 hours',   (now() - interval '10 minutes') at time zone 'UTC');

  -- ---- H37: the token's session decides -------------------------------------------------------
  perform pg_temp.claims(v_admin, null);
  assert private.admin_session_ok(), 'a token naming no session is judged as before';
  perform pg_temp.claims(v_admin, v_fresh::text);
  assert private.admin_session_ok(), 'a fresh session is fine';
  perform pg_temp.claims(v_admin, v_busy::text);
  assert private.admin_session_ok(), 'a session refreshed 10 minutes ago is fine';
  perform pg_temp.claims(v_admin, v_old::text);
  assert not private.admin_session_ok(), 'a session older than 12 hours is refused, however busy';
  perform pg_temp.claims(v_admin, v_idle::text);
  assert not private.admin_session_ok(), 'a session unused for 2 hours is refused';
  perform pg_temp.claims(v_admin, gen_random_uuid()::text);
  assert not private.admin_session_ok(), 'a session that no longer exists (signed out) is refused';
  perform pg_temp.claims(v_admin, 'not-a-uuid');
  assert not private.admin_session_ok(), 'a garbled session id is refused';

  -- The limits are settings, clamped to sane bounds.
  update public.settings set value = to_jsonb(14) where key = 'admin_session_hours';
  perform pg_temp.claims(v_admin, v_old::text);
  assert private.admin_session_ok(), 'admin_session_hours moves the absolute limit';
  update public.settings set value = to_jsonb(12) where key = 'admin_session_hours';

  -- The app's callers cannot reach the check directly.
  assert not has_function_privilege('authenticated', 'private.admin_session_ok()', 'EXECUTE'),
    'admin_session_ok is not callable by signed-in people';
  assert not has_function_privilege('anon', 'private.admin_session_ok()', 'EXECUTE'),
    'admin_session_ok is not callable by guests';

  perform set_config('request.jwt.claims', '', true);

  -- ---- H34: every Plan B hold's ledger adds up ------------------------------------------------
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes)
  values (v_poster, 'services', 'Books check 229', 100000, 240) returning id into v_task;

  -- A released hold whose rows add up (charged 103000 = released 80000 + fee 3000 + commission 20000).
  insert into public.task_holds (id, task_id, poster_id, worker_id, provider, status, offer_minor, charged_minor,
                                 fee_minor, commission_minor, worker_share_minor, release_minor, refund_minor,
                                 paid_at, settled_at)
  values (v_good, v_task, v_poster, v_worker, 'simulated', 'released', 100000, 103000, 3000, 20000, 80000, 80000, 0,
          now(), now());
  insert into public.money_ledger (hold_id, task_id, user_id, kind, amount_minor, idem_key) values
    (v_good, v_task, v_poster, 'paid',        103000, 't229:paid:'     || v_good),
    (v_good, v_task, v_worker, 'on_hold',      80000, 't229:on_hold:'  || v_good),
    (v_good, v_task, v_worker, 'released',     80000, 't229:released:' || v_good),
    (v_good, v_task, null,     'service_fee',   3000, 't229:fee:'      || v_good),
    (v_good, v_task, null,     'commission',   20000, 't229:comm:'     || v_good);

  -- A refunded hold that sent back more than was paid, and a paid hold missing its 'paid' row.
  insert into public.task_holds (id, task_id, poster_id, worker_id, provider, status, offer_minor, charged_minor,
                                 fee_minor, commission_minor, worker_share_minor, release_minor, refund_minor,
                                 paid_at, settled_at)
  values (v_bad, v_task, v_poster, v_worker, 'simulated', 'refunded', 100000, 103000, 3000, 20000, 80000, 0, 103000,
          now(), now());
  insert into public.money_ledger (hold_id, task_id, user_id, kind, amount_minor, idem_key) values
    (v_bad, v_task, v_poster, 'paid',      103000, 't229:paid:'     || v_bad),
    (v_bad, v_task, v_worker, 'on_hold',    80000, 't229:on_hold:'  || v_bad),
    (v_bad, v_task, v_poster, 'refunded',  104000, 't229:refunded:' || v_bad);

  insert into public.task_holds (id, task_id, poster_id, worker_id, provider, status, offer_minor, charged_minor,
                                 fee_minor, commission_minor, worker_share_minor, paid_at)
  values (v_unpaid, v_task, v_poster, v_worker, 'simulated', 'released', 100000, 103000, 3000, 20000, 80000, now());

  select array_agg(check_code || ':' || ref_id::text) into v_codes
    from private.reconcile_rows(current_date - 1, current_date + 1)
   where ref_type = 'hold' and ref_id in (v_good, v_bad, v_unpaid);

  assert not ('hold_paid_not_in_ledger:' || v_good) = any (coalesce(v_codes, '{}')), 'a balanced hold is not flagged as unpaid';
  assert not ('hold_settled_unbalanced:' || v_good) = any (coalesce(v_codes, '{}')), 'a balanced hold is not flagged as unbalanced';
  assert ('hold_settled_unbalanced:' || v_bad) = any (coalesce(v_codes, '{}')), 'a refund larger than the payment is flagged';
  assert ('hold_paid_not_in_ledger:' || v_unpaid) = any (coalesce(v_codes, '{}')), 'a paid hold with no paid row is flagged';
  assert ('hold_settled_unbalanced:' || v_unpaid) = any (coalesce(v_codes, '{}')), 'a released hold with nothing out is flagged';

  raise notice 'admin_session_and_books: all checks passed';
end;
$$;

rollback;
