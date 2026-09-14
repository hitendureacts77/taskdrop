-- Edge Functions read their secrets over PostgREST, and PostgREST only exposes
-- the schemas listed in its config -- `vault` is not one of them, and adding it
-- would put every decrypted secret one HTTP call away from anon. So the only
-- door into Vault is this function, and it is bolted shut to everyone except
-- the service role.
create or replace function public.app_secrets()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  -- Belt as well as braces: even if a GRANT is ever loosened by accident, a
  -- caller that is not the service role leaves with nothing.
  if current_setting('request.jwt.claim.role', true) is distinct from 'service_role'
     and current_user <> 'service_role'
     and current_user <> 'postgres' then
    raise exception 'not authorised';
  end if;

  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
    into result
    from vault.decrypted_secrets;

  return result;
end;
$$;

-- Supabase's default privileges hand EXECUTE on new public functions to anon
-- and authenticated. Take it back before anything can use it.
revoke all on function public.app_secrets() from public;
revoke all on function public.app_secrets() from anon;
revoke all on function public.app_secrets() from authenticated;
grant execute on function public.app_secrets() to service_role;

comment on function public.app_secrets() is
  'Service-role-only bridge to Vault, so Edge Functions can read secrets without the vault schema being exposed to PostgREST.';
