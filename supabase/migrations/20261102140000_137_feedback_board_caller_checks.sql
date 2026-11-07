-- 137 -- The feedback board's five functions check the caller where test T7 can see it.
--
-- Migration 136 already refused a caller who is not signed in: each of
-- feedback_board_list, _get, _post, _vote and _comment starts with
-- private.feedback_require_member(), which raises 'Sign in first' when
-- auth.uid() is null, and none of them is granted to anon. But the check sat
-- inside a helper whose name T7 (supabase/tests/rpc_caller_checks.test.sql)
-- does not recognise, so T7 failed and the "money and access rules" CI job
-- has been red since PR 185.
--
-- The board is for signed-in people only (136: "public to every signed-in
-- person"; the board test asserts signed-out visitors cannot read it), so
-- list and get are not put on T7's public-on-purpose list. Instead the same
-- check moves into private.assert_feedback_member(), named like
-- private.assert_service_caller() (090) so T7 knows it, and the five
-- functions are re-created to call it. Their bodies are otherwise unchanged.
--
-- Only adds and replaces, like every migration before Phase 9.
-- private.feedback_require_member() stays in place, unused and closed to
-- the app's roles.

create or replace function private.assert_feedback_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if exists (select 1 from public.profiles where id = v_me and deleted_at is not null) then
    raise exception 'This account has been deleted' using errcode = '42501';
  end if;
  return v_me;
end;
$$;
revoke all on function private.assert_feedback_member() from public, anon, authenticated;

create or replace function public.feedback_board_list(
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
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := private.assert_feedback_member();
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

  select coalesce(jsonb_agg(private.feedback_post_json(p, v_me) order by r.rn), '[]'::jsonb)
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
       limit v_limit offset greatest(coalesce(p_offset, 0), 0)
    ) r
    join public.feedback_posts p on p.id = r.id;
  return v_out;
end;
$fn$;
revoke all on function public.feedback_board_list(text, text, text, text, integer, integer) from public, anon;
grant execute on function public.feedback_board_list(text, text, text, text, integer, integer) to authenticated;

create or replace function public.feedback_board_get(p_post uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me   uuid := private.assert_feedback_member();
  v_post public.feedback_posts;
begin
  select * into v_post from public.feedback_posts where id = p_post and hidden_at is null;
  if not found then return null; end if;
  return jsonb_build_object(
    'post', private.feedback_post_json(v_post, v_me),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', c.id,
               'body', c.body,
               'isTeam', c.is_team,
               'author', case when c.is_team then 'TaskDrop team'
                              else private.feedback_first_name(pr.display_name) end,
               'mine', c.author_id is not distinct from v_me,
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
revoke all on function public.feedback_board_get(uuid) from public, anon;
grant execute on function public.feedback_board_get(uuid) to authenticated;

create or replace function public.feedback_board_post(p_title text, p_body text, p_category text default 'feature')
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := private.assert_feedback_member();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_post  public.feedback_posts;
begin
  if char_length(v_title) < 3 then raise exception 'Give your idea a short title first'; end if;
  if char_length(v_title) > 120 then raise exception 'Keep the title under 120 characters'; end if;
  if char_length(v_body) > 2000 then raise exception 'Keep the details under 2000 characters'; end if;
  if p_category not in ('feature', 'improvement', 'bug', 'other') then raise exception 'Pick what kind of idea this is'; end if;
  if private.feedback_has_contact(v_title || ' ' || v_body) then
    raise exception 'Leave phone numbers and email addresses out. Everyone can read the board. Use Help & support for anything private';
  end if;
  if (select count(*) from public.feedback_posts where author_id = v_me and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'That is five ideas today. Come back tomorrow, or vote for ideas already on the board';
  end if;
  if exists (select 1 from public.feedback_posts
              where author_id = v_me and lower(title) = lower(v_title) and created_at > now() - interval '7 days') then
    raise exception 'You already posted that one';
  end if;

  insert into public.feedback_posts (author_id, title, body, category)
  values (v_me, v_title, v_body, p_category)
  returning * into v_post;
  -- Whoever suggests an idea wants it, so it starts with their vote.
  insert into public.feedback_votes (post_id, user_id) values (v_post.id, v_me);
  select * into v_post from public.feedback_posts where id = v_post.id;

  perform private.notify_staff('people', 'New idea on the feedback board', left(v_title, 120), v_me);
  return private.feedback_post_json(v_post, v_me);
end;
$fn$;
revoke all on function public.feedback_board_post(text, text, text) from public, anon;
grant execute on function public.feedback_board_post(text, text, text) to authenticated;

create or replace function public.feedback_board_vote(p_post uuid, p_on boolean)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := private.assert_feedback_member();
  v_votes integer;
begin
  if not exists (select 1 from public.feedback_posts where id = p_post and hidden_at is null) then
    raise exception 'That idea is no longer on the board';
  end if;
  if coalesce(p_on, true) then
    insert into public.feedback_votes (post_id, user_id) values (p_post, v_me) on conflict do nothing;
  else
    delete from public.feedback_votes where post_id = p_post and user_id = v_me;
  end if;
  select vote_count into v_votes from public.feedback_posts where id = p_post;
  return jsonb_build_object('votes', v_votes, 'iVoted', coalesce(p_on, true));
end;
$fn$;
revoke all on function public.feedback_board_vote(uuid, boolean) from public, anon;
grant execute on function public.feedback_board_vote(uuid, boolean) to authenticated;

create or replace function public.feedback_board_comment(p_post uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me   uuid := private.assert_feedback_member();
  v_body text := btrim(coalesce(p_body, ''));
  v_row  public.feedback_comments;
begin
  if v_body = '' then raise exception 'Write a comment first'; end if;
  if char_length(v_body) > 1000 then raise exception 'Keep a comment under 1000 characters'; end if;
  if private.feedback_has_contact(v_body) then
    raise exception 'Leave phone numbers and email addresses out. Everyone can read the board';
  end if;
  if not exists (select 1 from public.feedback_posts where id = p_post and hidden_at is null) then
    raise exception 'That idea is no longer on the board';
  end if;
  if (select count(*) from public.feedback_comments where author_id = v_me and created_at > now() - interval '24 hours') >= 30 then
    raise exception 'That is a lot of comments for one day. Try again tomorrow';
  end if;

  insert into public.feedback_comments (post_id, author_id, body)
  values (p_post, v_me, v_body)
  returning * into v_row;
  return jsonb_build_object(
    'id', v_row.id, 'body', v_row.body, 'isTeam', false, 'mine', true, 'createdAt', v_row.created_at,
    'author', private.feedback_first_name((select display_name from public.profiles where id = v_me))
  );
end;
$fn$;
revoke all on function public.feedback_board_comment(uuid, text) from public, anon;
grant execute on function public.feedback_board_comment(uuid, text) to authenticated;
