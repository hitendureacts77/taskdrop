-- 136 -- Feedback board: people suggest ideas, vote on them, and see what the team does.
--
-- A public board inside the app (owner, 2026-11-02). Anyone signed in can post an
-- idea or a bug, vote for ideas that matter to them, and comment. The team
-- (staff with the people area) sets each idea's status -- Open, Under review,
-- Planned, In progress, Done, Not planned -- replies as "TaskDrop team", and
-- can hide a post or a comment. People who posted or voted are told when an
-- idea moves to Planned, In progress or Done, so asking feels worth it.
--
-- This is separate from the private "Send feedback" box (public.feedback, 048),
-- which stays: a bug with a phone number in it belongs there, not on a board
-- everyone reads. The board refuses posts that carry an email address or a
-- phone number.
--
-- Same rules as every migration before Phase 9: only adds (tables, a trigger,
-- functions). The server decides: no table can be written to directly; every
-- change is one of the functions below, which check who is asking, how often,
-- and what they send. Votes are counted by a trigger, never by the app.
--
-- When a person deletes their account (087, 108) their posts, comments and
-- votes go with it: the trigger at the end of this file runs when
-- profiles.deleted_at is set.

-- ----------------------------------------------------------------- tables --

create table if not exists public.feedback_posts (
  id               uuid primary key default gen_random_uuid(),
  author_id        uuid references auth.users (id) on delete set null,
  title            text not null check (char_length(btrim(title)) between 3 and 120),
  body             text not null default '' check (char_length(body) <= 2000),
  category         text not null default 'feature' check (category in ('feature', 'improvement', 'bug', 'other')),
  status           text not null default 'open'
                     check (status in ('open', 'under_review', 'planned', 'in_progress', 'done', 'declined')),
  vote_count       integer not null default 0 check (vote_count >= 0),
  hidden_at        timestamptz,
  hidden_by        uuid references auth.users (id) on delete set null,
  hide_reason      text check (char_length(hide_reason) <= 500),
  created_at       timestamptz not null default now(),
  status_changed_at timestamptz not null default now()
);
create index if not exists feedback_posts_top_idx
  on public.feedback_posts (vote_count desc, created_at desc) where hidden_at is null;
create index if not exists feedback_posts_new_idx
  on public.feedback_posts (created_at desc) where hidden_at is null;
create index if not exists feedback_posts_author_idx on public.feedback_posts (author_id, created_at desc);

