-- What a new account is called (migration 115). Rolls back; leaves nothing.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/new_user_names.test.sql

begin;

do $$
declare
  v_google uuid := gen_random_uuid();
  v_relay  uuid := gen_random_uuid();
  v_phone  uuid := gen_random_uuid();
  v_email  uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, raw_user_meta_data, created_at, updated_at)
  values
    (v_google, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'g' || v_google || '@gmail.test', '', '{"full_name":"  Asha Rao "}', now(), now()),
    (v_relay,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'abc123@privaterelay.appleid.com', '', '{}', now(), now()),
    (v_phone,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'p9876543210@phone.taskdrop.app', '', '{}', now(), now()),
    (v_email,  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ravi.k@example.test', '', '{}', now(), now());

  assert (select display_name from public.profiles where id = v_google) = 'Asha Rao', 'a Google name is used, trimmed';
  assert (select display_name from public.profiles where id = v_relay) = 'New user', 'an Apple relay address is never a name';
  assert (select display_name from public.profiles where id = v_phone) = 'p9876543210', 'phone accounts are named as before';
  assert (select display_name from public.profiles where id = v_email) = 'ravi.k', 'an ordinary email still gives its first part';
  assert exists (select 1 from public.wallets where user_id = v_google), 'the wallet is still created';

  raise notice 'new_user_names: all assertions passed';
end;
$$;

rollback;
