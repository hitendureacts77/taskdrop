-- Every column of profiles and tasks (and of the other tables people read beyond
-- their own rows) has been decided: public, parties only, or private
-- (plan task 2.18 part A, hole H74; the same idea as the guest card's test, H62).
--
-- Row rules guard rows, not columns: a signed-in person can read every column of
-- a row they may see. The api names its columns (supabase/functions/api/columns.ts),
-- and docs/SECURITY_COLUMNS.md says in plain words why each one is where it is.
-- A column added to one of these tables FAILS this test until someone puts it on a
-- list below, in columns.ts and in the doc. The lists here and in columns.ts must
-- stay the same: supabase/functions/api/columns.test.ts compares them.
--
-- Changes no data: reads the catalog only.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/column_decisions.test.sql

begin;

do $$
declare
  -- profiles: anyone signed in sees these on anyone's card.
  v_profiles_public text[] := array[
    'id', 'display_name', 'avatar_url', 'skills', 'loc_lat', 'loc_lng', 'loc_label',
    'poster_rating_avg', 'poster_rating_count', 'worker_rating_avg', 'worker_rating_count',
    'created_at', 'updated_at', 'onboarded_at', 'username', 'bio', 'languages', 'intent',
    'last_seen_at', 'live_until', 'worker_bio', 'worker_onboarded_at', 'deleted_at'];
  -- profiles: the owner only; never in an answer about someone else.
  v_profiles_private text[] := array[
    'payout_upi', 'sessions_revoked_at', 'sessions_keep_session', 'weekly_goal_minor', 'referral_code'];
  -- tasks: what anyone who can see the task may see.
  v_tasks_public text[] := array[
    'id', 'poster_id', 'pillar', 'title', 'description', 'benchmark_minor', 'time_limit_minutes', 'flag', 'status',
    'media_kind', 'media_path', 'media_seconds', 'loc_lat', 'loc_lng', 'loc_label',
    'started_at', 'work_done_at', 'auto_complete_at', 'completed_at', 'clear_at', 'created_at', 'updated_at',
    'cleared_at', 'funded_at', 'category', 'skills', 'difficulty', 'assignment_mode', 'due_at', 'milestones', 'kind',
    'topup_pct', 'flash_until', 'live_answer', 'crew_id', 'crew_size', 'crew_slot', 'repeat_every', 'repeated_from',
    'preferred_until', 'want_photos', 'photos_public'];
  -- tasks: the poster and the hired worker only.
  v_tasks_parties text[] := array[
    'funded_minor', 'funded_credits_minor', 'funded_via', 'funding_payment_id',
    'locked_minor', 'locked_bid_id', 'payout_mode', 'wallet_refunded_at', 'preferred_worker_id'];
  -- Tables whose rows people other than the owner can read, as parties of a task, thread or crew (every column
  -- parties only), or public by design (reviews). One decided list each.
  v_other jsonb := jsonb_build_object(
    'bids', array['id', 'task_id', 'worker_id', 'price_minor', 'time_limit_minutes', 'message', 'is_locked', 'created_at'],
    'assignments', array['id', 'task_id', 'bid_id', 'worker_id', 'status', 'escrow_minor', 'payout_mode', 'created_at', 'updated_at'],
    'task_proofs', array['id', 'task_id', 'worker_id', 'summary', 'files', 'created_at'],
    'reviews', array['id', 'task_id', 'author_id', 'subject_id', 'about_role', 'rating', 'comment', 'created_at'],
    'messages', array['id', 'task_id', 'sender_id', 'body', 'created_at'],
    'crew_messages', array['id', 'crew_id', 'sender_id', 'body', 'created_at'],
    'task_private', array['task_id', 'loc_lat', 'loc_lng', 'updated_at', 'address'],
    'task_disputes', array['id', 'task_id', 'opened_by', 'reason', 'created_at'],
    'settings', array['key', 'value', 'updated_at']);
  v_undecided text[];
  v_table     text;
  v_cols      text[];
begin
  -- ---- profiles ---------------------------------------------------------------
  select array_agg(c.column_name::text order by c.ordinal_position) into v_undecided
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'profiles'
     and not (c.column_name::text = any(v_profiles_public || v_profiles_private));
  if v_undecided is not null then
    raise exception 'FAIL: public.profiles has columns nobody decided on: %. Put each on the public or private list here, in supabase/functions/api/columns.ts and in docs/SECURITY_COLUMNS.md.', v_undecided;
  end if;
  if v_profiles_public && v_profiles_private then
    raise exception 'FAIL: a profiles column is on both the public and the private list';
  end if;

  -- ---- tasks ------------------------------------------------------------------
  select array_agg(c.column_name::text order by c.ordinal_position) into v_undecided
    from information_schema.columns c
   where c.table_schema = 'public' and c.table_name = 'tasks'
     and not (c.column_name::text = any(v_tasks_public || v_tasks_parties));
  if v_undecided is not null then
    raise exception 'FAIL: public.tasks has columns nobody decided on: %. Put each on the public or parties-only list here, in supabase/functions/api/columns.ts and in docs/SECURITY_COLUMNS.md.', v_undecided;
  end if;
  if v_tasks_public && v_tasks_parties then
    raise exception 'FAIL: a tasks column is on both the public and the parties-only list';
  end if;

  -- ---- the other tables people read beyond their own rows -------------------
  for v_table in select jsonb_object_keys(v_other) loop
    select array(select jsonb_array_elements_text(v_other -> v_table)) into v_cols;
    select array_agg(c.column_name::text order by c.ordinal_position) into v_undecided
      from information_schema.columns c
     where c.table_schema = 'public' and c.table_name = v_table
       and not (c.column_name::text = any(v_cols));
    if v_undecided is not null then
      raise exception 'FAIL: public.% has columns nobody decided on: %. Add each to the list here, to the matching list in supabase/functions/api/columns.ts, and to docs/SECURITY_COLUMNS.md.', v_table, v_undecided;
    end if;
  end loop;

  raise notice 'column_decisions: ok';
end;
$$;

rollback;
