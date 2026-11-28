-- A new phone account is never named from its phone number (migration 242).
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/new_user_name.test.sql

begin;

do $$
declare
  v_phone uuid := gen_random_uuid();
  v_mail  uuid := gen_random_uuid();
  v_named uuid := gen_random_uuid();
  v_name  text;
begin
  insert into auth.users (id, email, raw_user_meta_data)
    values (v_phone, 'p919800000077@phone.taskdrop.app', '{"phone":"919800000077"}'::jsonb);
  select display_name into v_name from public.profiles where id = v_phone;
  if v_name <> 'New user' then raise exception 'phone account got the name %', v_name; end if;

  insert into auth.users (id, email, raw_user_meta_data)
    values (v_mail, 'asha.rao@example.com', '{}'::jsonb);
  select display_name into v_name from public.profiles where id = v_mail;
  if v_name <> 'asha.rao' then raise exception 'email account got the name %', v_name; end if;

  insert into auth.users (id, email, raw_user_meta_data)
    values (v_named, 'p919800000078@phone.taskdrop.app', '{"display_name":"Ravi"}'::jsonb);
  select display_name into v_name from public.profiles where id = v_named;
  if v_name <> 'Ravi' then raise exception 'chosen name lost: %', v_name; end if;
end $$;

rollback;
