-- 133: money safety limits for new accounts, and a flag for self-dealing (plan task 2.11, hole H17).
--
-- The break-in tests stop hackers. This stops people who use the app as designed but dishonestly:
-- a brand-new account paying a large amount with a stolen card, or one person posting a job and
-- "doing" it from a second account to move money.
--
--   1. Limits for new accounts. An account is NEW until it is both `new_account_days` old (30) and has
--      `new_account_tasks` finished jobs (3). While new:
--        - one job may be worth at most `new_account_max_task_minor` (Rs 5,000), checked when a job is posted
--          and again when an offer is chosen (the amount held);
--        - withdrawals add up to at most `new_account_max_withdraw_day_minor` (Rs 5,000) per India day.
--      The limits rise by themselves: each finished job with a review of 4 stars or more adds one more
--      multiple of the base limit (up to the number of finished jobs that ends "new"). The 7-day earnings
--      clearing is untouched.
--   2. Self-dealing flag. When a poster and the chosen worker share a payout account (UPI id or bank
--      account) or an app install (a device), an alert is left for the admin Alerts page and the team is
--      told. The job is NOT blocked: a person decides.
--
-- All four numbers are settings the admin changes without a release (Settings). The checks run for the
-- app's own roles only (the signed-in people); the server, the seed and admin tools are not limited.
--
-- Additive and repeatable: four setting rows, new functions, triggers created if missing.

insert into public.settings (key, value) values
  ('new_account_max_task_minor',         '500000'::jsonb),
  ('new_account_max_withdraw_day_minor', '500000'::jsonb),
  ('new_account_days',                   '30'::jsonb),
  ('new_account_tasks',                  '3'::jsonb)
on conflict (key) do nothing;

-- A number setting, or the default when it is missing or not a number.
create or replace function private.setting_int(p_key text, p_default bigint)
returns bigint
language sql stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select case when jsonb_typeof(value) = 'number' then floor((value #>> '{}')::numeric)::bigint end
       from public.settings where key = p_key),
    p_default)
$$;
revoke all on function private.setting_int(text, bigint) from public, anon, authenticated;

-- Only the people using the app are limited; the server, the seed script and admin tools are not.
create or replace function private.is_app_caller()
returns boolean
language sql stable
set search_path = ''
as $$ select coalesce(nullif(current_setting('role', true), ''), 'none') in ('authenticated', 'anon') $$;
revoke all on function private.is_app_caller() from public, anon, authenticated;

-- The limit for this person, or null when they are no longer new. `p_base` is the base limit in paise.
create or replace function private.new_account_cap(p_user uuid, p_base bigint)
returns bigint
language plpgsql stable
security definer
set search_path = ''
as $$
declare
  v_created timestamptz;
  v_days    integer := private.setting_int('new_account_days', 30);
  v_need    integer := private.setting_int('new_account_tasks', 3);
  v_done    integer;
  v_good    integer;
begin
  select created_at into v_created from public.profiles where id = p_user;
  if v_created is null then return null; end if; -- no profile yet: nothing to judge

  select count(*) into v_done
    from public.tasks t
   where t.status in ('COMPLETED', 'AUTO_COMPLETED')
     and (t.poster_id = p_user
          or exists (select 1 from public.assignments a where a.task_id = t.id and a.worker_id = p_user));

  if v_created <= now() - make_interval(days => v_days) and v_done >= v_need then
    return null; -- an established account
  end if;

  select count(distinct r.task_id) into v_good
    from public.reviews r
    join public.tasks t on t.id = r.task_id
   where r.subject_id = p_user and r.rating >= 4 and t.status in ('COMPLETED', 'AUTO_COMPLETED');

  return p_base * (1 + least(v_good, greatest(v_need, 0)));
end;
$$;
revoke all on function private.new_account_cap(uuid, bigint) from public, anon, authenticated;

-- ---- 1a. the value of one job -------------------------------------------------------------------
create or replace function private.limit_new_account_task_value()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap bigint;
  v_top bigint;
begin
  if not private.is_app_caller() then return new; end if;
  if tg_op = 'UPDATE'
     and new.benchmark_minor is not distinct from old.benchmark_minor
     and new.locked_minor is not distinct from old.locked_minor then
    return new;
  end if;

  v_top := greatest(coalesce(new.benchmark_minor, 0), coalesce(new.locked_minor, 0));
  v_cap := private.new_account_cap(new.poster_id, private.setting_int('new_account_max_task_minor', 500000));
  if v_cap is not null and v_top > v_cap then
    raise exception 'New accounts can have jobs worth up to Rs % each. The limit grows as you finish jobs and your account gets older.', (v_cap / 100)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_new_account_task_value() from public, anon, authenticated;

