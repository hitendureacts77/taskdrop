-- 166: public lists and the "Open tasks" number show only what people can see
-- (debug loop B30 and B32).
--
-- B30 cause: the Top helpers lists ("Top rated", "Most active", "New talent")
-- come from private.top_earners_live (149, as left by 048), which never
-- checked profiles.deleted_at, so deleted accounts showed to guests and
-- signed-in people alike (guest and signed-in both call top_earners).
-- guest_helpers (146) and the api's workersNear already skip deleted accounts;
-- the api's listActiveWorkers is fixed in the same change.
--
-- B32 cause: private.platform_highlights_live counted every task with status
-- OPEN, including requests past their date, posts staff removed (093) and
-- service listings, while the feeds show only open requests whose date is
-- still ahead (api notExpired: due_at null or in the future). "59 shown, 38
-- live". openTasks now uses the feed's rule, plus not removed by staff and
-- the poster's account not deleted.
--
-- Same signatures, owners, security definer and search_path as 149; only the
-- WHERE clauses change. The kept copies are refreshed at the end so the cache
-- (when switched on) does not keep the old numbers for up to 10 minutes.

create or replace function private.platform_highlights_live()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'activeNow',      (select count(*) from public.profiles where last_seen_at > now() - interval '15 minutes'),
    'activeToday',    (select count(*) from public.profiles where last_seen_at > now() - interval '24 hours'),
    'openTasks',      (select count(*) from public.tasks t
                        where t.status = 'OPEN'
                          and t.kind = 'request'
                          and (t.due_at is null or t.due_at > now())
                          and not exists (select 1 from public.task_moderation m where m.task_id = t.id)
                          and not exists (select 1 from public.profiles p
                                           where p.id = t.poster_id and p.deleted_at is not null)),
    'completedToday', (select count(*) from public.tasks
                        where status in ('COMPLETED', 'AUTO_COMPLETED')
                          and coalesce(completed_at, updated_at) > now() - interval '24 hours'),
    'liveWorkers',    (select count(*) from public.profiles where live_until > now())
  )
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
             where a.worker_id = p.id and t.status in ('COMPLETED', 'AUTO_COMPLETED')) as jobs_done,
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

revoke all on function private.platform_highlights_live() from public, anon, authenticated, service_role;
revoke all on function private.top_earners_live(text, integer) from public, anon, authenticated, service_role;

-- Refresh the kept copies now (a no-op lock skip if a refresh is already running).
do $$
begin
  perform private.refresh_public_snapshots();
end;
$$;
