-- 175: a helper who backs out of a job no longer gets credit for it when someone else finishes it.
--
-- Debug round ledger B67. When the hired helper cancels (cancel_task, helper branch, 128), their
-- assignment is set to 'refunded' and the task reopens; the poster can hire someone else, whose
-- assignment becomes 'released' when the job is approved (confirm_release) or auto-completes. The
-- counters below joined assignments to tasks on t.status in ('COMPLETED', 'AUTO_COMPLETED') and never
-- looked at the assignment, so the helper who walked off was counted too (jobs done, earnings, streaks,
-- the Top helpers list). Only the paid assignment counts now: a.status = 'released' (on staging every
-- assignment of a COMPLETED or AUTO_COMPLETED task is 'released'; 'refunded' rows sit on cancelled or
-- reopened tasks).
--
-- Each function is copied from its latest definition (public_profile_stats 048, my_stats 025,
-- my_streaks 134, private.top_earners_live 166) with only that filter added. Same signatures, owners,
-- security definer and search_path; every refusal message is kept. The api's myRegulars gets the same
-- rule in supabase/functions/api/reads.ts.

create or replace function public.public_profile_stats(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'jobsDone', (select count(*) from public.assignments a
                   join public.tasks t on t.id = a.task_id
                  where a.worker_id = p_user and a.status = 'released'
                    and t.status in ('COMPLETED', 'AUTO_COMPLETED')),
    'tasksPosted', (select count(*) from public.tasks t where t.poster_id = p_user),
    'tasksCompletedAsPoster', (select count(*) from public.tasks t
                                where t.poster_id = p_user
                                  and t.status in ('COMPLETED', 'AUTO_COMPLETED'))
  )
$$;

create or replace function public.my_stats(p_role text default 'worker')
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me  uuid := auth.uid();
  v_out jsonb;
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_role not in ('worker', 'poster') then
    raise exception 'Ask for worker or poster numbers';
  end if;

  if p_role = 'poster' then
    select jsonb_build_object(
      'role', 'poster',
      -- What they have spent, and what is still committed.
      'spentMinor', coalesce((
        select sum(t.locked_minor) from public.tasks t
         where t.poster_id = v_me and t.status in ('COMPLETED', 'AUTO_COMPLETED')
      ), 0),
      'escrowHeldMinor', coalesce((
        select sum(a.escrow_minor) from public.assignments a
          join public.tasks t on t.id = a.task_id
         where t.poster_id = v_me and a.status in ('assigned', 'started')
      ), 0),
      'posted', (select count(*) from public.tasks t where t.poster_id = v_me),
      'open', (select count(*) from public.tasks t
                where t.poster_id = v_me and t.status = 'OPEN'),
      'live', (select count(*) from public.tasks t
                where t.poster_id = v_me
                  and t.status in ('LOCKED','TASK_STARTED','OVERDUE','WORK_DONE','REVISION_REQUESTED')),
      'completed', (select count(*) from public.tasks t
                     where t.poster_id = v_me and t.status in ('COMPLETED','AUTO_COMPLETED')),
      'cancelled', (select count(*) from public.tasks t
                     where t.poster_id = v_me and t.status = 'CANCELLED'),
      -- How much interest their requests attract. A poster whose tasks get no
      -- quotes needs to know that, and needs to know it from the app.
      'quotesReceived', coalesce((
        select count(*) from public.bids b
          join public.tasks t on t.id = b.task_id
         where t.poster_id = v_me
      ), 0),
      'rating', (select round(p.poster_rating_avg, 2) from public.profiles p where p.id = v_me),
      'ratingCount', (select p.poster_rating_count from public.profiles p where p.id = v_me)
    ) into v_out;
  else
    select jsonb_build_object(
      'role', 'worker',
      -- Earned is what actually reached them, after commission. Only the paid assignment (B67).
      'earnedMinor', coalesce((
        select sum(round(t.locked_minor * (1 - private.setting_num('worker_commission_pct', 0.20))))
          from public.tasks t
          join public.assignments a on a.task_id = t.id
         where a.worker_id = v_me
           and a.status = 'released'
           and t.status in ('COMPLETED', 'AUTO_COMPLETED')
      ), 0),
      'clearingMinor', coalesce((
        select w.clearing_minor from public.wallets w where w.user_id = v_me
      ), 0),
      'availableMinor', coalesce((
        select w.balance_minor from public.wallets w where w.user_id = v_me
      ), 0),
      'withdrawnMinor', coalesce((
        select sum(o.amount_minor) from public.payouts o
         where o.user_id = v_me and o.status = 'paid'
      ), 0),
      'quotesPlaced', (select count(*) from public.bids b where b.worker_id = v_me),
      'quotesWon', (select count(*) from public.assignments a where a.worker_id = v_me),
      'jobsLive', (select count(*) from public.assignments a
                    where a.worker_id = v_me and a.status in ('assigned','started')),
      'jobsDone', (select count(*) from public.assignments a
                    join public.tasks t on t.id = a.task_id
                   where a.worker_id = v_me and a.status = 'released'
                     and t.status in ('COMPLETED','AUTO_COMPLETED')),
      'rating', (select round(p.worker_rating_avg, 2) from public.profiles p where p.id = v_me),
      'ratingCount', (select p.worker_rating_count from public.profiles p where p.id = v_me)
    ) into v_out;
  end if;

  return v_out;
