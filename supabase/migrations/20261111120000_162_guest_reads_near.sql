-- 162: guest distance reads narrowed to a box before the cap (bug B34).
--
-- guest_open_posts and guest_helpers (migration 146) answer the newest posts /
-- the most recently seen helpers first, capped, and the api then keeps the
-- ones within the radius. With real volume the cap came first: a 5 km search
-- could return nothing while dozens of posts were 2 km away, because 20, 200
-- or 300 newer rows elsewhere filled the page.
--
-- These two functions are the same reads with a latitude/longitude box added
-- (the api works the box out from the point and radius, a little wider than
-- the circle, and still checks the exact distance itself). The box is applied
-- before the order and the cap. A null bound is no bound: the api leaves the
-- longitude bounds off where the box would wrap past 180 degrees or reach a
-- pole.
--
-- They are new functions with their own names, not overloads, so every call
-- of the old shape (named or positional) still resolves to the 146 function
-- exactly as before, and nothing of 146 is dropped or changed. Same rules as
-- 146: open posts only, no money or hiring columns, places to two decimals,
-- the public card only, hidden posts and deleted accounts left out. Only the
-- service role may call them. Nothing here writes.

create or replace function public.guest_open_posts_near(
  p_kind      text    default 'request',
  p_limit     integer default 30,
  p_q         text    default null,
  p_pillar    text    default null,
  p_min_minor bigint  default null,
  p_max_minor bigint  default null,
  p_flag      text    default null,
  p_pinned    boolean default null,
  p_poster    uuid    default null,
  p_ids       uuid[]  default null,
  p_min_lat   double precision default null,
  p_max_lat   double precision default null,
  p_min_lng   double precision default null,
  p_max_lng   double precision default null
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
     and (p_min_lat is null or t.loc_lat >= p_min_lat)
     and (p_max_lat is null or t.loc_lat <= p_max_lat)
     and (p_min_lng is null or t.loc_lng >= p_min_lng)
     and (p_max_lng is null or t.loc_lng <= p_max_lng)
   order by t.created_at desc
   limit least(greatest(coalesce(p_limit, 30), 1), 500)
$$;

create or replace function public.guest_helpers_near(
  p_limit   integer default 300,
  p_min_lat double precision default null,
  p_max_lat double precision default null,
  p_min_lng double precision default null,
  p_max_lng double precision default null
)
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
     and (p_min_lat is null or p.loc_lat >= p_min_lat)
     and (p_max_lat is null or p.loc_lat <= p_max_lat)
     and (p_min_lng is null or p.loc_lng >= p_min_lng)
     and (p_max_lng is null or p.loc_lng <= p_max_lng)
     and (p.skills <> '{}'
          or exists (select 1 from public.tasks t
                      where t.poster_id = p.id and t.kind = 'service' and t.status = 'OPEN'
                        and (t.due_at is null or t.due_at > now())
                        and not private.task_is_hidden(t.id)))
   order by p.last_seen_at desc nulls last
   limit least(greatest(coalesce(p_limit, 300), 1), 300)
$$;

revoke all on function public.guest_open_posts_near(text, integer, text, text, bigint, bigint, text, boolean, uuid, uuid[], double precision, double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.guest_helpers_near(integer, double precision, double precision, double precision, double precision) from public, anon, authenticated;
grant execute on function public.guest_open_posts_near(text, integer, text, text, bigint, bigint, text, boolean, uuid, uuid[], double precision, double precision, double precision, double precision) to service_role;
grant execute on function public.guest_helpers_near(integer, double precision, double precision, double precision, double precision) to service_role;
