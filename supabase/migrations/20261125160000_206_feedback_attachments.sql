-- 206 -- Photos and PDFs on feedback (plan 1.19 row L, owner 25 Nov: "add an image or file option within feedback").
--
-- Both feedback doors take up to three attachments, each a photo (JPEG, PNG, WebP, HEIC) or a PDF of
-- at most 5 MB:
--   * "Send feedback" (public.feedback, 048): private. Only the person who sent it and the team see
--     the files. The sender already reads their own files (their folder / their media row) and staff
--     read them in the admin site with the service key, so no new read rule is needed for these.
--   * The Ideas & feedback board (public.feedback_posts, 136): public to signed-in people, like the
--     post itself. can_read_task_media gains one branch per kind of reference: a file named on a
--     post that is not hidden, and that belongs to the post's author (the same owner rule as 171).
--     Guests (signed out) do not get the list at all: feedback_post_json leaves it out for them.
--
-- Files are uploaded first, through the api's createUpload, as for every other file: pictures go to
-- ImageKit in production (it strips location data when it serves them) and to the task-media bucket
-- on staging; PDFs go to the bucket. The new media purpose 'feedback' records what they are for.
-- What gets saved is checked here, never only in the app: private.feedback_clean_attachments
-- accepts only the caller's own files, only finished uploads, only the allowed types and sizes, and
-- rewrites each item to { path, kind, name }.
--
-- Same rules as the migrations before it: only adds. The media purpose check is widened (dropped and
-- added again with one more value); nothing else is dropped or renamed. feedback_board_post keeps its
-- three-argument form for older apps; a four-argument form takes the files.

-- ------------------------------------------------------ media purpose ------

do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.media'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%purpose%'
  loop
    execute format('alter table public.media drop constraint %I', c);
  end loop;
end
$$;
alter table public.media
  add constraint media_purpose_check check (purpose in ('task', 'avatar', 'proof', 'chat', 'feedback'));

-- ------------------------------------------------------------ columns ------

alter table public.feedback
  add column if not exists attachments jsonb not null default '[]'::jsonb;
alter table public.feedback_posts
  add column if not exists attachments jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'feedback_attachments_shape') then
    alter table public.feedback add constraint feedback_attachments_shape
      check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 3);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'feedback_posts_attachments_shape') then
    alter table public.feedback_posts add constraint feedback_posts_attachments_shape
      check (jsonb_typeof(attachments) = 'array' and jsonb_array_length(attachments) <= 3);
  end if;
end
$$;

comment on column public.feedback.attachments is
  'Up to 3 files ({path, kind image|file, name}) the sender attached (206). Checked by private.feedback_clean_attachments on insert.';
comment on column public.feedback_posts.attachments is
  'Up to 3 files ({path, kind image|file, name}) on a board idea (206). Set only by feedback_board_post.';

-- The app's insert into public.feedback runs as the caller (073 grants the columns it may set).
grant insert (attachments) on public.feedback to authenticated;

-- can_read_task_media asks "is this file named on a visible board post?"
create index if not exists feedback_posts_attachments_idx
  on public.feedback_posts using gin (attachments jsonb_path_ops)
  where attachments <> '[]'::jsonb;

-- ------------------------------------------------------------ checking ------

-- The files a person may attach, as they will be stored. Raises a plain-language error otherwise.
create or replace function private.feedback_clean_attachments(p_files jsonb, p_owner uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_max   constant bigint := 5 * 1048576;
  v_out   jsonb := '[]'::jsonb;
  v_item  jsonb;
  v_path  text;
  v_kind  text;
  v_name  text;
  v_mime  text;
  v_bytes bigint;
begin
  if p_files is null or jsonb_typeof(p_files) = 'null' then return '[]'::jsonb; end if;
  if jsonb_typeof(p_files) <> 'array' then
    raise exception 'Those attachments could not be read' using errcode = '22023';
  end if;
  if jsonb_array_length(p_files) > 3 then
    raise exception 'You can attach up to 3 files' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_files) > 0 and p_owner is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;

  for v_item in select value from jsonb_array_elements(p_files) loop
    if jsonb_typeof(v_item) <> 'object' then
      raise exception 'Those attachments could not be read' using errcode = '22023';
    end if;
    v_path := v_item ->> 'path';
    v_kind := v_item ->> 'kind';
    v_name := left(btrim(regexp_replace(coalesce(v_item ->> 'name', ''), '[[:cntrl:]]', '', 'g')), 80);
    if v_path is null or char_length(v_path) > 300 or v_kind is null or v_kind not in ('image', 'file') then
      raise exception 'Those attachments could not be read' using errcode = '22023';
    end if;

    if v_path ~* '^media:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      -- A picture in ImageKit: the caller's own, finished, uploaded for feedback.
      v_path := lower(v_path);
      if v_kind <> 'image' then
        raise exception 'Those attachments could not be read' using errcode = '22023';
      end if;
      select m.bytes into v_bytes
        from public.media m
       where m.id = substring(v_path from 7)::uuid
         and m.owner = p_owner
         and m.provider = 'imagekit'
         and m.kind = 'image'
         and m.purpose = 'feedback'
         and m.status = 'attached';
      if not found then
        raise exception 'One of the files is still uploading or was removed. Please attach it again' using errcode = 'P0001';
      end if;
      if coalesce(v_bytes, 0) > v_max then
        raise exception 'Each file can be up to 5 MB' using errcode = 'P0001';
      end if;
    else
      -- A file in the bucket: in the caller's own folder, really there, and small enough.
      if v_path not like p_owner::text || '/%' or position('..' in v_path) > 0 then
        raise exception 'Those attachments could not be read' using errcode = '22023';
      end if;
      select (o.metadata ->> 'size')::bigint, lower(o.metadata ->> 'mimetype')
        into v_bytes, v_mime
        from storage.objects o
       where o.bucket_id = 'task-media' and o.name = v_path;
      if not found then
        raise exception 'One of the files is still uploading or was removed. Please attach it again' using errcode = 'P0001';
      end if;
      if v_bytes is null or v_bytes > v_max then
        raise exception 'Each file can be up to 5 MB' using errcode = 'P0001';
      end if;
      if (v_kind = 'file' and v_mime is distinct from 'application/pdf')
         or (v_kind = 'image' and (v_mime is null or v_mime not in ('image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'))) then
        raise exception 'Only photos and PDF files can be attached' using errcode = 'P0001';
      end if;
    end if;

    if v_out @> jsonb_build_array(jsonb_build_object('path', v_path)) then
      raise exception 'That file is attached twice' using errcode = 'P0001';
    end if;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'path', v_path,
      'kind', v_kind,
      'name', coalesce(nullif(v_name, ''), case v_kind when 'image' then 'Photo' else 'PDF' end)
    ));
  end loop;
  return v_out;
