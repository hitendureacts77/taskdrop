-- 088 -- Harder limits on the two public sign-in doors.
--
-- phone-auth and password-auth are public (verify_jwt = false), so their
-- throttles are the only thing between the internet and guessing. Three gaps:
--
-- 1. phone-auth's per-IP budget was read, compared and written back in three
--    steps, so a burst of concurrent requests all saw the same count (the same
--    race 077 fixed for code guesses). hit_auth_send_ip() counts and checks in
--    one statement.
-- 2. password-auth counted failures with two separate queries and, if either
--    failed, read the count as 0 and let the attempt through. It also only
--    had a 15-minute window, so a patient script got 8 guesses every 15
--    minutes forever (768 a day per username). password_sign_in_gate() answers
--    in one call with a daily cap on top, and the function now refuses when the
--    gate cannot be reached.
-- 3. Nobody was told when their account was being guessed at.
--    record_password_attempt() notifies the owner the moment their username
--    locks.
--
-- password_attempts rows older than 30 days are pruned; they only feed these
-- windows.
--
-- Service role only. Nothing here is callable from the app.

-- ------------------------------------------------------------ phone sends --
/**
 * Count one send-code request from p_ip and say whether it is within budget:
 * at most p_max per p_window_min minutes. Over budget, nothing is counted.
 */
create or replace function public.hit_auth_send_ip(p_ip text, p_max integer, p_window_min integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sends integer;
begin
  insert into public.auth_send_log as l (ip, sends, window_started_at)
  values (p_ip, 1, now())
  on conflict (ip) do update
     set sends = case when l.window_started_at < now() - make_interval(mins => p_window_min) then 1 else l.sends + 1 end,
         window_started_at = case when l.window_started_at < now() - make_interval(mins => p_window_min) then now() else l.window_started_at end
   where l.window_started_at < now() - make_interval(mins => p_window_min)
      or l.sends < p_max
  returning sends into v_sends;
  -- No row back: the window is current and already at the cap.
  return v_sends is not null;
end;
$$;
revoke all on function public.hit_auth_send_ip(text, integer, integer) from public, anon, authenticated;
grant execute on function public.hit_auth_send_ip(text, integer, integer) to service_role;

-- ------------------------------------------------------- password sign-in --
create index if not exists password_attempts_fail_user_idx
  on public.password_attempts (username, at desc) where not ok;
create index if not exists password_attempts_fail_ip_idx
  on public.password_attempts (ip, at desc) where not ok;

/**
 * May another password attempt for p_username from p_ip go ahead?
 * Returns null when it may, or the number of minutes to wait.
 *
 *   per username   8 failures in 15 minutes, 20 in 24 hours
 *   per IP        40 failures in 15 minutes, 200 in 24 hours
 */
create or replace function public.password_sign_in_gate(p_username text, p_ip text)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  with f as (
    select
      count(*) filter (where username = p_username and at > now() - interval '15 minutes') as user_15m,
      count(*) filter (where username = p_username)                                         as user_24h,
      count(*) filter (where ip = p_ip and at > now() - interval '15 minutes')              as ip_15m,
      count(*) filter (where ip = p_ip)                                                     as ip_24h
    from public.password_attempts
    where not ok
      and at > now() - interval '24 hours'
      and (username = p_username or (p_ip is not null and ip = p_ip))
  )
  select case
           when user_24h >= 20 or ip_24h >= 200 then 24 * 60
           when user_15m >= 8  or ip_15m >= 40  then 15
         end
    from f
$$;
revoke all on function public.password_sign_in_gate(text, text) from public, anon, authenticated;
grant execute on function public.password_sign_in_gate(text, text) to service_role;

/**
 * Log one password attempt. When a failure is the one that locks the username
 * (the 8th in 15 minutes or the 20th in a day), tell the account's owner.
 */
create or replace function public.record_password_attempt(p_username text, p_ip text, p_ok boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_15m  integer;
  v_24h  integer;
  v_user uuid;
begin
  insert into public.password_attempts (username, ip, ok) values (p_username, p_ip, p_ok);
  if p_ok then return; end if;

  select count(*) filter (where at > now() - interval '15 minutes'), count(*)
    into v_15m, v_24h
    from public.password_attempts
   where username = p_username and not ok and at > now() - interval '24 hours';

  if v_15m = 8 or v_24h = 20 then
    select id into v_user from public.profiles where username = p_username and deleted_at is null;
    perform private.notify(
      v_user, 'security',
      'Someone is trying to sign in as @' || p_username,
      case when v_24h = 20
        then 'Password sign-in is paused for 24 hours after too many wrong passwords. If this wasn’t you, set a new password in Account & settings.'
        else 'Password sign-in is paused for 15 minutes after several wrong passwords. If this wasn’t you, set a new password in Account & settings.'
      end);
  end if;
end;
$$;
revoke all on function public.record_password_attempt(text, text, boolean) from public, anon, authenticated;
grant execute on function public.record_password_attempt(text, text, boolean) to service_role;

-- ------------------------------------------------------------------ prune --
do $$
begin
  if exists (select 1 from cron.job where jobname = 'password-attempts-prune') then
    perform cron.unschedule('password-attempts-prune');
  end if;
  perform cron.schedule(
    'password-attempts-prune',
    '17 * * * *',
    $c$delete from public.password_attempts where at < now() - interval '30 days'$c$
  );
end;
$$;
