-- 116 — an admin can sign someone out of every device (Phase 4).
--
-- For a lost phone or a shared device: ends every session and refresh token of
-- one person. They sign in again with the same method. (A short-lived access
-- token already issued can work for up to an hour; the same limit applies to
-- suspending someone, migration 071.) Admins only, a reason is required, the
-- person must exist and cannot be the caller, and it is written to the audit
-- log. Returns how many sessions were ended.

create or replace function public.admin_sign_out_everywhere(p_user uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_actor uuid := auth.uid();
  v_count integer;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not private.staff_can(v_actor, 'admin') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
      using errcode = '42501';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why, so the next admin knows'; end if;
  if p_user = v_actor then raise exception 'Use Sign out on your own devices instead'; end if;
  if not exists (select 1 from auth.users where id = p_user) then raise exception 'That person no longer exists'; end if;

  select count(*) into v_count from auth.sessions where user_id = p_user;
  delete from auth.sessions where user_id = p_user;
  delete from auth.refresh_tokens where user_id = p_user::text;
  delete from public.push_tokens where user_id = p_user;

  perform public.admin_log_event(
    'user_signed_out_everywhere',
    'user:' || p_user,
    left('reason: ' || left(btrim(p_reason), 200) || '; sessions ended: ' || v_count, 500));
  return v_count;
end;
$fn$;
revoke all on function public.admin_sign_out_everywhere(uuid, text) from public, anon;
grant execute on function public.admin_sign_out_everywhere(uuid, text) to authenticated;
