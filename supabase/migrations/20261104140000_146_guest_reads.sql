-- 146: what someone who has not signed up yet may read (guest mode, design D15).
--
-- A guest can look around the whole app before making an account: the feed,
-- Explore, the map, task and service pages, public profiles. The app has no
-- session then, and the anon role has no grants on any table (the database's
-- gateway-only lockdown is not switched on yet, so granting anon anything
-- would hand it to anyone holding the public key). Instead the api function
-- answers a short list of guest reads with the service key, and every one of
-- them goes through the functions below. Postgres, not the function, decides
-- what a guest sees:
--
--   * open posts only (OPEN, not past their deadline), never moderated ones;
--   * no money or hiring columns (funding, locked offer, preferred helper);
--   * places to two decimals (about a kilometre), never an exact spot; the
--     typed address (task_private) is never read here;
--   * people: the public card only (name, handle, photo, skills, area,
--     ratings, bio, when last seen), never referral codes, goals, session
--     fields or the old payout column; deleted accounts not at all;
--   * reviews: not hidden ones.
--
-- Only the service role may call these. Nothing here writes.

-- -------------------------------------------------------- public cards --

create or replace function private.guest_person_json(p public.profiles)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case when p.id is null or p.deleted_at is not null then null else jsonb_build_object(
    'id', p.id,
    'display_name', p.display_name,
    'username', p.username,
    'avatar_url', p.avatar_url,
    'skills', p.skills,
    'languages', p.languages,
    'bio', p.bio,
    'worker_bio', p.worker_bio,
    'loc_label', p.loc_label,
    'loc_lat', round(p.loc_lat::numeric, 2)::float8,
    'loc_lng', round(p.loc_lng::numeric, 2)::float8,
    'poster_rating_avg', p.poster_rating_avg,
    'poster_rating_count', p.poster_rating_count,
    'worker_rating_avg', p.worker_rating_avg,
    'worker_rating_count', p.worker_rating_count,
    'last_seen_at', p.last_seen_at,
    'created_at', p.created_at,
    'onboarded_at', p.onboarded_at,
    'worker_onboarded_at', p.worker_onboarded_at
  ) end
$$;

create or replace function private.guest_task_json(t public.tasks)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select (to_jsonb(t) - array[
      'funding_payment_id', 'funded_at', 'funded_via', 'funded_minor', 'funded_credits_minor', 'wallet_refunded_at',
      'locked_bid_id', 'locked_minor', 'payout_mode', 'preferred_worker_id', 'preferred_until', 'repeated_from',
      'started_at', 'work_done_at', 'auto_complete_at', 'completed_at', 'clear_at', 'cleared_at'
    ])
    || jsonb_build_object(
      'loc_lat', round(t.loc_lat::numeric, 2)::float8,
      'loc_lng', round(t.loc_lng::numeric, 2)::float8
    )
$$;

revoke all on function private.guest_person_json(public.profiles) from public, anon, authenticated;
revoke all on function private.guest_task_json(public.tasks) from public, anon, authenticated;

-- ------------------------------------------------------------ open posts --

-- Open posts of one kind (null: either kind), newest first, each with its
-- poster's public card under "poster". Every filter is optional; the search
-- text is matched as plain text (no pattern characters).
create or replace function public.guest_open_posts(
  p_kind      text    default 'request',
  p_limit     integer default 30,
  p_q         text    default null,
  p_pillar    text    default null,
  p_min_minor bigint  default null,
  p_max_minor bigint  default null,
  p_flag      text    default null,
  p_pinned    boolean default null,
  p_poster    uuid    default null,
  p_ids       uuid[]  default null
)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.guest_task_json(t) || jsonb_build_object('poster', private.guest_person_json(p))
    from public.tasks t
    left join public.profiles p on p.id = t.poster_id
   where t.status = 'OPEN'
     and (t.due_at is null or t.due_at > now())
     and (p_kind is null or t.kind = p_kind)
     and not private.task_is_hidden(t.id)
     and (p.id is null or p.deleted_at is null)
     and (nullif(btrim(p_q), '') is null
          or strpos(lower(t.title), lower(btrim(p_q))) > 0
          or strpos(lower(coalesce(t.description, '')), lower(btrim(p_q))) > 0)
     and (p_pillar is null or t.pillar::text = p_pillar)
     and (p_min_minor is null or t.benchmark_minor >= p_min_minor)
     and (p_max_minor is null or t.benchmark_minor <= p_max_minor)
     and (p_flag is null or t.flag::text = p_flag)
     and (p_pinned is null or (t.loc_lat is not null) = p_pinned)
     and (p_poster is null or t.poster_id = p_poster)
     and (p_ids is null or t.id = any(p_ids))
   order by t.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 500)
