-- Migration 138: the "before user created" auth hook that refuses direct sign-ups (hole H21).
--
-- What is asserted:
--   1. An unconfirmed email sign-up (a direct POST /auth/v1/signup) is refused with a 403.
--   2. An email account that arrives confirmed (phone-auth's admin createUser) and a Google account pass.
--   3. Only the auth server may call it: the app's roles cannot.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/signup_guard.test.sql

begin;

do $$
declare
  v jsonb;
begin
  v := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
    'email', 'p9876500001@phone.taskdrop.app', 'app_metadata', jsonb_build_object('provider', 'email'))));
  if (v -> 'error' ->> 'http_code')::int is distinct from 403 then
    raise exception 'H21: an unconfirmed email sign-up was not refused: %', v;
  end if;

  v := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
    'email', 'someone@example.com', 'email_confirmed_at', '')));
  if v ? 'error' is not true then
    raise exception 'H21: an email sign-up with no provider and an empty confirmation was let through: %', v;
  end if;

  v := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
    'email', 'p9876500001@phone.taskdrop.app', 'email_confirmed_at', '2026-11-02T13:00:00Z',
    'app_metadata', jsonb_build_object('provider', 'email'))));
  if v <> '{}'::jsonb then
    raise exception 'H21: a confirmed account made by the server was refused: %', v;
  end if;

  v := public.hook_before_user_created(jsonb_build_object('user', jsonb_build_object(
    'email', 'someone@gmail.com', 'app_metadata', jsonb_build_object('provider', 'google'))));
  if v <> '{}'::jsonb then
    raise exception 'H21: a Google sign-up was refused: %', v;
  end if;

  if has_function_privilege('anon', 'public.hook_before_user_created(jsonb)', 'execute')
     or has_function_privilege('authenticated', 'public.hook_before_user_created(jsonb)', 'execute') then
    raise exception 'H21: the app''s roles can call the sign-up hook';
  end if;
  if not has_function_privilege('supabase_auth_admin', 'public.hook_before_user_created(jsonb)', 'execute') then
    raise exception 'H21: the auth server cannot call the sign-up hook';
  end if;
end $$;

rollback;