end;
$$;
revoke all on function private.feedback_clean_attachments(jsonb, uuid) from public, anon, authenticated;

-- "Send feedback": whatever inserts the row, the files are checked and tidied first.
create or replace function private.feedback_check_attachments()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.attachments := private.feedback_clean_attachments(new.attachments, new.user_id);
  return new;
end;
$$;
revoke all on function private.feedback_check_attachments() from public, anon, authenticated;

drop trigger if exists feedback_check_attachments on public.feedback;
create trigger feedback_check_attachments
  before insert on public.feedback
  for each row execute function private.feedback_check_attachments();

-- ------------------------------------------------------- the board ------

-- One post as the app sees it (136), now with its files for signed-in people.
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
    'statusChangedAt', p_post.status_changed_at,
    'attachments', case when p_me is null then '[]'::jsonb else coalesce(p_post.attachments, '[]'::jsonb) end
  );
$$;
revoke all on function private.feedback_post_json(public.feedback_posts, uuid) from public, anon, authenticated;

-- The older three-argument form, for apps that do not send files: the four-argument form below with
-- no files. Written first (and in plpgsql, so it may name a function made a few lines later) so the
-- newest definition of feedback_board_post in the migrations is the one that holds every refusal
-- (scripts/check-lost-refusals.mjs).
create or replace function public.feedback_board_post(p_title text, p_body text, p_category text default 'feature')
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  return public.feedback_board_post(p_title, p_body, p_category, '[]'::jsonb);
end;
$fn$;
revoke all on function public.feedback_board_post(text, text, text) from public, anon;
grant execute on function public.feedback_board_post(text, text, text) to authenticated;

-- Posting with files. The same checks as 137, plus the files.
create or replace function public.feedback_board_post(p_title text, p_body text, p_category text, p_attachments jsonb)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := private.assert_feedback_member();
  v_title text := btrim(coalesce(p_title, ''));
  v_body  text := btrim(coalesce(p_body, ''));
  v_files jsonb;
  v_post  public.feedback_posts;
begin
  if char_length(v_title) < 3 then raise exception 'Give your idea a short title first'; end if;
  if char_length(v_title) > 120 then raise exception 'Keep the title under 120 characters'; end if;
  if char_length(v_body) > 2000 then raise exception 'Keep the details under 2000 characters'; end if;
  if p_category is null or p_category not in ('feature', 'improvement', 'bug', 'other') then raise exception 'Pick what kind of idea this is'; end if;
  v_files := private.feedback_clean_attachments(p_attachments, v_me);
  if private.feedback_has_contact(v_title || ' ' || v_body || ' '
       || coalesce((select string_agg(f ->> 'name', ' ') from jsonb_array_elements(v_files) f), '')) then
    raise exception 'Leave phone numbers and email addresses out. Everyone can read the board. Use Help & support for anything private';
  end if;
  if (select count(*) from public.feedback_posts where author_id = v_me and created_at > now() - interval '24 hours') >= 5 then
    raise exception 'That is five ideas today. Come back tomorrow, or vote for ideas already on the board';
  end if;
  if exists (select 1 from public.feedback_posts
              where author_id = v_me and lower(title) = lower(v_title) and created_at > now() - interval '7 days') then
    raise exception 'You already posted that one';
  end if;

  insert into public.feedback_posts (author_id, title, body, category, attachments)
  values (v_me, v_title, v_body, p_category, v_files)
  returning * into v_post;
  -- Whoever suggests an idea wants it, so it starts with their vote.
  insert into public.feedback_votes (post_id, user_id) values (v_post.id, v_me);
  select * into v_post from public.feedback_posts where id = v_post.id;

  perform private.notify_staff('people', 'New idea on the feedback board', left(v_title, 120), v_me);
  return private.feedback_post_json(v_post, v_me);
