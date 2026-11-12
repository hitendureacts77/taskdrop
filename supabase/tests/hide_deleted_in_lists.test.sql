-- Public lists and the "Open tasks" number show only what people can see
-- (migration 166, debug loop B30 and B32). Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/hide_deleted_in_lists.test.sql

begin;

do $$
declare
  v_live    uuid := gen_random_uuid();
  v_gone    uuid := gen_random_uuid();
  v_before  bigint;
  v_after   bigint;
  v_hidden  uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'hdl+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_live), (v_gone)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_live, 'HDL Live'), (v_gone, 'HDL Gone') on conflict (id) do nothing;
  insert into public.wallets (user_id) values (v_live), (v_gone) on conflict (user_id) do nothing;
  update public.profiles set onboarded_at = now(), created_at = now() where id in (v_live, v_gone);

  v_before := (private.platform_highlights_live() ->> 'openTasks')::bigint;

  -- B32: one post people can see, and four they cannot.
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, due_at)
  values (v_live, 'services', 'hdl visible', 100000, 240, 'Plumbing', now() + interval '2 days');
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, due_at)
  values (v_live, 'services', 'hdl past due', 100000, 240, 'Plumbing', now() - interval '1 day');
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category, kind)
  values (v_live, 'services', 'hdl service listing', 100000, 240, 'Plumbing', 'service');
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category)
  values (v_live, 'services', 'hdl removed by staff', 100000, 240, 'Plumbing') returning id into v_hidden;
  insert into public.task_moderation (task_id, reason) values (v_hidden, 'test');
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, category)
  values (v_gone, 'services', 'hdl deleted poster', 100000, 240, 'Plumbing');

  -- B30: one account deleted.
  update public.profiles set deleted_at = now() where id = v_gone;

  v_after := (private.platform_highlights_live() ->> 'openTasks')::bigint;
  assert v_after - v_before = 1,
    format('FAIL: openTasks counts only what the feed shows (went up by %s, expected 1)', v_after - v_before);

  assert exists (select 1 from private.top_earners_live('new_talent', 30) e where e.id = v_live),
    'FAIL: a new, live helper is in New talent';
  assert not exists (select 1 from private.top_earners_live('new_talent', 30) e where e.id = v_gone),
    'FAIL: a deleted account is not in New talent';
  assert not exists (select 1 from public.top_earners('new_talent', 30) e where e.id = v_gone),
    'FAIL: a deleted account is not in the public New talent list';
end;
$$;

rollback;
