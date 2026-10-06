-- 077 — Count an OTP guess and check the cap in one statement.
--
-- Audit finding F-07 (docs/audit/SECURITY_FINDINGS.md).
--
-- phone-auth read `attempts`, compared the code, then wrote `attempts + 1` in a
-- separate statement, so many concurrent guesses could all read the same low
-- number and exceed MAX_ATTEMPTS. This does the increment and the cap check in a
-- single UPDATE: a guess that would exceed the cap matches no row.
--
-- Service role only (the edge function). Nothing here is callable from the app.

create or replace function public.consume_auth_attempt(p_phone text, p_max integer)
returns table (out_code text, out_expires timestamptz, out_attempts integer)
language sql
security definer
set search_path = public, pg_temp
as $$
  update public.auth_codes
     set attempts = attempts + 1
   where phone = p_phone
     and attempts < p_max
  returning code, expires_at, attempts;
$$;

revoke all on function public.consume_auth_attempt(text, integer) from public, anon, authenticated;
grant execute on function public.consume_auth_attempt(text, integer) to service_role;