end;
$fn$;
revoke all on function public.feedback_board_post(text, text, text, jsonb) from public, anon;
grant execute on function public.feedback_board_post(text, text, text, jsonb) to authenticated;

-- ------------------------------------------------------- who may open a file --

-- 171's rule, plus: a file named on a board post that is not hidden, owned by that post's author.
create or replace function private.can_read_task_media(p_name text, p_uid uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when p_name like 'media:%' then
      exists (
        select 1 from public.media m
         where 'media:' || m.id::text = p_name
           and (
             (m.owner = p_uid and m.status in ('pending', 'attached'))
             or (m.status <> 'deleted' and private.is_admin())
             or (
               m.status = 'attached'
               and (
                 exists (select 1 from public.profiles p where p.avatar_url = p_name and p.id = m.owner)
                 or exists (
                   select 1 from public.tasks t
                    where t.media_path = p_name
                      and t.poster_id = m.owner
                      and ( t.status = 'OPEN'
                            or t.poster_id = p_uid
                            or private.user_bid_on_task(t.id, p_uid)
                            or private.user_assigned_task(t.id, p_uid) )
                 )
                 or exists (
                   select 1 from public.task_proofs tp
                     join public.tasks t on t.id = tp.task_id
                    where tp.files @> jsonb_build_array(jsonb_build_object('path', p_name))
                      and tp.worker_id = m.owner
                      and ( tp.worker_id = p_uid or t.poster_id = p_uid )
                 )
                 or exists (
                   select 1 from public.task_proofs tp
                     join public.tasks t on t.id = tp.task_id
                     join public.profiles w on w.id = tp.worker_id and w.deleted_at is null
                    where t.photos_public and t.status in ('COMPLETED', 'AUTO_COMPLETED')
                      and tp.worker_id = m.owner
                      and not private.task_is_hidden(t.id)
                      and ( tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'before'))
                            or tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'after')) )
                 )
                 or exists (
                   select 1 from public.messages ms
                    where left(ms.body, 60) = left('::media::' || p_name, 60)
                      and ms.body = '::media::' || p_name
                      and ms.sender_id = m.owner
                      and private.can_use_task_thread(ms.task_id, p_uid)
                 )
                 or (
                   p_uid is not null
                   and exists (
                     select 1 from public.feedback_posts fp
                      where fp.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
                        and fp.author_id = m.owner
                        and fp.hidden_at is null
                   )
                 )
               )
             )
           )
      )
    else
      -- A plain path is only ever shared from its owner's own folder.
      position('..' in p_name) = 0
      and (
        exists (select 1 from public.profiles p
                 where p.avatar_url = p_name and p_name like p.id::text || '/%')
        or exists (
          select 1 from public.tasks t
           where t.media_path = p_name
             and p_name like t.poster_id::text || '/%'
             and ( t.status = 'OPEN'
                   or t.poster_id = p_uid
                   or private.is_admin()
                   or private.user_bid_on_task(t.id, p_uid)
                   or private.user_assigned_task(t.id, p_uid) )
        )
        or exists (
          select 1 from public.task_proofs tp
            join public.tasks t on t.id = tp.task_id
           where tp.files @> jsonb_build_array(jsonb_build_object('path', p_name))
             and p_name like tp.worker_id::text || '/%'
             and ( tp.worker_id = p_uid or t.poster_id = p_uid or private.is_admin() )
        )
        or exists (
          select 1 from public.task_proofs tp
            join public.tasks t on t.id = tp.task_id
            join public.profiles w on w.id = tp.worker_id and w.deleted_at is null
           where t.photos_public and t.status in ('COMPLETED', 'AUTO_COMPLETED')
             and p_name like tp.worker_id::text || '/%'
             and not private.task_is_hidden(t.id)
             and ( tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'before'))
                   or tp.files @> jsonb_build_array(jsonb_build_object('path', p_name, 'label', 'after')) )
        )
        or exists (
          select 1 from public.messages ms
           where left(ms.body, 60) = left('::media::' || p_name, 60)
             and ms.body = '::media::' || p_name
             and p_name like ms.sender_id::text || '/%'
             and private.can_use_task_thread(ms.task_id, p_uid)
        )
        or (
          p_uid is not null
          and exists (
            select 1 from public.feedback_posts fp
             where fp.attachments @> jsonb_build_array(jsonb_build_object('path', p_name))
               and p_name like fp.author_id::text || '/%'
               and fp.hidden_at is null
          )
        )
      )
  end;
$$;
revoke all on function private.can_read_task_media(text, uuid) from public, anon;
grant execute on function private.can_read_task_media(text, uuid) to authenticated;