drop trigger if exists limit_new_account_task_value on public.tasks;
create trigger limit_new_account_task_value
  before insert or update of benchmark_minor, locked_minor on public.tasks
  for each row execute function private.limit_new_account_task_value();

-- ---- 1b. withdrawals per day ----------------------------------------------------------------------
create or replace function private.limit_new_account_withdrawals()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap   bigint;
  v_taken bigint;
begin
  if not private.is_app_caller() then return new; end if;

  v_cap := private.new_account_cap(new.user_id, private.setting_int('new_account_max_withdraw_day_minor', 500000));
  if v_cap is null then return new; end if;

  select coalesce(sum(p.amount_minor), 0) into v_taken
    from public.payouts p
   where p.user_id = new.user_id
     and p.status in ('requested', 'processing', 'paid')
     and (p.created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date;

  if v_taken + new.amount_minor > v_cap then
    raise exception 'New accounts can withdraw up to Rs % a day. The limit grows as you finish jobs and your account gets older.', (v_cap / 100)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_new_account_withdrawals() from public, anon, authenticated;

drop trigger if exists limit_new_account_withdrawals on public.payouts;
create trigger limit_new_account_withdrawals
  before insert on public.payouts
  for each row execute function private.limit_new_account_withdrawals();

-- ---- 2. self-dealing flag -------------------------------------------------------------------------
create or replace function private.flag_self_dealing(p_task uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_poster uuid;
  v_worker uuid;
  v_why    text;
begin
  select t.poster_id into v_poster from public.tasks t where t.id = p_task;
  select a.worker_id into v_worker from public.assignments a where a.task_id = p_task order by a.created_at desc limit 1;
  if v_poster is null or v_worker is null then return; end if;

  if v_poster = v_worker then
    v_why := 'the poster and the worker are the same account';
  elsif exists (
    select 1
      from public.payout_destinations a
      join public.payout_destinations b on b.user_id = v_worker
     where a.user_id = v_poster
       and ((a.upi_id is not null and lower(a.upi_id) = lower(b.upi_id))
         or (a.account_number is not null and a.account_number = b.account_number and a.ifsc is not distinct from b.ifsc))
  ) then
    v_why := 'the poster and the worker pay out to the same UPI id or bank account';
  elsif exists (
    select 1
      from public.app_devices a
      join public.app_devices b on b.install_id = a.install_id and b.user_id = v_worker
     where a.user_id = v_poster
  ) then
    v_why := 'the poster and the worker use the same app install (the same device)';
  end if;
  if v_why is null then return; end if;

  -- One alert per job, however many times this runs.
  if exists (select 1 from public.admin_alerts where kind = 'self_dealing' and data ->> 'taskId' = p_task::text) then
    return;
  end if;
  insert into public.admin_alerts (kind, title, body, data)
  values ('self_dealing',
          'A job may be paid between two accounts of one person',
          'On job ' || p_task || ' ' || v_why || '. The job is not blocked. Look at it before the money is released, and warn or suspend if it is not genuine.',
          jsonb_build_object('taskId', p_task, 'poster', v_poster, 'worker', v_worker));
  perform private.notify_staff('money', 'A job may be paid between two accounts of one person', 'Open the Alerts page to see which job.');
exception when others then
  null; -- a flag must never stop a person from hiring or finishing a job
end;
$$;
revoke all on function private.flag_self_dealing(uuid) from public, anon, authenticated;

create or replace function private.flag_self_dealing_on_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.flag_self_dealing(new.task_id);
  return new;
end;
$$;
revoke all on function private.flag_self_dealing_on_assignment() from public, anon, authenticated;

create or replace function private.flag_self_dealing_on_work_done()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.flag_self_dealing(new.id);
  return new;
end;
$$;
revoke all on function private.flag_self_dealing_on_work_done() from public, anon, authenticated;

drop trigger if exists flag_self_dealing_on_assignment on public.assignments;
create trigger flag_self_dealing_on_assignment
  after insert on public.assignments
  for each row execute function private.flag_self_dealing_on_assignment();

-- Checked again when the work is handed in: a payout account or device added after the offer was chosen is caught here.
drop trigger if exists flag_self_dealing_on_work_done on public.tasks;
create trigger flag_self_dealing_on_work_done
  after update of status on public.tasks
  for each row
  when (new.status = 'WORK_DONE' and old.status is distinct from new.status)
  execute function private.flag_self_dealing_on_work_done();
