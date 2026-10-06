-- 087 -- Delete my account, from inside the app.
--
-- Google Play requires in-app account deletion, and the DPDP Act gives people
-- the right to have their data erased. Until now the Privacy Policy said "ask
-- through Help & support".
--
-- What "delete" means here. The auth.users row is NOT deleted: profiles,
-- tasks, payments, payouts, wallets and more cascade from it, so deleting it
-- would wipe other people's task history and the money records that Indian
-- tax and accounting law makes us keep. Instead the account is emptied out
-- and made impossible to sign in to:
--
--   removed   name, @username, photo, bio, skills, languages, location,
--             referral code, birth date, saved tasks, notifications, push
--             tokens, feedback, CRM tags, saved bank/UPI details, unused
--             quotes, open requests nobody had paid for (cancelled), every
--             sign-in method (Google link, phone email, password, MFA), every
--             session, and the files in the account's storage folder that no
--             kept record points to
--   kept      tasks that went ahead, their messages and proof files, reviews,
--             payments, payouts (and the PAN/legal name if a payout was ever
--             paid), wallet history, disputes, support tickets and admin notes
--             -- shown to others as "Deleted user"
--
-- The phone number and Google account are released: signing in with either
-- again makes a brand-new, empty account.
--
-- Deleting is refused while anything is still in motion -- money in the
-- wallet or clearing, a withdrawal on its way, a task in progress or in
-- dispute, a paid open request, an unsettled promotion, a payment going
-- through -- because finishing those needs the account. account_deletion_check()
-- lists what is in the way, in words the person can act on.
--
-- Storage files cannot be removed from SQL (storage.protect_delete); the
-- function returns their paths and the api edge function removes them with the
-- service role.

-- ------------------------------------------------------------------ tables --
alter table public.profiles add column if not exists deleted_at timestamptz;
comment on column public.profiles.deleted_at is
  'Set when the person deleted their account (087). The row stays, emptied, so kept records still have a name: "Deleted user".';

create table if not exists public.account_deletions (
  user_id            uuid primary key,
  deleted_at         timestamptz not null default now(),
  kept_money_records boolean not null,
  files_listed       integer not null default 0,
  deleted_by         uuid,  -- null: the person did it themselves; else the admin who did
  reason             text   -- the admin's reason; null when the person did it
);
comment on table public.account_deletions is
  'One row per deleted account (087). No personal data. Admins read it; only private.delete_account() writes it.';

alter table public.account_deletions enable row level security;
drop policy if exists account_deletions_admin_read on public.account_deletions;
create policy account_deletions_admin_read on public.account_deletions
  for select to authenticated using (private.is_admin());
revoke all on public.account_deletions from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.account_deletions from authenticated;
grant select on public.account_deletions to authenticated;

-- --------------------------------------------------------------- blockers --
/**
 * What stops p_user's account from being deleted right now, as
 * [{ code, message }]. Empty means it can go. p_by_admin skips SUSPENDED: an
 * admin may close a suspended account (a repeat infringer, or a person who
 * asked through support). Everything about money and tasks still applies.
 */
