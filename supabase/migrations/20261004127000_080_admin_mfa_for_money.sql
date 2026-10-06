-- 080 — An authenticator code (MFA, AAL2) for admin money actions.
--
-- Audit finding F-11 (docs/audit/SECURITY_FINDINGS.md). Admin sign-in is Google
-- or @username + password -- one factor either way. Anything that moves money
-- or changes who holds power now also needs the session to have verified a
-- TOTP code (Supabase Auth puts aal = 'aal2' in the JWT once it has):
--   payouts            marking, settling or giving back someone's withdrawal
--   wallet_adjustments any manual change to someone's balance
--   dispute_decisions  deciding where escrow goes
--   settings           fees, waiting periods, limits
--   user_roles         granting or removing admin
--
-- Enforced here, in the database, so it holds whichever client calls the RPC.
-- The admin panel checks the same thing first to show a helpful message, and
-- gates the actions that run through edge functions (refunds, RazorpayX), which
-- this trigger sees as the service role.
--
-- Not gated: the service role and operator (webhooks, cron, SQL editor);
-- ordinary users; and an admin acting as a person on their own account
-- (requesting or cancelling their own withdrawal).
--
-- settings.admin_require_mfa (default true) is the switch. Turning it ON never
-- needs a code; turning it OFF does, so a stolen password cannot switch it off.

insert into public.settings (key, value) values ('admin_require_mfa', 'true'::jsonb)
on conflict (key) do nothing;

create or replace function private.require_admin_mfa()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := auth.uid();
  v_claims   jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_row      jsonb := to_jsonb(coalesce(new, old));
  v_old      jsonb := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_required boolean;
begin
  if v_actor is null or coalesce(v_claims ->> 'role', '') = 'service_role' then
    return coalesce(new, old);
  end if;
  if not coalesce(private.has_role(v_actor, 'admin'), false) then
    return coalesce(new, old);
  end if;

  -- An admin is also a person: their own withdrawal request, or cancelling it.
  if tg_table_name = 'payouts' and (v_row ->> 'user_id')::uuid = v_actor
     and (tg_op = 'INSERT'
          or (tg_op = 'UPDATE' and v_row ->> 'status' = 'cancelled' and v_old ->> 'status' = 'requested')) then
    return coalesce(new, old);
  end if;

  -- Switching the requirement on never needs a code.
  if tg_table_name = 'settings' and tg_op <> 'DELETE'
     and v_row ->> 'key' = 'admin_require_mfa' and v_row -> 'value' = 'true'::jsonb then
    return new;
  end if;

  select s.value = 'true'::jsonb into v_required from public.settings s where s.key = 'admin_require_mfa';
  if coalesce(v_required, true) and coalesce(v_claims ->> 'aal', '') <> 'aal2' then
    raise exception 'Verify your authenticator code first (Security page in the admin panel)'
      using errcode = '42501';
  end if;
  return coalesce(new, old);
end;
$$;
revoke all on function private.require_admin_mfa() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['payouts', 'wallet_adjustments', 'dispute_decisions', 'settings', 'user_roles']
  loop
    execute format('drop trigger if exists require_admin_mfa on public.%I', t);
    execute format('create trigger require_admin_mfa before insert or update or delete on public.%I
                    for each row execute function private.require_admin_mfa()', t);
  end loop;
end;
$$;
