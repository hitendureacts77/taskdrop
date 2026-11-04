-- 147: "money staff, with the authenticator code" as a question a server function can ask the caller (task 2.14, H35).
--
-- private.assert_money_staff() (098) is the one place that says who may move company money: a full admin or
-- finance login, and the authenticator code (aal2) while settings.admin_require_mfa is on. The admin panel reaches
-- it through the database functions it calls. The refund and RazorpayX payout Edge Functions did not: they hold the
-- service key, so the table rules never see the person, and they only looked for the plain "admin" role. A Viewer or
-- Support login (or a stolen one) could send a refund or trigger a give-back with no code.
--
-- private is not reachable from the data API, so this is a thin public wrapper. The functions call it with the
-- caller's own token (not the service key), so auth.uid() and the token's aal are the caller's, and it raises the
-- same plain refusals the panel already shows. It reads nothing and writes nothing.

create or replace function public.check_money_staff()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  return private.assert_money_staff();
end;
$$;
revoke all on function public.check_money_staff() from public, anon;
grant execute on function public.check_money_staff() to authenticated;
