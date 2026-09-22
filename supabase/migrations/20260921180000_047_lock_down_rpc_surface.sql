-- 047_lock_down_rpc_surface
--
-- Who is allowed to call what.
--
-- Every function in this schema has been callable by anybody holding a session,
-- because Postgres grants EXECUTE to PUBLIC by default and no migration in the
-- project's history has ever revoked it. Most functions defend themselves --
-- they check auth.uid() against the row they are about to touch, or
-- private.is_admin() -- so this has been mostly latent. Some do not.

-- 1 -------------------------------------------------------------------------
-- settle_cleared_earnings() sweeps every worker's elapsed clearing period into
-- their balance. It is SECURITY DEFINER, it checks nothing at all, and
-- authenticated holds EXECUTE on it, so any signed-in user could POST to
-- /rest/v1/rpc/settle_cleared_earnings and drive a row-locking write across
-- every task in the table.
--
-- It is idempotent (tasks.cleared_at plus a row lock) and it only settles
-- periods that have genuinely elapsed, so nobody could steal with it or release
-- money early. What they could do is make one cheap request cost the database an
-- unbounded amount of work, and move rows belonging to strangers.
--
-- Revoking it outright is not an option: WalletScreen and WithdrawScreen call it
-- on open (migration 041), which is what keeps a balance honest for the person
-- actually looking at it. So it splits in two. This is the half the app calls --
-- same arithmetic, but it can only ever settle the caller's own work.
create or replace function public.settle_my_cleared_earnings()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_task       record;
  v_me         uuid := auth.uid();
  v_commission numeric;
  v_net        bigint;
  v_count      integer := 0;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;

  v_commission := private.setting_num('worker_commission_pct', 0.20);

  for v_task in
    select t.id, t.locked_minor
      from public.tasks t
     where t.cleared_at is null
       and t.clear_at is not null
       and t.clear_at <= now()
       and t.status in ('COMPLETED', 'AUTO_COMPLETED')
       -- The most recent assignment decides who is paid, exactly as the global
       -- sweep decides it. Matching on "has an assignment" instead would let a
       -- worker who was replaced on a reassigned task settle the money that now
       -- belongs to their replacement.
       and ( select a.worker_id
               from public.assignments a
              where a.task_id = t.id
              order by a.created_at desc
              limit 1 ) = v_me
     order by t.clear_at
     for update
  loop
    v_net := round(coalesce(v_task.locked_minor, 0) * (1 - v_commission));

    -- Never move more than is actually sitting in clearing. Both least() calls
    -- read the pre-update row, so the pair stays balanced.
    update public.wallets w
       set clearing_minor = w.clearing_minor - least(v_net, w.clearing_minor),
           balance_minor  = w.balance_minor  + least(v_net, w.clearing_minor)
     where w.user_id = v_me;

    update public.tasks set cleared_at = now() where id = v_task.id;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

comment on function public.settle_my_cleared_earnings() is
  'Caller-scoped clearing sweep. The app calls this; settle_cleared_earnings() is the unscoped nightly job and is not granted to authenticated.';

comment on function public.settle_cleared_earnings() is
  'Unscoped nightly sweep, pg_cron only (02:00 UTC). Deliberately not granted to authenticated -- the app calls settle_my_cleared_earnings() instead.';

-- settle_finished_campaigns() has the same shape: SECURITY DEFINER, no
-- auth.uid() and no is_admin(), reachable by any session. It has no caller in
-- the tree yet, so section 3 simply does not grant it rather than splitting it.
-- Whoever gives it a client caller has to scope it first.
comment on function public.settle_finished_campaigns() is
  'Unscoped sweep with no caller-side check. Not granted to authenticated. If the client needs this, add a caller-scoped variant the way settle_my_cleared_earnings() does -- do not grant this one.';

-- 2 -------------------------------------------------------------------------
-- public.sponsored_tasks is a SECURITY DEFINER view, which Supabase flags as an
-- ERROR: such a view enforces its creator's permissions rather than the
-- caller's, quietly seeing past task_promotions' owner-only RLS.
--
-- It is now dead. The feed moved to ad_auction() in
-- 20260921115615_ads_auction_delivery_and_events, nothing in the source tree
-- reads the view any more, and no function or view depends on it. So this is a
-- plain drop rather than a rewrite, and the ERROR goes with it.
drop view if exists public.sponsored_tasks;

-- 3 -------------------------------------------------------------------------
-- Default deny. Revoke EXECUTE across the schema, then grant back only what a
-- traced caller actually needs. Extension-owned functions are skipped: revoking
-- PUBLIC's execute on, say, a pgcrypto function used in a column DEFAULT would
-- break inserts for everyone.
--
-- Trigger functions are safe to revoke -- Postgres checks EXECUTE at CREATE
-- TRIGGER time, not on each fire.
do $$
declare
  r record;
  -- Traced through apps/mobile/src/data/api.ts, supabase/functions/* and
  -- scripts/payouts.mjs against the schema as of this migration.
  allow_authenticated text[] := array[
    -- client, via the rpc<T>() helper
    'activate_promotion', 'cancel_promotion', 'cancel_task', 'cancel_withdrawal',
    'confirm_release', 'lock_bid', 'mark_work_done', 'my_stats', 'open_dispute',
    'platform_stats', 'request_revision', 'request_withdrawal',
    'set_default_payout_destination', 'start_promotion', 'start_task',
    'submit_review',
    -- the caller-scoped sweep added above
    'settle_my_cleared_earnings',
    -- ad delivery, called directly via supabase.rpc(). ad_auction has no
    -- auth.uid() check by design: it publishes a ranking that no individual
    -- caller is allowed to assemble, the same trade the dropped view made.
    -- record_ad_impression and record_ad_click both check the caller.
    'ad_auction', 'record_ad_impression', 'record_ad_click',
    -- caller-checked, shipped without a client caller yet
    'my_campaign_stats',
    -- razorpay edge function, calling with the user's own JWT
    'escrow_refund_due',
    -- admin-guarded (private.is_admin()), called as an admin *user* from the
    -- analytics screen and scripts/payouts.mjs
    'admin_payout_queue', 'admin_mark_payout', 'admin_resolve_dispute',
    'admin_set_admin', 'platform_earnings',
    -- only referenced from comments in the razorpay functions, which call
    -- fund_task_from_payment instead. Poster-guarded, and kept rather than risk
    -- a payment path that is not visible from the source tree. Candidate for
    -- removal once confirmed dead.
    'fund_task'
  ];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'
       and not exists (
             select 1 from pg_depend d
              where d.objid = p.oid and d.deptype = 'e'
           )
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.sig);

    if r.proname = any(allow_authenticated) then
      execute format('grant execute on function %s to authenticated', r.sig);
    end if;
  end loop;
end
$$;

-- auth_codes has RLS enabled and no policies, which reads like an oversight and
-- is not: deny-all is the point. Only the service role touches it, from the
-- phone-auth edge function. Saying so here so nobody later adds a policy to
-- make the linter quieter.
comment on table public.auth_codes is
  'Deny-all by design: RLS on, no policies. Written and read only by the phone-auth edge function using the service role. Do not add a policy.';
