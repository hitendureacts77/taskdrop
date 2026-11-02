-- The feedback board (migration 136): posting, voting, comments, the team's
-- status changes, hiding, and what happens when an account is deleted.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/feedback_board.test.sql

begin;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user)::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_operator() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

do $$
declare
  v_admin   uuid := gen_random_uuid();
  v_ann     uuid := gen_random_uuid();
  v_ben     uuid := gen_random_uuid();
  v_cy      uuid := gen_random_uuid();
  v_post    jsonb;
  v_post2   jsonb;
  v_id      uuid;
  v_id2     uuid;
  v_list    jsonb;
  v_got     jsonb;
  v_comment jsonb;
  v_failed  boolean;
  i         integer;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'board+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_ann), (v_ben), (v_cy)) as u(id);
  insert into public.profiles (id, display_name)
  values (v_admin, 'Board Admin'), (v_ann, 'Ann Marie Dsouza'), (v_ben, 'Ben'), (v_cy, '9876543210')
  on conflict (id) do nothing;
  update public.profiles set display_name = case id
      when v_admin then 'Board Admin' when v_ann then 'Ann Marie Dsouza'
      when v_ben then 'Ben' else '9876543210' end
   where id in (v_admin, v_ann, v_ben, v_cy);
  insert into public.wallets (user_id) values (v_admin), (v_ann), (v_ben), (v_cy) on conflict (user_id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;

  -- ---- nobody writes the tables directly -----------------------------------
  if has_table_privilege('authenticated', 'public.feedback_posts', 'INSERT')
     or has_table_privilege('authenticated', 'public.feedback_posts', 'UPDATE')
     or has_table_privilege('authenticated', 'public.feedback_votes', 'INSERT')
     or has_table_privilege('authenticated', 'public.feedback_comments', 'INSERT')
     or has_table_privilege('anon', 'public.feedback_posts', 'SELECT') then
    raise exception 'FAIL: the board tables must only change through the functions';
  end if;
  if has_function_privilege('anon', 'public.feedback_board_list(text,text,text,text,integer,integer)', 'EXECUTE') then
    raise exception 'FAIL: signed-out visitors must not read the board';
  end if;

  -- ---- posting -------------------------------------------------------------
  perform pg_temp.become(v_ann);
  v_post := public.feedback_board_post('Dark mode for the whole app', 'My eyes hurt at night.', 'feature');
  v_id := (v_post ->> 'id')::uuid;
  assert (v_post ->> 'votes')::int = 1, 'a new idea starts with its author''s vote';
  assert (v_post ->> 'iVoted')::boolean and (v_post ->> 'mine')::boolean, 'the author voted and owns it';
  assert v_post ->> 'status' = 'open', 'it starts open';
  assert v_post ->> 'author' = 'Ann', 'only a first name is shown';

  v_failed := false;
  begin perform public.feedback_board_post('ab', '', 'feature'); exception when others then v_failed := true; end;
  assert v_failed, 'a title needs at least 3 characters';
  v_failed := false;
  begin perform public.feedback_board_post('Fine title', '', 'nonsense'); exception when others then v_failed := true; end;
  assert v_failed, 'the category must be one of the four';
  v_failed := false;
  begin perform public.feedback_board_post('Call me on 98765 43210', '', 'other'); exception when others then v_failed := true; end;
  assert v_failed, 'a phone number in the title is refused';
  v_failed := false;
  begin perform public.feedback_board_post('Contact me', 'write to me@example.com please', 'other'); exception when others then v_failed := true; end;
  assert v_failed, 'an email in the details is refused';
  v_failed := false;
  begin perform public.feedback_board_post('dark mode for the whole app', '', 'feature'); exception when others then v_failed := true; end;
  assert v_failed, 'the same title twice is refused';
  -- Ordinary numbers and dates are fine.
  perform public.feedback_board_post('Show prices from 100 to 5000 rupees', 'Updated on 2026-11-02 at 10:30', 'improvement');

  -- five ideas a day
  for i in 1..3 loop
    perform public.feedback_board_post('Idea number ' || i, '', 'other');
  end loop;
  v_failed := false;
  begin perform public.feedback_board_post('One idea too many', '', 'other'); exception when others then v_failed := true; end;
  assert v_failed, 'the sixth idea of the day is refused';

  -- ---- votes ---------------------------------------------------------------
  perform pg_temp.become(v_ben);
  assert (public.feedback_board_vote(v_id, true) ->> 'votes')::int = 2, 'a second person votes';
  assert (public.feedback_board_vote(v_id, true) ->> 'votes')::int = 2, 'voting twice counts once';
  perform pg_temp.become(v_cy);
  assert (public.feedback_board_vote(v_id, true) ->> 'votes')::int = 3, 'a third vote';
  assert (public.feedback_board_vote(v_id, false) ->> 'votes')::int = 2, 'taking a vote back';
  perform pg_temp.become(v_ben);
  assert (public.feedback_board_vote(v_id, false) ->> 'votes')::int = 1, 'and another';
  perform public.feedback_board_vote(v_id, true);

  v_failed := false;
  begin perform public.feedback_board_vote(gen_random_uuid(), true); exception when others then v_failed := true; end;
  assert v_failed, 'voting for nothing is refused';

  -- ---- the list ------------------------------------------------------------
  v_list := public.feedback_board_list('top');
  assert (v_list -> 0 ->> 'id')::uuid = v_id, 'the most voted idea is first';
  assert (v_list -> 0 ->> 'iVoted')::boolean, 'the caller''s own vote shows';
  assert not (v_list -> 0 ->> 'mine')::boolean, 'Ben did not post it';
  assert jsonb_array_length(public.feedback_board_list('top', null, null, 'dark mode')) = 1, 'search finds it';
  assert jsonb_array_length(public.feedback_board_list('top', null, null, '100%')) = 0, 'a % in the search is not a wildcard';
  assert jsonb_array_length(public.feedback_board_list('top', 'planned')) = 0, 'nothing is planned yet';
  assert jsonb_array_length(public.feedback_board_list('top', null, 'bug')) = 0, 'no bugs yet';
  assert jsonb_array_length(public.feedback_board_list('new', null, null, null, 2, 0)) = 2, 'a page is as long as asked';
  v_failed := false;
  begin perform public.feedback_board_list('sideways'); exception when others then v_failed := true; end;
  assert v_failed, 'unknown sort refused';

  -- a name that looks like a phone number is not shown
  perform pg_temp.become(v_cy);
  v_post2 := public.feedback_board_post('Cy has a number for a name', '', 'bug');
  v_id2 := (v_post2 ->> 'id')::uuid;
  assert v_post2 ->> 'author' = 'Someone', 'a numeric name is hidden';

  -- ---- comments ------------------------------------------------------------
  perform pg_temp.become(v_ben);
  v_comment := public.feedback_board_comment(v_id, 'Yes please, I use the app at night.');
  assert v_comment ->> 'author' = 'Ben' and (v_comment ->> 'mine')::boolean, 'the comment is Ben''s';
  v_failed := false;
  begin perform public.feedback_board_comment(v_id, 'call 9876543210'); exception when others then v_failed := true; end;
  assert v_failed, 'a phone number in a comment is refused';
  v_failed := false;
  begin perform public.feedback_board_comment(v_id, '   '); exception when others then v_failed := true; end;
  assert v_failed, 'an empty comment is refused';
  v_got := public.feedback_board_get(v_id);
  assert jsonb_array_length(v_got -> 'comments') = 1, 'the comment shows on the idea';
  assert (v_got -> 'post' ->> 'comments')::int = 1, 'and is counted';

  -- ---- the team ------------------------------------------------------------
  perform pg_temp.become(v_ben);
  v_failed := false;
  begin perform public.admin_feedback_set_status(v_id, 'planned'); exception when others then v_failed := true; end;
  assert v_failed, 'only staff set a status';
  v_failed := false;
  begin perform public.admin_feedback_hide(v_id, true, 'no'); exception when others then v_failed := true; end;
  assert v_failed, 'only staff hide a post';

  perform pg_temp.become(v_admin);
  v_failed := false;
  begin perform public.admin_feedback_set_status(v_id, 'maybe'); exception when others then v_failed := true; end;
  assert v_failed, 'an unknown status is refused';
  perform public.admin_feedback_set_status(v_id, 'planned', 'We will build this in November.');

  perform pg_temp.as_operator();
  assert (select status from public.feedback_posts where id = v_id) = 'planned', 'the status changed';
  assert exists (select 1 from public.notifications where user_id = v_ann and kind = 'feedback'), 'the author is told';
  assert exists (select 1 from public.notifications where user_id = v_ben and kind = 'feedback'), 'the voter is told';
  assert not exists (select 1 from public.notifications where user_id = v_cy and kind = 'feedback' and body like 'Dark mode%'),
    'someone who did not vote is not told';
  assert not exists (select 1 from public.notifications where user_id = v_admin and kind = 'feedback'), 'the actor is not told';
  assert exists (select 1 from public.admin_audit_log where action = 'feedback.status' and target_id = v_id::text), 'the change is logged';

  perform pg_temp.become(v_ann);
  v_got := public.feedback_board_get(v_id);
  assert exists (select 1 from jsonb_array_elements(v_got -> 'comments') e
                  where (e ->> 'isTeam')::boolean and e ->> 'author' = 'TaskDrop team'),
    'the team''s note shows as a team comment, under the team name';
  assert jsonb_array_length(public.feedback_board_list('top', 'planned')) = 1, 'the status filter finds it';

  perform pg_temp.become(v_admin);
  perform public.admin_feedback_reply(v_id, 'Thanks all, shipping soon.');
  perform public.admin_feedback_set_status(v_id, 'done');
  perform pg_temp.as_operator();
  assert (select count(*) from public.notifications where user_id = v_ann and kind = 'feedback') >= 3,
    'the author hears about the reply and each status change';

  -- hide a comment, then a post
  perform pg_temp.become(v_admin);
  perform public.admin_feedback_hide_comment((v_comment ->> 'id')::uuid, true);
  perform pg_temp.become(v_ann);
  assert (public.feedback_board_get(v_id) -> 'post' ->> 'comments')::int = 2, 'a hidden comment no longer counts';

  perform pg_temp.become(v_admin);
  v_failed := false;
  begin perform public.admin_feedback_hide(v_id2, true, ''); exception when others then v_failed := true; end;
  assert v_failed, 'hiding needs a reason';
  perform public.admin_feedback_hide(v_id2, true, 'Spam');
  perform pg_temp.become(v_ben);
  assert public.feedback_board_get(v_id2) is null, 'a hidden idea cannot be opened';
  assert not exists (select 1 from jsonb_array_elements(public.feedback_board_list('new', null, null, null, 50)) e where e ->> 'id' = v_id2::text),
    'and is not listed';
  v_failed := false;
  begin perform public.feedback_board_vote(v_id2, true); exception when others then v_failed := true; end;
  assert v_failed, 'nor can it be voted for';
  perform pg_temp.become(v_admin);
  perform public.admin_feedback_hide(v_id2, false);
  perform pg_temp.become(v_ben);
  assert public.feedback_board_get(v_id2) is not null, 'unhiding brings it back';

  -- ---- deleting an account takes its ideas, comments and votes with it ----------
  perform pg_temp.as_operator();
  update public.profiles set deleted_at = now() where id = v_ben;
  assert not exists (select 1 from public.feedback_votes where user_id = v_ben), 'Ben''s votes are gone';
  assert not exists (select 1 from public.feedback_comments where author_id = v_ben), 'Ben''s comments are gone';
  assert (select vote_count from public.feedback_posts where id = v_id) = 1, 'the count follows';
  update public.profiles set deleted_at = now() where id = v_ann;
  assert not exists (select 1 from public.feedback_posts where author_id = v_ann), 'Ann''s ideas are gone';
  assert not exists (select 1 from public.feedback_posts where id = v_id), 'including the one others had backed';

  perform pg_temp.become(v_ben);
  v_failed := false;
  begin perform public.feedback_board_list('top'); exception when others then v_failed := true; end;
  assert v_failed, 'a deleted account cannot use the board';

  raise notice 'feedback_board: all assertions passed';
end;
$$;

rollback;