$$;

-- How many offers each of these open posts has: { "<task id>": n }.
create or replace function public.guest_bid_counts(p_ids uuid[])
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(x.task_id, x.n), '{}'::jsonb)
    from (
      select b.task_id, count(*) as n
        from public.bids b
        join public.tasks t on t.id = b.task_id
       where b.task_id = any((coalesce(p_ids, '{}'::uuid[]))[1:60])
         and t.status = 'OPEN'
         and not private.task_is_hidden(t.id)
       group by b.task_id
    ) x
$$;

-- ---------------------------------------------------------------- people --

create or replace function public.guest_profile(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.guest_person_json(p) from public.profiles p where p.id = p_user
$$;

-- People who offer work and have a public area: helpers who list skills, or
-- anyone with an open service listing. Most recently seen first.
create or replace function public.guest_helpers(p_limit integer default 300)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select private.guest_person_json(p)
    from public.profiles p
   where p.onboarded_at is not null
     and p.deleted_at is null
     and p.loc_lat is not null
     and (p.skills <> '{}'
          or exists (select 1 from public.tasks t
                      where t.poster_id = p.id and t.kind = 'service' and t.status = 'OPEN'
                        and (t.due_at is null or t.due_at > now())
                        and not private.task_is_hidden(t.id)))
   order by p.last_seen_at desc nulls last
   limit least(greatest(coalesce(p_limit, 300), 1), 300)
$$;

-- Reviews about someone in one role, newest first, never hidden ones, each
-- with its author's public card under "author".
create or replace function public.guest_reviews_about(p_user uuid, p_role text, p_limit integer default 10)
returns setof jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
      'id', r.id, 'task_id', r.task_id, 'author_id', r.author_id, 'subject_id', r.subject_id,
      'about_role', r.about_role, 'rating', r.rating, 'comment', r.comment, 'created_at', r.created_at,
      'author', private.guest_person_json(a)
    )
    from public.reviews r
    left join public.profiles a on a.id = r.author_id
   where r.subject_id = p_user
     and r.about_role::text = p_role
     and not private.review_is_hidden(r.id)
   order by r.created_at desc
   limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;

-- Which of these pictures a guest may see: the picture on an open post, or
-- someone's profile photo. Anything else (chat photos, proof of work, a
-- closed task's files) is left out, so the api never signs it for a guest.
create or replace function public.guest_public_media(p_paths text[])
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(distinct x.path), '{}'::text[])
    from unnest((coalesce(p_paths, '{}'::text[]))[1:200]) as x(path)
   where exists (select 1 from public.tasks t
                  where t.media_path = x.path and t.status = 'OPEN'
                    and (t.due_at is null or t.due_at > now())
                    and not private.task_is_hidden(t.id))
      or exists (select 1 from public.profiles p
                  where p.avatar_url = x.path and p.deleted_at is null)
$$;

revoke all on function public.guest_public_media(text[]) from public, anon, authenticated;
grant execute on function public.guest_public_media(text[]) to service_role;

revoke all on function public.guest_open_posts(text, integer, text, text, bigint, bigint, text, boolean, uuid, uuid[]) from public, anon, authenticated;
revoke all on function public.guest_bid_counts(uuid[]) from public, anon, authenticated;
revoke all on function public.guest_profile(uuid) from public, anon, authenticated;
revoke all on function public.guest_helpers(integer) from public, anon, authenticated;
revoke all on function public.guest_reviews_about(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.guest_open_posts(text, integer, text, text, bigint, bigint, text, boolean, uuid, uuid[]) to service_role;
grant execute on function public.guest_bid_counts(uuid[]) to service_role;
grant execute on function public.guest_profile(uuid) to service_role;
grant execute on function public.guest_helpers(integer) to service_role;
grant execute on function public.guest_reviews_about(uuid, text, integer) to service_role;
