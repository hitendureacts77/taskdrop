-- Deleting an account erases what the person wrote and left behind (migration 108).
--
-- What is asserted, for a person with no money in motion:
--   1. Everything they said in anyone's chat is gone; other people's messages in
--      the same chat stay.
--   2. Every request of theirs that nobody paid for is emptied (title,
--      description, place) and its chat is gone, whether it was open or had been
--      cancelled earlier.
--   3. Their devices, referrals (both directions), blocks (both directions) and
--      CRM lead rows are gone.
--   4. The profile is emptied and marked deleted, and the sign-in is closed.
--   5. A second person's own data is untouched.
--   6. A request that WAS paid for keeps its title and its chat.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/account_deletion.test.sql

begin;

create or replace function pg_temp.make_user(p_name text) returns uuid
language plpgsql as $$
declare
  v_user uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          'test+' || v_user || '@taskdrop.test', '', now(), now(), now());
  insert into public.profiles (id, display_name) values (v_user, p_name) on conflict (id) do nothing;
  update public.profiles set display_name = p_name where id = v_user;
  insert into public.wallets (user_id) values (v_user) on conflict (user_id) do nothing;
  return v_user;
end;
$$;

do $$
declare
  v_a      uuid := pg_temp.make_user('Leaving Person');
  v_b      uuid := pg_temp.make_user('Staying Person');
  v_c      uuid := pg_temp.make_user('Blocking Person');
  v_open   uuid;
  v_old    uuid;
  v_paid   uuid;
  v_theirs uuid;
  v_n      bigint;
  v_row    record;
begin
  -- A's requests: one open, one cancelled earlier, one that was paid for.
  insert into public.tasks (poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, loc_label)
  values (v_a, 'services', 'Open one', 'private details', 100000, 240, 'Koramangala') returning id into v_open;
  insert into public.tasks (poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status)
  values (v_a, 'services', 'Old cancelled', 'secret', 100000, 240, 'CANCELLED') returning id into v_old;
  insert into public.tasks (poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, status, funded_at, completed_at)
  values (v_a, 'services', 'Paid and done', 'kept', 100000, 240, 'COMPLETED', now(), now()) returning id into v_paid;
  -- B's request, where A once chatted.
  insert into public.tasks (poster_id, pillar, title, description, benchmark_minor, time_limit_minutes)
  values (v_b, 'services', 'B request', 'b stuff', 100000, 240) returning id into v_theirs;

  insert into public.messages (task_id, sender_id, body) values
    (v_open,   v_a, 'a on open'),   (v_open,   v_b, 'b on open'),
    (v_old,    v_a, 'a on old'),
    (v_paid,   v_a, 'a on paid'),   (v_paid,   v_b, 'b on paid'),
    (v_theirs, v_a, 'a on theirs'), (v_theirs, v_b, 'b on theirs');

  insert into public.app_devices (user_id, install_id, platform) values (v_a, 'install-a-0001', 'android'), (v_b, 'install-b-0001', 'android');
  insert into public.referrals (referred_id, referrer_id) values (v_a, v_b);
  insert into public.blocks (blocker_id, blocked_id) values (v_a, v_b), (v_c, v_a), (v_b, v_c);
  insert into public.crm_leads (name, contact, kind, user_id) values ('Leaving Person', '+910000000000', 'person', v_a);

  perform private.delete_account(v_a);

  -- 1. chat
  select count(*) into v_n from public.messages where sender_id = v_a;
  if v_n <> 0 then raise exception 'FAIL: % of the deleted person''s messages remain', v_n; end if;
  select count(*) into v_n from public.messages where task_id = v_theirs and sender_id = v_b;
  if v_n <> 1 then raise exception 'FAIL: the other person''s message in a shared chat was lost'; end if;

  -- 2. unpaid requests
  for v_row in select id, title, description, loc_label, status from public.tasks where id in (v_open, v_old) loop
    if v_row.title <> 'Removed' or v_row.description <> '' or v_row.loc_label is not null or v_row.status <> 'CANCELLED' then
      raise exception 'FAIL: an unpaid request kept what the person wrote: %', to_jsonb(v_row);
    end if;
  end loop;
  select count(*) into v_n from public.messages where task_id in (v_open, v_old);
  if v_n <> 0 then raise exception 'FAIL: % messages remain in unpaid requests', v_n; end if;

  -- 6. paid request stays whole, with the other person's side of the chat
  if (select title from public.tasks where id = v_paid) <> 'Paid and done' then
    raise exception 'FAIL: a paid request was emptied';
  end if;
  select count(*) into v_n from public.messages where task_id = v_paid;
  if v_n <> 1 then raise exception 'FAIL: expected only the other person''s message on the paid request, found %', v_n; end if;

  -- 3. leftovers
  if exists (select 1 from public.app_devices where user_id = v_a) then raise exception 'FAIL: a device record remains'; end if;
  if exists (select 1 from public.referrals where referred_id = v_a or referrer_id = v_a) then raise exception 'FAIL: a referral remains'; end if;
  if exists (select 1 from public.blocks where blocker_id = v_a or blocked_id = v_a) then raise exception 'FAIL: a block remains'; end if;
  if exists (select 1 from public.crm_leads where user_id = v_a) then raise exception 'FAIL: a CRM lead remains'; end if;

  -- 4. profile and sign-in
  select * into v_row from public.profiles where id = v_a;
  if v_row.display_name <> 'Deleted user' or v_row.deleted_at is null then
    raise exception 'FAIL: the profile was not emptied: %', to_jsonb(v_row);
  end if;
  if (select banned_until from auth.users where id = v_a) < now() + interval '50 years' then
    raise exception 'FAIL: the account can still sign in';
  end if;

  -- 5. B untouched
  if (select display_name from public.profiles where id = v_b) <> 'Staying Person' then raise exception 'FAIL: another person''s profile changed'; end if;
  if not exists (select 1 from public.app_devices where user_id = v_b) then raise exception 'FAIL: another person''s device record was removed'; end if;
  if not exists (select 1 from public.blocks where blocker_id = v_b and blocked_id = v_c) then raise exception 'FAIL: a block between two other people was removed'; end if;
  if (select title from public.tasks where id = v_theirs) <> 'B request' then raise exception 'FAIL: another person''s request changed'; end if;

  raise notice 'account_deletion: all checks passed';
end;
$$;

rollback;
