-- 108 -- Deleting an account now erases more of what the person left behind.
--
-- 087 emptied the profile and the sign-in, and kept every record that touched
-- another person or money, including the person's chat messages. The owner's
-- call (2026-10-19): chat messages go too. Only what the law makes us keep
-- stays: payments, payouts, wallet history, reviews, disputes and support
-- tickets, shown as "Deleted user".
--
-- Added to what delete_account() removes:
--   messages        everything the person wrote in any task's chat, and the whole
--                   chat of a request of theirs that nobody ever paid for
--   requests        every request of theirs that nobody paid for is emptied
--                   (087 only did this for open ones; an earlier cancelled one
--                   kept its title and description)
--   devices         app_devices (phone model, OS, app version, install id)
--   referrals       who referred them and whom they referred
--   blocks          people they blocked and people who blocked them
--   CRM             leads, owner assignments and follow-ups about them
--                   (name and contact details of a lead). Notes stay: admin
--                   notes are records (087).
--   rate limits     private.api_rate rows
--
-- Everything else in delete_account() is exactly as in 087.

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

  -- Open requests nobody paid for: closed.
  update public.tasks
     set status = 'CANCELLED', completed_at = now()
   where poster_id = v_me and status = 'OPEN';

  -- Every request of theirs that nobody paid for: emptied of what they wrote,
  -- and its chat removed. (A paid one is a money record and stays whole.)
  delete from public.messages m
   using public.tasks t
   where m.task_id = t.id and t.poster_id = v_me and t.funded_at is null;
  update public.tasks
     set title = 'Removed', description = '', media_path = null, media_kind = null,
         loc_lat = null, loc_lng = null, loc_label = null
   where poster_id = v_me and funded_at is null
     and (title <> 'Removed' or description <> '' or media_path is not null or loc_label is not null
          or loc_lat is not null or loc_lng is not null);

  -- Everything they said in anyone's chat.
  delete from public.messages where sender_id = v_me;

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
  delete from public.app_devices         where user_id = v_me;
  delete from public.saved_tasks         where user_id = v_me;
  delete from public.notifications       where user_id = v_me;
  delete from public.feedback            where user_id = v_me;
  delete from public.places_quota        where user_id = v_me;
  delete from public.crm_user_tags       where user_id = v_me;
  delete from public.referrals           where referred_id = v_me or referrer_id = v_me;
  delete from public.blocks              where blocker_id = v_me or blocked_id = v_me;
  delete from private.api_rate           where user_id = v_me;
  delete from public.payout_destinations where user_id = v_me;  -- payouts keep their own copy of where money went
  if not exists (select 1 from public.payouts where user_id = v_me and status = 'paid') then
    delete from public.payout_profiles where user_id = v_me;     -- PAN and legal name stay only for tax records
  end if;

  -- CRM rows about the person. Staff-only tables guard who may change them;
  -- if a staff member deletes their own account that guard can refuse, and
  -- the deletion must still go through, so a refusal here is not fatal.
  begin
    delete from public.crm_leads  where user_id = v_me;
    delete from public.crm_owners where user_id = v_me;
    delete from public.crm_tasks  where user_id = v_me;
  exception when insufficient_privilege then
    null;
  end;

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

  -- Inngest drops the person from anything it keeps (CRM sheets, mailing lists).
  perform private.emit_event('user.deleted', jsonb_build_object('user_id', v_me, 'by_admin', p_by is not null));

  return jsonb_build_object('files', v_files);
end;
$$;
revoke all on function private.delete_account(uuid, uuid, text) from public, anon, authenticated;