create or replace function private.account_deletion_blockers(p_user uuid, p_by_admin boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_out     jsonb := '[]'::jsonb;
  v_wallet  public.wallets;
  v_n       integer;
  v_min     numeric := private.setting_num('min_withdraw_minor', 10000);
  rupees    text;
begin
  if exists (select 1 from public.user_roles where user_id = p_user and role = 'admin') then
    v_out := v_out || jsonb_build_object('code', 'ADMIN',
      'message', 'Admin accounts can’t be deleted from the app. Remove the admin role first.');
  end if;

  if not p_by_admin and exists (select 1 from public.user_suspensions where user_id = p_user and lifted_at is null) then
    v_out := v_out || jsonb_build_object('code', 'SUSPENDED',
      'message', 'This account is suspended. Write to Help & support to close it.');
  end if;

  select * into v_wallet from public.wallets where user_id = p_user;
  if coalesce(v_wallet.balance_minor, 0) <> 0 then
    rupees := to_char(v_wallet.balance_minor / 100.0, 'FM99999999990.00');
    v_out := v_out || jsonb_build_object('code', 'BALANCE',
      'message', case
        when v_wallet.balance_minor < 0 then
          'Your wallet is ₹' || ltrim(rupees, '-') || ' below zero. Write to Help & support to settle it first.'
        when v_wallet.balance_minor < v_min then
          'You have ₹' || rupees || ' in your wallet, below the withdrawal minimum. Write to Help & support and we’ll send it to you, then delete your account.'
        else
          'You have ₹' || rupees || ' in your wallet. Withdraw it first.'
      end);
  end if;
  if coalesce(v_wallet.clearing_minor, 0) > 0 or coalesce(v_wallet.credits_minor, 0) > 0 then
    v_out := v_out || jsonb_build_object('code', 'CLEARING',
      'message', '₹' || to_char((coalesce(v_wallet.clearing_minor, 0) + coalesce(v_wallet.credits_minor, 0)) / 100.0, 'FM99999999990.00')
        || ' of earnings is still clearing. Once it lands in your wallet, withdraw it, then delete your account.');
  end if;

  if exists (select 1 from public.payouts where user_id = p_user and status in ('requested', 'processing')) then
    v_out := v_out || jsonb_build_object('code', 'PAYOUT',
      'message', 'A withdrawal is still on its way to you. Wait until it arrives.');
  end if;

  select count(*) into v_n from public.tasks
   where poster_id = p_user
     and status in ('LOCKED', 'TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED', 'DISPUTED');
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('code', 'TASKS_ACTIVE',
      'message', case when v_n = 1 then 'One of your requests is in progress.' else v_n || ' of your requests are in progress.' end
        || ' Finish or cancel ' || case when v_n = 1 then 'it' else 'them' end || ' first.');
  end if;

  select count(*) into v_n from public.tasks
   where poster_id = p_user and status = 'OPEN'
     and funded_at is not null and wallet_refunded_at is null;
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('code', 'TASKS_FUNDED',
      'message', case when v_n = 1 then 'One open request is already paid for.' else v_n || ' open requests are already paid for.' end
        || ' Cancel ' || case when v_n = 1 then 'it' else 'them' end || ' so the money comes back to your wallet, then withdraw it.');
  end if;

  select count(*) into v_n from public.assignments where worker_id = p_user and status in ('assigned', 'started');
  if v_n > 0 then
    v_out := v_out || jsonb_build_object('code', 'WORK_ACTIVE',
      'message', case when v_n = 1 then 'You have a job in progress.' else 'You have ' || v_n || ' jobs in progress.' end
        || ' Finish it or step off it first.');
  end if;

  if exists (select 1 from public.task_promotions
              where user_id = p_user and status in ('active', 'cancelled') and settled_at is null) then
    v_out := v_out || jsonb_build_object('code', 'PROMOTION',
      'message', 'A promotion is still running or being settled. Delete your account once it ends and any unspent budget is back in your wallet.');
  end if;

  if exists (select 1 from public.payments
              where user_id = p_user and status = 'created' and created_at > now() - interval '1 hour') then
    v_out := v_out || jsonb_build_object('code', 'PAYMENT_PENDING',
      'message', 'A payment you started is still going through. Try again in an hour.');
  end if;

  return v_out;
end;
$$;
revoke all on function private.account_deletion_blockers(uuid, boolean) from public, anon, authenticated;

-- ------------------------------------------------------------------ check --
/** What deleting the caller's account would do, and what is in the way. */
create or replace function public.account_deletion_check()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  return jsonb_build_object(
    'blockers', private.account_deletion_blockers(v_me),
    -- Whether some records stay (anonymised) because they involve money or other people.
    'keepsRecords', exists (select 1 from public.payments where user_id = v_me)
                 or exists (select 1 from public.payouts  where user_id = v_me)
                 or exists (select 1 from public.tasks    where poster_id = v_me and status <> 'OPEN')
                 or exists (select 1 from public.assignments where worker_id = v_me));
end;
$$;
revoke all on function public.account_deletion_check() from public, anon;
grant execute on function public.account_deletion_check() to authenticated;

-- ----------------------------------------------------------------- delete --
/**
 * Delete p_user's account (see the header). Shared by delete_my_account()
 * (p_by null) and admin_delete_account() (p_by = the admin), which do their
 * own checks of who is asking first. Returns
 * { files: [storage paths to remove from task-media] }.
 */
create or replace function private.delete_account(p_user uuid, p_by uuid default null, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := p_user;
  v_blockers jsonb;
  v_keeps    boolean;
  v_files    jsonb;
begin
  if v_me is null then raise exception 'No account given'; end if;
  if not exists (select 1 from public.profiles where id = v_me) then
    raise exception 'That account does not exist';
  end if;
  if exists (select 1 from public.profiles where id = v_me and deleted_at is not null) then
    raise exception 'This account is already deleted';
  end if;

  -- Hold the wallet and the account's tasks still while deciding, so money
  -- cannot arrive or a task cannot move between the check and the scrub.
  perform 1 from public.wallets where user_id = v_me for update;
  perform 1 from public.tasks where poster_id = v_me and status not in ('COMPLETED', 'AUTO_COMPLETED', 'CANCELLED') for update;
  perform 1 from public.assignments where worker_id = v_me and status in ('assigned', 'started') for update;

  v_blockers := private.account_deletion_blockers(v_me, p_by is not null);
  if jsonb_array_length(v_blockers) > 0 then
    raise exception '%', v_blockers -> 0 ->> 'message';
  end if;

  v_keeps := exists (select 1 from public.payments where user_id = v_me)
          or exists (select 1 from public.payouts  where user_id = v_me)
          or exists (select 1 from public.tasks    where poster_id = v_me and status <> 'OPEN')
          or exists (select 1 from public.assignments where worker_id = v_me);

  -- Open requests nobody paid for: closed, and emptied of what the poster wrote.
  update public.tasks
     set status = 'CANCELLED', completed_at = now(),
         title = 'Removed', description = '', media_path = null, media_kind = null,
         loc_lat = null, loc_lng = null, loc_label = null
   where poster_id = v_me and status = 'OPEN';

  -- Quotes that never became a job.
  delete from public.bids b
   where b.worker_id = v_me
     and not b.is_locked
     and not exists (select 1 from public.assignments a where a.bid_id = b.id)
     and not exists (select 1 from public.tasks t where t.locked_bid_id = b.id);

  -- Files to remove: everything in the account's folder that no kept record
  -- points to (a finished task's photo, a proof of work).
  select coalesce(jsonb_agg(o.name), '[]'::jsonb) into v_files
    from storage.objects o
   where o.bucket_id = 'task-media'
     and o.name like v_me::text || '/%'
     and not exists (select 1 from public.tasks t
                      where t.poster_id = v_me and t.media_path = o.name and t.status <> 'CANCELLED')
     and not exists (select 1 from public.task_proofs p
                      where p.worker_id = v_me and strpos(p.files::text, o.name) > 0);

  update public.profiles
     set display_name = 'Deleted user', username = null, avatar_url = null, bio = null, worker_bio = null,
         skills = '{}', languages = '{}', intent = null, payout_upi = null, referral_code = null,
         loc_lat = null, loc_lng = null, loc_label = null,
         last_seen_at = null, live_until = null, deleted_at = now()
   where id = v_me;

  delete from public.profile_private     where user_id = v_me;
  delete from public.age_checks          where user_id = v_me;
  delete from public.push_tokens         where user_id = v_me;
  delete from public.saved_tasks         where user_id = v_me;
  delete from public.notifications       where user_id = v_me;
  delete from public.feedback            where user_id = v_me;
  delete from public.places_quota        where user_id = v_me;
  delete from public.crm_user_tags       where user_id = v_me;
  delete from public.payout_destinations where user_id = v_me;  -- payouts keep their own copy of where money went
  if not exists (select 1 from public.payouts where user_id = v_me and status = 'paid') then
    delete from public.payout_profiles where user_id = v_me;     -- PAN and legal name stay only for tax records
  end if;

  -- Sign-in: nothing left to sign in with, nothing signed in. The address is
  -- unique per account and cannot receive mail.
  update auth.users
     set email = 'deleted-' || v_me::text || '@deleted.taskdrop.app',
         phone = null, phone_change = '', email_change = '',
         encrypted_password = '',
         raw_user_meta_data = '{}'::jsonb,
         raw_app_meta_data = jsonb_build_object('provider', 'deleted', 'providers', '[]'::jsonb),
         banned_until = now() + interval '100 years',
         updated_at = now()
   where id = v_me;
  delete from auth.identities       where user_id = v_me;
  delete from auth.mfa_factors      where user_id = v_me;
  delete from auth.one_time_tokens  where user_id = v_me;
  delete from auth.sessions         where user_id = v_me;
  delete from auth.refresh_tokens   where user_id = v_me::text;

  insert into public.account_deletions (user_id, kept_money_records, files_listed)
  values (v_me, v_keeps, jsonb_array_length(v_files));
  update public.account_deletions
     set deleted_by = p_by, reason = left(nullif(btrim(coalesce(p_reason, '')), ''), 500)
   where user_id = v_me;

  -- n8n drops the person from anything it keeps (CRM sheets, mailing lists).
  perform private.emit_event('user.deleted', jsonb_build_object('user_id', v_me, 'by_admin', p_by is not null));

  return jsonb_build_object('files', v_files);
end;
$$;
revoke all on function private.delete_account(uuid, uuid, text) from public, anon, authenticated;

/**
 * Delete the caller's own account. p_confirm must be exactly
 * 'DELETE MY ACCOUNT', so no stray call can do this.
 */
create or replace function public.delete_my_account(p_confirm text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if p_confirm is distinct from 'DELETE MY ACCOUNT' then
    raise exception 'Confirm that you want to delete your account';
  end if;
  return private.delete_account(v_me, null, null);
end;
$$;
revoke all on function public.delete_my_account(text) from public, anon;
grant execute on function public.delete_my_account(text) to authenticated;

-- ------------------------------------------------------------------ admin --
/** For the admin panel: what stops p_user's account being deleted by an admin. */
create or replace function public.admin_account_deletion_check(p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  return private.account_deletion_blockers(p_user, true);
end;
$$;
revoke all on function public.admin_account_deletion_check(uuid) from public, anon;
grant execute on function public.admin_account_deletion_check(uuid) to authenticated;

/**
 * An admin deletes someone's account: the person asked through support, or
 * the account is being closed (repeat infringer). Same result as the person
 * doing it themselves, with the admin and reason on record. Cannot be undone,
 * so it asks for the authenticator code like the money actions do (080).
 */
create or replace function public.admin_delete_account(p_user uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin    uuid := auth.uid();
  v_claims   jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_required boolean;
  v_out      jsonb;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Say why, so the next admin knows'; end if;
  if p_user = v_admin then raise exception 'Delete your own account from the app, after removing your admin role'; end if;

  select s.value = 'true'::jsonb into v_required from public.settings s where s.key = 'admin_require_mfa';
  if coalesce(v_required, true) and coalesce(v_claims ->> 'aal', '') <> 'aal2' then
    raise exception 'Verify your authenticator code first (Security page in the admin panel)'
      using errcode = '42501';
  end if;

  v_out := private.delete_account(p_user, v_admin, p_reason);

  insert into public.admin_audit_log (actor, actor_kind, action, target_table, target_id, detail)
  values (v_admin, 'admin', 'account.delete', 'profiles', p_user::text, left(btrim(p_reason), 500));

  return v_out;
end;
$$;
revoke all on function public.admin_delete_account(uuid, text) from public, anon;
grant execute on function public.admin_delete_account(uuid, text) to authenticated;

-- Lifting a suspension clears banned_until (071). On a deleted account that
-- would undo the ban delete_account() set, so refuse it there.
create or replace function public.crm_unsuspend_user(p_user uuid, p_note text default null)
returns public.user_suspensions
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_row public.user_suspensions;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if exists (select 1 from public.profiles where id = p_user and deleted_at is not null) then
    raise exception 'That account is deleted, so it stays closed';
  end if;
  update public.user_suspensions
     set lifted_at = now(), lifted_by = auth.uid(), lift_note = nullif(left(btrim(coalesce(p_note, '')), 500), '')
   where user_id = p_user and lifted_at is null
  returning * into v_row;
  if not found then raise exception 'That person is not suspended'; end if;
  update auth.users set banned_until = null where id = p_user;
  perform private.notify(p_user, 'announcement', 'Your account is active again',
    'You can use TaskDrop as normal. Sign in again to continue.', null);
  return v_row;
end;
$fn$;