create table if not exists public.feedback_votes (
  post_id    uuid not null references public.feedback_posts (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);
create index if not exists feedback_votes_user_idx on public.feedback_votes (user_id);

create table if not exists public.feedback_comments (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.feedback_posts (id) on delete cascade,
  author_id  uuid references auth.users (id) on delete set null,
  is_team    boolean not null default false,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  hidden_at  timestamptz,
  hidden_by  uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists feedback_comments_post_idx on public.feedback_comments (post_id, created_at);
create index if not exists feedback_comments_author_idx on public.feedback_comments (author_id, created_at desc);

alter table public.feedback_posts enable row level security;
alter table public.feedback_votes enable row level security;
alter table public.feedback_comments enable row level security;

-- People read the board through feedback_board_list / feedback_board_get; staff read the tables.
drop policy if exists feedback_posts_admin_read on public.feedback_posts;
create policy feedback_posts_admin_read on public.feedback_posts
  for select to authenticated using (private.is_admin());
drop policy if exists feedback_votes_admin_read on public.feedback_votes;
create policy feedback_votes_admin_read on public.feedback_votes
  for select to authenticated using (private.is_admin());
drop policy if exists feedback_comments_admin_read on public.feedback_comments;
create policy feedback_comments_admin_read on public.feedback_comments
  for select to authenticated using (private.is_admin());

-- No write policies and no write grants: every write goes through a function below.
revoke all on public.feedback_posts, public.feedback_votes, public.feedback_comments from anon, authenticated;
grant select on public.feedback_posts, public.feedback_votes, public.feedback_comments to authenticated;

comment on table public.feedback_posts is 'The public feedback board: ideas and bugs people post, with a status the team sets. Written only by the feedback_board_* and admin_feedback_* functions.';
comment on column public.feedback_posts.vote_count is 'Kept by the trigger on feedback_votes. Never set by the app.';

-- ------------------------------------------------------------ vote counter --

create or replace function private.feedback_vote_count()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    update public.feedback_posts set vote_count = vote_count + 1 where id = new.post_id;
  else
    update public.feedback_posts set vote_count = greatest(vote_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;
revoke all on function private.feedback_vote_count() from public, anon, authenticated;

drop trigger if exists feedback_votes_count on public.feedback_votes;
create trigger feedback_votes_count
  after insert or delete on public.feedback_votes
  for each row execute function private.feedback_vote_count();

-- ----------------------------------------------------------------- helpers --

-- The board is public to every signed-in person, so no phone numbers or emails
-- on it: those go to the private feedback box or to Help & support.
create or replace function private.feedback_has_contact(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
      or regexp_replace(p_text, '[ ().-]', '', 'g') ~ '(^|[^0-9])(\+?91|0)?[6-9][0-9]{9}([^0-9]|$)'
      or p_text ~ '[0-9]{10,}';
$$;
revoke all on function private.feedback_has_contact(text) from public, anon, authenticated;

-- Only a first name is shown. A name that looks like an email or a phone number is not.
create or replace function private.feedback_first_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when nullif(split_part(btrim(coalesce(p_name, '')), ' ', 1), '') ~ '^[^0-9@]{1,30}$'
      then split_part(btrim(p_name), ' ', 1)
    else 'Someone'
  end;
$$;
revoke all on function private.feedback_first_name(text) from public, anon, authenticated;

-- One post as the app sees it. p_me is the person asking.
create or replace function private.feedback_post_json(p_post public.feedback_posts, p_me uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_post.id,
    'title', p_post.title,
    'body', p_post.body,
    'category', p_post.category,
    'status', p_post.status,
    'votes', p_post.vote_count,
    'comments', (select count(*) from public.feedback_comments c where c.post_id = p_post.id and c.hidden_at is null),
    'iVoted', exists (select 1 from public.feedback_votes v where v.post_id = p_post.id and v.user_id = p_me),
    'mine', p_post.author_id is not distinct from p_me,
    'author', private.feedback_first_name((select pr.display_name from public.profiles pr where pr.id = p_post.author_id)),
    'createdAt', p_post.created_at,
    'statusChangedAt', p_post.status_changed_at
  );
$$;
revoke all on function private.feedback_post_json(public.feedback_posts, uuid) from public, anon, authenticated;

create or replace function private.feedback_require_member()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.profiles where id = v_me and deleted_at is not null) then
    raise exception 'This account has been deleted';
  end if;
  return v_me;
end;
$$;
revoke all on function private.feedback_require_member() from public, anon, authenticated;

-- ------------------------------------------------------------- reading ------

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
  v_me    uuid := private.feedback_require_member();
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
  v_me   uuid := private.feedback_require_member();
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

-- ------------------------------------------------------------- writing ------

create or replace function public.feedback_board_post(p_title text, p_body text, p_category text default 'feature')
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := private.feedback_require_member();
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
  v_me    uuid := private.feedback_require_member();
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
  v_me   uuid := private.feedback_require_member();
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

-- -------------------------------------------------------------- staff -------

-- Tell the person who posted an idea, and everyone who voted for it, where it stands.
create or replace function private.feedback_tell_voters(p_post public.feedback_posts, p_title text, p_body text, p_except uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (user_id, kind, title, body)
  select distinct u.user_id, 'feedback', p_title, p_body
    from (
      select p_post.author_id as user_id
      union
      select v.user_id from public.feedback_votes v where v.post_id = p_post.id
    ) u
   where u.user_id is not null and u.user_id is distinct from p_except
     and exists (select 1 from public.profiles pr where pr.id = u.user_id and pr.deleted_at is null);
exception when others then
  null; -- a notice must never stop the change that caused it
end;
$$;
revoke all on function private.feedback_tell_voters(public.feedback_posts, text, text, uuid) from public, anon, authenticated;

create or replace function public.admin_feedback_set_status(p_post uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_post public.feedback_posts;
  v_old  text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_name text;
begin
  perform private.require_people_staff();
  if p_status not in ('open', 'under_review', 'planned', 'in_progress', 'done', 'declined') then
    raise exception 'Unknown status';
  end if;
  if v_note is not null and char_length(v_note) > 1000 then raise exception 'Keep the note under 1000 characters'; end if;

  select * into v_post from public.feedback_posts where id = p_post for update;
  if not found then raise exception 'That idea does not exist'; end if;
  v_old := v_post.status;
  if v_old = p_status and v_note is null then return; end if;

  if v_old <> p_status then
    update public.feedback_posts set status = p_status, status_changed_at = now() where id = p_post
    returning * into v_post;
    perform public.admin_log_event('feedback.status', p_post::text, format('%s to %s', v_old, p_status));

    v_name := left(v_post.title, 80);
    if p_status = 'planned' then
      perform private.feedback_tell_voters(v_post, 'An idea you backed is planned', v_name, auth.uid());
    elsif p_status = 'in_progress' then
      perform private.feedback_tell_voters(v_post, 'We started on an idea you backed', v_name, auth.uid());
    elsif p_status = 'done' then
      perform private.feedback_tell_voters(v_post, 'An idea you backed is live', v_name, auth.uid());
    elsif p_status = 'declined' and v_post.author_id is not null and v_post.author_id <> auth.uid() then
      perform private.notify(v_post.author_id, 'feedback', 'We are not planning your idea', v_name);
    end if;
  end if;

  if v_note is not null then
    insert into public.feedback_comments (post_id, author_id, is_team, body)
    values (p_post, auth.uid(), true, v_note);
  end if;
end;
$fn$;
revoke all on function public.admin_feedback_set_status(uuid, text, text) from public, anon;
grant execute on function public.admin_feedback_set_status(uuid, text, text) to authenticated;

create or replace function public.admin_feedback_reply(p_post uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_post public.feedback_posts;
begin
  perform private.require_people_staff();
  if v_body = '' then raise exception 'Write a reply first'; end if;
  if char_length(v_body) > 1000 then raise exception 'Keep a reply under 1000 characters'; end if;
  select * into v_post from public.feedback_posts where id = p_post;
  if not found then raise exception 'That idea does not exist'; end if;

  insert into public.feedback_comments (post_id, author_id, is_team, body)
  values (p_post, auth.uid(), true, v_body);
  perform public.admin_log_event('feedback.reply', p_post::text, left(v_body, 200));
  if v_post.author_id is not null and v_post.author_id <> auth.uid() then
    perform private.notify(v_post.author_id, 'feedback', 'The team replied to your idea', left(v_post.title, 80));
  end if;
end;
$fn$;
revoke all on function public.admin_feedback_reply(uuid, text) from public, anon;
grant execute on function public.admin_feedback_reply(uuid, text) to authenticated;

create or replace function public.admin_feedback_hide(p_post uuid, p_hide boolean, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  perform private.require_people_staff();
  if p_hide then
    if v_reason is null then raise exception 'Say why you are hiding it'; end if;
    update public.feedback_posts
       set hidden_at = now(), hidden_by = auth.uid(), hide_reason = left(v_reason, 500)
     where id = p_post;
  else
    update public.feedback_posts set hidden_at = null, hidden_by = null, hide_reason = null where id = p_post;
  end if;
  if not found then raise exception 'That idea does not exist'; end if;
  perform public.admin_log_event(case when p_hide then 'feedback.hide' else 'feedback.unhide' end, p_post::text, left(v_reason, 400));
end;
$fn$;
revoke all on function public.admin_feedback_hide(uuid, boolean, text) from public, anon;
grant execute on function public.admin_feedback_hide(uuid, boolean, text) to authenticated;

create or replace function public.admin_feedback_hide_comment(p_comment uuid, p_hide boolean)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_post uuid;
begin
  perform private.require_people_staff();
  update public.feedback_comments
     set hidden_at = case when p_hide then now() else null end,
         hidden_by = case when p_hide then auth.uid() else null end
   where id = p_comment
  returning post_id into v_post;
  if not found then raise exception 'That comment does not exist'; end if;
  perform public.admin_log_event(case when p_hide then 'feedback.comment_hide' else 'feedback.comment_unhide' end, p_comment::text, null);
end;
$fn$;
revoke all on function public.admin_feedback_hide_comment(uuid, boolean) from public, anon;
grant execute on function public.admin_feedback_hide_comment(uuid, boolean) to authenticated;

-- ---------------------------------------------------- account deletion ------

create or replace function private.feedback_board_erase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from public.feedback_votes    where user_id = new.id;
    delete from public.feedback_comments where author_id = new.id;
    delete from public.feedback_posts    where author_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function private.feedback_board_erase() from public, anon, authenticated;

drop trigger if exists feedback_board_erase on public.profiles;
create trigger feedback_board_erase
  after update of deleted_at on public.profiles
  for each row execute function private.feedback_board_erase();
