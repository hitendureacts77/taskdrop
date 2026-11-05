-- 151: four more things a guest may read (guest mode, design D15).
--
-- Migration 146 opened the feed, task pages and public profiles to people who
-- have not made an account yet. Four reads on those same pages still needed a
-- signed-in caller (auth.uid()), so a guest saw them empty:
--
--   * questions and answers on an open task;
--   * the public Ideas & feedback board and one idea with its comments;
--   * the "nearby pulse" on Home (two counts, nothing else);
--   * a helper's before-and-after photos, where the customer agreed.
--
-- The guest versions below show exactly what a signed-in stranger sees, with
-- "mine" and "iVoted" always false. As in 146, only the service role may call
-- them (the api function, for guests), nothing here writes, and the signed-in
-- functions are left as they are.
--
-- guest_public_media is replaced so a guest's picture signing also allows the
-- before and after photos returned by guest_proof_photos, and nothing else new.

-- ------------------------------------------------- questions on a task ----

-- Questions and answers on an open, visible post, oldest first. Askers show
-- by first name only. Any other task answers an empty list.
create or replace function public.guest_task_questions(p_task uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id,
             'body', q.body,
             'answer', q.answer,
             'answeredAt', q.answered_at,
             'asker', private.question_first_name(pr.display_name),
             'mine', false,
             'createdAt', q.created_at
           ) order by q.created_at)
      from (select * from public.task_questions
             where task_id = p_task and hidden_at is null
             order by created_at limit 100) q
      left join public.profiles pr on pr.id = q.asker_id
     where exists (select 1 from public.tasks t
                    join public.profiles p on p.id = t.poster_id
                   where t.id = p_task
                     and t.status = 'OPEN'
                     and (t.due_at is null or t.due_at > now())
                     and p.deleted_at is null
                     and not private.task_is_hidden(t.id))
  ), '[]'::jsonb)
$$;

-- --------------------------------------------------- the Ideas board ----

-- The board as feedback_board_list shows it, for someone with no account.
create or replace function public.guest_feedback_board_list(
  p_sort     text    default 'top',
  p_status   text    default null,
  p_category text    default null,
  p_search   text    default null,
  p_limit    integer default 30,
  p_offset   integer default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 30), 1), 50);
  v_q     text := nullif(btrim(coalesce(p_search, '')), '');
  v_out   jsonb;
begin
  if p_sort not in ('top', 'new') then raise exception 'Sort by top or new'; end if;
  if p_status is not null and p_status not in ('open', 'under_review', 'planned', 'in_progress', 'done', 'declined') then
    raise exception 'Unknown status';
  end if;
  if p_category is not null and p_category not in ('feature', 'improvement', 'bug', 'other') then
    raise exception 'Unknown category';
  end if;
  if v_q is not null then
    v_q := '%' || replace(replace(replace(left(v_q, 60), '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  select coalesce(jsonb_agg(private.feedback_post_json(p, null) order by r.rn), '[]'::jsonb)
    into v_out
    from (
      select x.id, row_number() over (
               order by case when p_sort = 'top' then x.vote_count end desc nulls last, x.created_at desc, x.id
             ) as rn
        from public.feedback_posts x
       where x.hidden_at is null
         and (p_status is null or x.status = p_status)
         and (p_category is null or x.category = p_category)
         and (v_q is null or x.title ilike v_q escape '\' or x.body ilike v_q escape '\')
       order by rn
       limit v_limit offset least(greatest(coalesce(p_offset, 0), 0), 10000)
    ) r
    join public.feedback_posts p on p.id = r.id;
  return v_out;
end;
$fn$;

-- One idea with its comments, as feedback_board_get shows it; null once hidden or gone.
create or replace function public.guest_feedback_board_get(p_post uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_post public.feedback_posts;
begin
  select * into v_post from public.feedback_posts where id = p_post and hidden_at is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'post', private.feedback_post_json(v_post, null),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'body', c.body,
               'isTeam', c.is_team,
               'author', case when c.is_team then 'TaskDrop team'
                              else private.feedback_first_name(pr.display_name) end,
               'mine', false,
               'createdAt', c.created_at
             ) order by c.created_at)
        from (select * from public.feedback_comments
               where post_id = p_post and hidden_at is null
               order by created_at limit 200) c
        left join public.profiles pr on pr.id = c.author_id
    ), '[]'::jsonb)
  );
end;
$fn$;

-- --------------------------------------------------------- nearby pulse ----

