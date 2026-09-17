-- 037 — write a secret into Vault from an Edge Function.
--
-- The counterpart to app_secrets(), which reads. This exists so the webhook
-- signing secret can be generated and stored server-side and handed straight
-- to Razorpay, without any human, log or transcript ever seeing the value.
--
-- Service role only. Returns nothing but a name, so it can never echo a value.
create or replace function public.set_app_secret(p_name text, p_value text)
returns text
language plpgsql
security definer
set search_path = public, vault, pg_temp
as $$
declare
  v_role text := coalesce(current_setting('request.jwt.claims', true)::json->>'role', '');
  v_id   uuid;
begin
  if v_role <> 'service_role' then
    raise exception 'Only the platform sets secrets';
  end if;
  if p_name is null or btrim(p_name) = '' or p_value is null or btrim(p_value) = '' then
    raise exception 'A secret needs a name and a value';
  end if;

  select id into v_id from vault.secrets where name = p_name;

  if v_id is null then
    perform vault.create_secret(p_value, p_name, 'TaskDrop');
  else
    perform vault.update_secret(v_id, p_value, p_name, 'TaskDrop');
  end if;

  return p_name;
end;
$$;

revoke all on function public.set_app_secret(text, text) from public, anon, authenticated;
grant execute on function public.set_app_secret(text, text) to service_role;
