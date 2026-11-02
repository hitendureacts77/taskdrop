-- 138: refuse accounts made directly at Supabase (hole H21, docs/ULTIMATE_PLAN.md task 2.8b).
--
-- Anyone holding the public key can POST /auth/v1/signup with an email and a password. TaskDrop never
-- does: phone accounts are made by phone-auth (admin createUser, email already confirmed) and Google
-- accounts by Google. A direct sign-up is worse than junk: an attacker can sign up as
-- p<someone's phone>@phone.taskdrop.app with a password they choose. When that person later signs in
-- by phone, phone-auth finds the account, the magic link confirms its email, and the attacker's
-- password now opens the person's account.
--
-- This function is Supabase's "before user created" auth hook. It lets through every provider except
-- email, and an email account only when it arrives already confirmed (only the server can create one,
-- because mailer_autoconfirm is off). Turned on in the project's Auth settings, not here:
--   hook_before_user_created_enabled = true
--   hook_before_user_created_uri     = pg-functions://postgres/public/hook_before_user_created
-- phone-auth also ignores and removes an unconfirmed account on a phone address, so a squatter made
-- before this hook was switched on cannot be used either.

create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  u jsonb := event -> 'user';
begin
  if coalesce(u -> 'app_metadata' ->> 'provider', 'email') <> 'email' then
    return '{}'::jsonb;
  end if;
  if nullif(u ->> 'email_confirmed_at', '') is not null then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Create your account in the TaskDrop app.'
  ));
end;
$$;

comment on function public.hook_before_user_created(jsonb) is
  'Auth hook (before user created): refuses unconfirmed email sign-ups made directly at Supabase. Hole H21, migration 138.';

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
