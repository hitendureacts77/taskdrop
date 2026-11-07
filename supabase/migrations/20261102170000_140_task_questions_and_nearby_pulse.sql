-- 140 -- Questions on a task, and the "near you" line on the poster's Home.
--
-- Two additions from the Qwikyo / Heplo review, design approved by the owner on
-- 2026-11-02 ("Added on top of today's TaskDrop", items 1 and 4).
--
-- 1. Questions on a task. Before they send an offer, workers can ask the poster
--    something ("Which model is the scooty?"). The poster answers once and
--    everyone looking at the task sees the question and the answer, so the
--    same thing is not asked five times. Phone numbers, email addresses and
--    links are refused: contacts unlock only when work starts (AGENTS.md,
--    privacy rule), and a question box must not become a way round that.
--    The poster is told about each new question; the asker is told when it is
--    answered.
--
-- 2. nearby_pulse(lat, lng, radius): two counts for one line under the area on
--    the poster's Home -- tasks finished near there today and helpers near
--    there who are active right now. Counts only: no task, place or person
--    leaves the function. Workers are placed by their public, rounded area
--    (migration 074); tasks by their pin, which is only compared, never sent.
--
-- Same rules as every migration before Phase 9: only adds. Nothing can be
-- written to the new table directly; every change is one of the functions
-- below, which check who is asking, how often and what they send.
-- When a person deletes their account (087, 108) their questions go with it.

-- ----------------------------------------------------------------- table ----

create table if not exists public.task_questions (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks (id) on delete cascade,
  asker_id    uuid references auth.users (id) on delete set null,
  body        text not null check (char_length(btrim(body)) between 3 and 300),
  answer      text check (answer is null or char_length(btrim(answer)) between 1 and 500),
  answered_at timestamptz,
  hidden_at   timestamptz,
  hidden_by   uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists task_questions_task_idx on public.task_questions (task_id, created_at);
create index if not exists task_questions_asker_idx on public.task_questions (asker_id, created_at desc);

alter table public.task_questions enable row level security;

-- People read questions through task_questions_list; staff read the table.
drop policy if exists task_questions_admin_read on public.task_questions;
create policy task_questions_admin_read on public.task_questions
  for select to authenticated using (private.is_admin());

-- No write policies and no write grants: every write goes through a function below.
revoke all on public.task_questions from anon, authenticated;
grant select on public.task_questions to authenticated;

comment on table public.task_questions is
  'Questions workers ask on a task before offering, and the poster''s public answer. Written only by the task_question_* functions (migration 140).';

-- ----------------------------------------------------------------- helpers --

-- The same contact check as the feedback board (136), plus web links.
create or replace function private.question_has_contact(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_text ~* '[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}'
      or regexp_replace(p_text, '[ ().-]', '', 'g') ~ '(^|[^0-9])(\+?91|0)?[6-9][0-9]{9}([^0-9]|$)'
      or p_text ~ '[0-9]{10,}'
      or p_text ~* '(https?://|www\.|\m[a-z0-9-]+\.(com|in|net|org|io|me|co|app|link|ly)\M)';
$$;
revoke all on function private.question_has_contact(text) from public, anon, authenticated;

-- Signed in, and not a deleted account. Named like assert_feedback_member (137) so T7 sees the check.
create or replace function private.assert_question_member()
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
revoke all on function private.assert_question_member() from public, anon, authenticated;

-- Only a first name is shown, as on the feedback board.
create or replace function private.question_first_name(p_name text)
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
revoke all on function private.question_first_name(text) from public, anon, authenticated;

-- ------------------------------------------------------------- reading ------

-- The questions on one task, oldest first. The poster always sees them; anyone
-- else only while the task is open to offers or when they are working on it,
-- and never across a block (117) or on a task moderators hid.
create or replace function public.task_questions_list(p_task uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me   uuid := private.assert_question_member();
  v_task public.tasks;
begin
  select * into v_task from public.tasks where id = p_task;
  if not found then return '[]'::jsonb; end if;
  if v_task.poster_id <> v_me then
    if private.blocked_between(v_me, v_task.poster_id) or private.task_is_hidden(p_task) then
      return '[]'::jsonb;
    end if;
    if v_task.status <> 'OPEN' and not private.user_assigned_task(p_task, v_me) then
      return '[]'::jsonb;
    end if;
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'id', q.id,
             'body', q.body,
             'answer', q.answer,
             'answeredAt', q.answered_at,
             'asker', private.question_first_name(pr.display_name),
             'mine', q.asker_id is not distinct from v_me,
             'createdAt', q.created_at
           ) order by q.created_at)
      from (select * from public.task_questions
             where task_id = p_task and hidden_at is null
             order by created_at limit 100) q
      left join public.profiles pr on pr.id = q.asker_id
  ), '[]'::jsonb);
end;
$fn$;
revoke all on function public.task_questions_list(uuid) from public, anon;
grant execute on function public.task_questions_list(uuid) to authenticated;

-- ------------------------------------------------------------- writing ------

