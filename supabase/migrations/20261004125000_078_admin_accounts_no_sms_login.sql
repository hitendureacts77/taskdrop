-- 078 — Admin accounts never sign in with a text-message code.
--
-- Audit finding F-27 (docs/audit/SECURITY_FINDINGS.md). The admin panel's
-- sign-in is Google or @username + password. Removing the button is not enough:
-- phone-auth mints a session for any phone-created account, and an admin
-- session can call the admin RPCs directly. phone-auth asks this before it
-- sends a code and again before it mints a session.
--
-- Service role only (the edge function).

create or replace function public.phone_account_is_admin(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
      from auth.users u
      join public.user_roles r on r.user_id = u.id and r.role = 'admin'
     where lower(u.email) = lower(p_email)
  );
$$;

revoke all on function public.phone_account_is_admin(text) from public, anon, authenticated;
grant execute on function public.phone_account_is_admin(text) to service_role;
