-- 082 -- Age gate.
--
-- Nobody under the minimum age may hold an account. The app asks "When were
-- you born?" once per account: before a code is texted to a new phone number,
-- and on the first launch of any signed-in account that has not answered yet
-- (Google sign-ups, and every account made before this migration).
--
-- The answer is recorded here, once, by record_birth_date. The person cannot
-- change it afterwards, so someone who is turned away cannot simply try again
-- with an older year. Under the minimum:
--   * an account with nothing in it (no tasks, quotes, payments, payouts,
--     money or admin role) is deleted outright, and everything it held goes
--     with it -- profiles, wallets, roles and the rest cascade from auth.users;
--   * an account with history is suspended instead, because deleting it would
--     cascade into other people's tasks and the money records. It shows in the
--     admin CRM as suspended with the reason below; an admin settles any money
--     and then deletes it.
--
-- A client cannot finish onboarding until the age check has passed.
--
-- n8n's user.signed_up event (migration 080) used to fire the moment a profile
-- row was made, sending the person's name to n8n before anyone knew their age.
-- It now fires when a new account passes the age check, and never for one that
-- is turned away.
--
-- The minimum (18) lives in two places that must agree: c_min_age below, and
-- MIN_SIGNUP_AGE in packages/rules (the app needs it before an account exists).

-- ------------------------------------------------------------------- table --
create table if not exists public.age_checks (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  birth_date date not null,
  passed     boolean not null,
  min_age    smallint not null,
  checked_at timestamptz not null default now()
);
comment on table public.age_checks is
  'One age check per account. Readable by its owner only; written only by record_birth_date().';

alter table public.age_checks enable row level security;
drop policy if exists age_checks_own_read on public.age_checks;
create policy age_checks_own_read on public.age_checks
  for select to authenticated using (user_id = (select auth.uid()));
revoke all on public.age_checks from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.age_checks from authenticated;
grant select on public.age_checks to authenticated;

-- -------------------------------------------------------------------- rpc --
/**
 * Record the caller's date of birth. Returns 'ok', or 'blocked' when the caller
 * is under the minimum age (the account is then deleted or suspended, see the
 * header). Answering a second time changes nothing and returns the first
 * answer's outcome.
 */
create or replace function public.record_birth_date(p_birth_date date)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_min_age constant smallint := 18;
  v_me    uuid := auth.uid();
  -- The app's people are in India; a birthday starts on their calendar day.
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_prev  public.age_checks;
  v_used  boolean;
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_birth_date is null or p_birth_date > v_today or p_birth_date < date '1900-01-01' then
    raise exception 'Enter your real date of birth';
  end if;

  select * into v_prev from public.age_checks where user_id = v_me;
  if found then
    return case when v_prev.passed then 'ok' else 'blocked' end;
  end if;

  if extract(year from age(v_today, p_birth_date)) >= c_min_age then
    insert into public.age_checks (user_id, birth_date, passed, min_age)
    values (v_me, p_birth_date, true, c_min_age);
    -- A new account (not yet through setup) is now a sign-up worth announcing.
    -- Accounts that predate the check answer it once too; they are not new.
    if exists (select 1 from public.profiles where id = v_me and onboarded_at is null) then
      perform private.emit_event('user.signed_up', jsonb_build_object(
        'user_id', v_me,
        'name', (select display_name from public.profiles where id = v_me)));
    end if;
    return 'ok';
  end if;

  -- Too young. Does anything in this account involve other people or money?
  v_used := exists (select 1 from public.tasks    where poster_id = v_me)
         or exists (select 1 from public.bids     where worker_id = v_me)
         or exists (select 1 from public.payments where user_id = v_me)
         or exists (select 1 from public.payouts  where user_id = v_me)
         or exists (select 1 from public.wallets  where user_id = v_me
                      and (balance_minor <> 0 or clearing_minor <> 0 or credits_minor <> 0))
         or exists (select 1 from public.user_roles where user_id = v_me and role = 'admin');

  if not v_used then
    delete from auth.users where id = v_me;
    return 'blocked';
  end if;

  insert into public.age_checks (user_id, birth_date, passed, min_age)
  values (v_me, p_birth_date, false, c_min_age);
  insert into public.user_suspensions (user_id, reason)
  select v_me, 'Under the minimum age (self-declared at the age check). Settle any money, then delete the account.'
   where not exists (select 1 from public.user_suspensions where user_id = v_me and lifted_at is null);
  -- The same lock-out crm_suspend_user applies: no sign-in, no refresh, no pushes.
  update auth.users set banned_until = now() + interval '100 years' where id = v_me;
  delete from auth.sessions where user_id = v_me;
  delete from auth.refresh_tokens where user_id = v_me::text;
  delete from public.push_tokens where user_id = v_me;
  return 'blocked';
end;
$$;

revoke all on function public.record_birth_date(date) from public, anon;
grant execute on function public.record_birth_date(date) to authenticated;

-- ------------------------------------------------------------------ guard --
-- Invoker rights on purpose: current_user is then the caller's role, so the
-- app is held to the rule while service-role and SECURITY DEFINER paths
-- (seeds, admin tools) are not.
create or replace function private.require_age_check_to_onboard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if new.onboarded_at is not null and old.onboarded_at is null
     and not exists (select 1 from public.age_checks a where a.user_id = new.id and a.passed) then
    raise exception 'Confirm your date of birth before finishing setup';
  end if;
  return new;
end;
$$;
revoke all on function private.require_age_check_to_onboard() from public, anon, authenticated;

drop trigger if exists profiles_require_age_check on public.profiles;
create trigger profiles_require_age_check
  before update of onboarded_at on public.profiles
  for each row execute function private.require_age_check_to_onboard();

-- ------------------------------------------------------ n8n: after the check --
-- record_birth_date announces the sign-up instead (above).
drop trigger if exists n8n_signup on public.profiles;