create or replace function public.task_question_ask(p_task uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me   uuid := private.assert_question_member();
  v_body text := btrim(regexp_replace(coalesce(p_body, ''), '\s+', ' ', 'g'));
  v_task public.tasks;
  v_row  public.task_questions;
begin
  if char_length(v_body) < 3 then raise exception 'Write your question first'; end if;
  if char_length(v_body) > 300 then raise exception 'Keep a question under 300 characters'; end if;
  if private.question_has_contact(v_body) then
    raise exception 'Leave phone numbers, emails and links out. Everyone can read questions, and contacts unlock when the work starts';
  end if;

  select * into v_task from public.tasks where id = p_task;
  if not found or private.task_is_hidden(p_task) then raise exception 'That task is no longer available'; end if;
  if v_task.poster_id = v_me then raise exception 'This is your own task. Add anything missing to the description instead'; end if;
  if v_task.status <> 'OPEN' then raise exception 'This task is no longer taking offers'; end if;
  if private.blocked_between(v_me, v_task.poster_id) then raise exception 'That task is no longer available'; end if;
  if (select count(*) from public.task_questions where task_id = p_task and asker_id = v_me) >= 3 then
    raise exception 'That is three questions on this task. Send your offer and ask the rest in chat once you are picked';
  end if;
  if (select count(*) from public.task_questions where asker_id = v_me and created_at > now() - interval '24 hours') >= 20 then
    raise exception 'That is a lot of questions for one day. Try again tomorrow';
  end if;

  insert into public.task_questions (task_id, asker_id, body)
  values (p_task, v_me, v_body)
  returning * into v_row;

  -- Who did it and which task, like every other alert (128).
  perform private.notify(
    v_task.poster_id, 'question',
    format('%s asked about "%s"', private.question_first_name((select display_name from public.profiles where id = v_me)), left(v_task.title, 60)),
    left(v_body, 120), p_task
  );
  return jsonb_build_object(
    'id', v_row.id, 'body', v_row.body, 'answer', null, 'answeredAt', null, 'mine', true,
    'createdAt', v_row.created_at,
    'asker', private.question_first_name((select display_name from public.profiles where id = v_me))
  );
end;
$fn$;
revoke all on function public.task_question_ask(uuid, text) from public, anon;
grant execute on function public.task_question_ask(uuid, text) to authenticated;

-- The poster answers, once; answering again replaces the answer.
create or replace function public.task_question_answer(p_question uuid, p_answer text)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me     uuid := private.assert_question_member();
  v_answer text := btrim(regexp_replace(coalesce(p_answer, ''), '\s+', ' ', 'g'));
  v_q      public.task_questions;
  v_poster uuid;
  v_title  text;
begin
  if v_answer = '' then raise exception 'Write your answer first'; end if;
  if char_length(v_answer) > 500 then raise exception 'Keep an answer under 500 characters'; end if;
  if private.question_has_contact(v_answer) then
    raise exception 'Leave phone numbers, emails and links out. Answers are public, and contacts unlock when the work starts';
  end if;

  select * into v_q from public.task_questions where id = p_question and hidden_at is null for update;
  if not found then raise exception 'That question is no longer there'; end if;
  select poster_id, title into v_poster, v_title from public.tasks where id = v_q.task_id;
  if v_poster is distinct from v_me then raise exception 'Only the person who posted the task can answer' using errcode = '42501'; end if;

  update public.task_questions
     set answer = v_answer, answered_at = now()
   where id = p_question
  returning * into v_q;

  if v_q.asker_id is not null and v_q.asker_id <> v_me then
    perform private.notify(
      v_q.asker_id, 'question',
      format('%s answered your question on "%s"', private.question_first_name((select display_name from public.profiles where id = v_me)), left(v_title, 60)),
      left(v_answer, 120), v_q.task_id
    );
  end if;
  return jsonb_build_object('id', v_q.id, 'answer', v_q.answer, 'answeredAt', v_q.answered_at);
end;
$fn$;
revoke all on function public.task_question_answer(uuid, text) from public, anon;
grant execute on function public.task_question_answer(uuid, text) to authenticated;

-- Staff can hide a question that slipped through (it stays in the table for the record).
create or replace function public.admin_task_question_hide(p_question uuid, p_hide boolean)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.require_people_staff();
  update public.task_questions
     set hidden_at = case when p_hide then now() else null end,
         hidden_by = case when p_hide then auth.uid() else null end
   where id = p_question;
  if not found then raise exception 'That question does not exist'; end if;
  perform public.admin_log_event(case when p_hide then 'question.hide' else 'question.unhide' end, p_question::text, null);
end;
$fn$;
revoke all on function public.admin_task_question_hide(uuid, boolean) from public, anon;
grant execute on function public.admin_task_question_hide(uuid, boolean) to authenticated;

-- ---------------------------------------------------- account deletion ------

create or replace function private.task_questions_erase()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.deleted_at is null and new.deleted_at is not null then
    delete from public.task_questions where asker_id = new.id;
  end if;
  return null;
end;
$$;
revoke all on function private.task_questions_erase() from public, anon, authenticated;

drop trigger if exists task_questions_erase on public.profiles;
create trigger task_questions_erase
  after update of deleted_at on public.profiles
  for each row execute function private.task_questions_erase();

-- ------------------------------------------------------------ near you ------

-- Tasks finished today (India time) and helpers active in the last 3 minutes
-- (the app's "Active now", lib/presence.ts), within p_radius_km of a point.
-- Distance is the flat-earth estimate, close enough at a few kilometres.
create or replace function public.nearby_pulse(p_lat double precision, p_lng double precision, p_radius_km double precision default 5)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me     uuid := private.assert_question_member();
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
         and p.id <> v_me
         and p.deleted_at is null
         and p.onboarded_at is not null
         and p.skills <> '{}'
         and p.loc_lat between p_lat - v_dlat and p_lat + v_dlat
         and 111.32 * sqrt(power(p.loc_lat - p_lat, 2) + power((p.loc_lng - p_lng) * v_cos, 2)) <= v_radius
    )
  );
end;
$fn$;
revoke all on function public.nearby_pulse(double precision, double precision, double precision) from public, anon;
grant execute on function public.nearby_pulse(double precision, double precision, double precision) to authenticated;