end;
$$;

create or replace function public.my_streaks()
returns jsonb
language plpgsql
stable
security definer
set search_path to ''
as $$
declare
  v_me    uuid := auth.uid();
  v_week  timestamptz := date_trunc('week', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  v_cut   numeric := private.setting_num('worker_commission_pct', 0.10);
  v_out   jsonb;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  with done as (
    select t.*, a.worker_id
      from public.assignments a
      join public.tasks t on t.id = a.task_id
     where a.worker_id = v_me and a.status = 'released'
       and t.status in ('COMPLETED', 'AUTO_COMPLETED')
  ), ordered as (
    select (d.due_at is null or d.work_done_at is null or d.work_done_at <= d.due_at) as on_time,
           row_number() over (order by coalesce(d.work_done_at, d.completed_at) desc nulls last) as rn
      from done d
  )
  select jsonb_build_object(
    'weekStart', v_week,
    'weekEarnedMinor', coalesce((select sum(round(d.locked_minor * (1 - v_cut))) from done d where d.completed_at >= v_week), 0),
    'weekJobs', (select count(*) from done d where d.completed_at >= v_week),
    'weeklyGoalMinor', (select p.weekly_goal_minor from public.profiles p where p.id = v_me),
    'onTimeStreak', coalesce((select min(o.rn) - 1 from ordered o where not o.on_time), (select count(*) from ordered)),
    'jobsDone', (select count(*) from done),
    'earlyStarts', (select count(*) from done d
                     where d.started_at is not null
                       and (d.started_at at time zone 'Asia/Kolkata')::time < time '08:00'),
    'fiveStars', (select count(*) from public.reviews r
                   where r.subject_id = v_me and r.about_role = 'worker' and r.rating = 5),
    'crewJobs', (select count(*) from done d where d.crew_id is not null),
    'liveAnswers', (select count(*) from done d where d.live_answer),
    'photoJobs', (select count(*) from done d where d.want_photos)
  ) into v_out;
  return v_out;
end;
$$;

create or replace function private.top_earners_live(p_kind text default 'top_rated', p_limit integer default 10)
returns table (
  id uuid, display_name text, username text, avatar_url text,
  rating numeric, rating_count integer, jobs_done bigint, skill text
)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  with base as (
    select p.id, p.display_name, p.username, p.avatar_url,
           round(p.worker_rating_avg, 1) as rating,
           p.worker_rating_count as rating_count,
           (select count(*) from public.assignments a
              join public.tasks t on t.id = a.task_id
             where a.worker_id = p.id and a.status = 'released'
               and t.status in ('COMPLETED', 'AUTO_COMPLETED')) as jobs_done,
           (select count(*) from public.bids b
             where b.worker_id = p.id and b.created_at > now() - interval '30 days') as recent_quotes,
           p.skills[1] as skill,
           p.created_at
      from public.profiles p
     where p.onboarded_at is not null
       and p.deleted_at is null
  )
  select id, display_name, username, avatar_url, rating, rating_count, jobs_done, skill
    from base
   where case p_kind
           when 'top_rated'   then rating_count > 0
           when 'most_active' then recent_quotes > 0
           else created_at > now() - interval '60 days'
         end
   order by
     case when p_kind = 'top_rated'   then rating end desc nulls last,
     case when p_kind = 'top_rated'   then rating_count end desc,
     case when p_kind = 'most_active' then recent_quotes end desc,
     created_at desc
   limit greatest(1, least(coalesce(p_limit, 10), 30))
$$;

-- Grants as before (create or replace keeps them; stated again so this file stands alone).
revoke all on function public.public_profile_stats(uuid) from public, anon;
grant execute on function public.public_profile_stats(uuid) to authenticated;
revoke all on function public.my_stats(text) from public, anon;
grant execute on function public.my_stats(text) to authenticated;
revoke all on function public.my_streaks() from public, anon;
grant execute on function public.my_streaks() to authenticated;
revoke all on function private.top_earners_live(text, integer) from public, anon, authenticated, service_role;

-- Refresh the kept copies of the Top helpers lists now, so the cache (when switched on) does not
-- keep the old jobs_done numbers for up to 10 minutes (as 166 does).
do $$
begin
  perform private.refresh_public_snapshots();
end;
$$;
