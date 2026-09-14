-- Your own numbers, which nobody could see before.
--
-- The only statistics in the product were platform_stats: the whole
-- marketplace, admins only. A poster could not see what they had spent and a
-- worker could not see what they had earned -- on an app whose entire point is
-- that money changes hands.
--
-- The two roles are asked completely different questions, so this returns a
-- different shape for each rather than one union of half-relevant fields.
create or replace function public.my_stats(p_role text default 'worker')
returns jsonb
language plpgsql stable security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare v_me uuid := auth.uid(); v_out jsonb;
begin
  if v_me is null then raise exception 'Not signed in'; end if;
  if p_role not in ('worker','poster') then
    raise exception 'Ask for worker or poster numbers';
  end if;

  if p_role = 'poster' then
    select jsonb_build_object(
      'role','poster',
      'spentMinor', coalesce((select sum(t.locked_minor) from public.tasks t
        where t.poster_id = v_me and t.status in ('COMPLETED','AUTO_COMPLETED')),0),
      'escrowHeldMinor', coalesce((select sum(a.escrow_minor) from public.assignments a
        join public.tasks t on t.id = a.task_id
        where t.poster_id = v_me and a.status in ('assigned','started')),0),
      'posted', (select count(*) from public.tasks t where t.poster_id = v_me),
      'open', (select count(*) from public.tasks t where t.poster_id = v_me and t.status='OPEN'),
      'live', (select count(*) from public.tasks t where t.poster_id = v_me
        and t.status in ('LOCKED','TASK_STARTED','OVERDUE','WORK_DONE','REVISION_REQUESTED')),
      'completed', (select count(*) from public.tasks t where t.poster_id = v_me
        and t.status in ('COMPLETED','AUTO_COMPLETED')),
      'cancelled', (select count(*) from public.tasks t where t.poster_id = v_me and t.status='CANCELLED'),
      -- How much interest their requests attract. A poster whose tasks get no
      -- quotes needs to know that, and needs to know it from the app.
      'quotesReceived', coalesce((select count(*) from public.bids b
        join public.tasks t on t.id = b.task_id where t.poster_id = v_me),0),
      'rating', (select round(p.poster_rating_avg,2) from public.profiles p where p.id = v_me),
      'ratingCount', (select p.poster_rating_count from public.profiles p where p.id = v_me)
    ) into v_out;
  else
    select jsonb_build_object(
      'role','worker',
      -- Earned is what actually reached them, after commission.
      'earnedMinor', coalesce((select sum(round(t.locked_minor *
          (1 - private.setting_num('worker_commission_pct',0.20))))
        from public.tasks t join public.assignments a on a.task_id = t.id
        where a.worker_id = v_me and t.status in ('COMPLETED','AUTO_COMPLETED')),0),
      'clearingMinor', coalesce((select w.clearing_minor from public.wallets w where w.user_id=v_me),0),
      'availableMinor', coalesce((select w.balance_minor from public.wallets w where w.user_id=v_me),0),
      'withdrawnMinor', coalesce((select sum(o.amount_minor) from public.payouts o
        where o.user_id = v_me and o.status='paid'),0),
      'quotesPlaced', (select count(*) from public.bids b where b.worker_id = v_me),
      'quotesWon', (select count(*) from public.assignments a where a.worker_id = v_me),
      'jobsLive', (select count(*) from public.assignments a
        where a.worker_id = v_me and a.status in ('assigned','started')),
      'jobsDone', (select count(*) from public.assignments a
        join public.tasks t on t.id = a.task_id
        where a.worker_id = v_me and t.status in ('COMPLETED','AUTO_COMPLETED')),
      'rating', (select round(p.worker_rating_avg,2) from public.profiles p where p.id = v_me),
      'ratingCount', (select p.worker_rating_count from public.profiles p where p.id = v_me)
    ) into v_out;
  end if;

  return v_out;
end;
$fn$;

revoke all on function public.my_stats(text) from public, anon;
grant execute on function public.my_stats(text) to authenticated;