-- Tasks finished near a point today and helpers active there now: the same
-- two counts nearby_pulse gives, nothing else.
create or replace function public.guest_nearby_pulse(p_lat double precision, p_lng double precision, p_radius_km double precision default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_radius double precision := least(greatest(coalesce(p_radius_km, 5), 2), 25);
  v_cos    double precision;
  v_dlat   double precision;
  v_today  timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
begin
  if p_lat is null or p_lng is null or p_lat not between -90 and 90 or p_lng not between -180 and 180 then
    raise exception 'Pick your area first';
  end if;
  v_cos  := greatest(cos(radians(p_lat)), 0.01);
  v_dlat := v_radius / 111.32;

  return jsonb_build_object(
    'doneToday', (
      select count(*) from public.tasks t
       where t.status in ('COMPLETED', 'AUTO_COMPLETED')
         and t.completed_at >= v_today
         and t.loc_lat between p_lat - v_dlat and p_lat + v_dlat
         and 111.32 * sqrt(power(t.loc_lat - p_lat, 2) + power((t.loc_lng - p_lng) * v_cos, 2)) <= v_radius
    ),
    'activeNow', (
      select count(*) from public.profiles p
       where p.last_seen_at > now() - interval '3 minutes'
         and p.deleted_at is null
         and p.onboarded_at is not null
         and p.skills <> '{}'
         and p.loc_lat between p_lat - v_dlat and p_lat + v_dlat
         and 111.32 * sqrt(power(p.loc_lat - p_lat, 2) + power((p.loc_lng - p_lng) * v_cos, 2)) <= v_radius
    )
  );
end;
$fn$;

-- ------------------------------------------------ before-and-after photos ----

-- The before and after photos from a helper's finished jobs where the customer
-- allowed it (photos_public), as worker_proof_photos gives them. Only files the
-- helper uploaded themself, never a moderated task or a deleted helper.
create or replace function public.guest_proof_photos(p_worker uuid)
returns table (task_id uuid, title text, category text, completed_at timestamptz, files jsonb)
language sql
stable
security definer
set search_path = ''
as $$
  select x.task_id, x.title, x.category, x.completed_at,
         coalesce((select jsonb_agg(f) from jsonb_array_elements(x.files) f
                    where f ->> 'label' in ('before', 'after')
                      and private.guest_owns_media(p_worker, f ->> 'path')), '[]'::jsonb)
    from (
      select distinct on (t.id) t.id as task_id, t.title, t.category, t.completed_at, tp.files
        from public.tasks t
        join public.task_proofs tp on tp.task_id = t.id and tp.worker_id = p_worker
        join public.profiles w on w.id = p_worker and w.deleted_at is null
       where t.photos_public
         and t.status in ('COMPLETED', 'AUTO_COMPLETED')
         and not private.task_is_hidden(t.id)
       order by t.id, tp.created_at desc
    ) x
   order by x.completed_at desc nulls last
   limit 12;
$$;

-- Which of these pictures a guest may see: the poster's own picture on an
-- open post, a person's own profile photo (both from 146), or a before/after
-- photo that guest_proof_photos shows. Anything else is left out.
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
                    and not private.task_is_hidden(t.id)
                    and private.guest_owns_media(t.poster_id, x.path))
      or exists (select 1 from public.profiles p
                  where p.avatar_url = x.path and p.deleted_at is null
                    and private.guest_owns_media(p.id, x.path))
      or exists (select 1
                   from public.task_proofs tp
                   join public.tasks t on t.id = tp.task_id
                   join public.profiles w on w.id = tp.worker_id and w.deleted_at is null
                   cross join lateral jsonb_array_elements(tp.files) f
                  where f ->> 'path' = x.path
                    and f ->> 'label' in ('before', 'after')
                    and t.photos_public
                    and t.status in ('COMPLETED', 'AUTO_COMPLETED')
                    and not private.task_is_hidden(t.id)
                    and private.guest_owns_media(tp.worker_id, x.path))
$$;

revoke all on function public.guest_task_questions(uuid) from public, anon, authenticated;
revoke all on function public.guest_feedback_board_list(text, text, text, text, integer, integer) from public, anon, authenticated;
revoke all on function public.guest_feedback_board_get(uuid) from public, anon, authenticated;
revoke all on function public.guest_nearby_pulse(double precision, double precision, double precision) from public, anon, authenticated;
revoke all on function public.guest_proof_photos(uuid) from public, anon, authenticated;
revoke all on function public.guest_public_media(text[]) from public, anon, authenticated;
grant execute on function public.guest_task_questions(uuid) to service_role;
grant execute on function public.guest_feedback_board_list(text, text, text, text, integer, integer) to service_role;
grant execute on function public.guest_feedback_board_get(uuid) to service_role;
grant execute on function public.guest_nearby_pulse(double precision, double precision, double precision) to service_role;
grant execute on function public.guest_proof_photos(uuid) to service_role;
grant execute on function public.guest_public_media(text[]) to service_role;
