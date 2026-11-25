-- Photos and PDFs on feedback (migration 206): what may be attached, and who may open it.
--
-- One transaction, rolled back, so no rows are left behind.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/feedback_attachments.test.sql

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
  v_ann     uuid := gen_random_uuid();
  v_ben     uuid := gen_random_uuid();
  v_pdf     text;
  v_photo   text;
  v_big     text;
  v_txt     text;
  v_ben_pdf text;
  v_post_pdf text;
  v_ref     text;
  v_chat    text;
  v_bigref  text;
  v_photo_big text;
  v_pdf_mid text;
  v_post    jsonb;
  v_id      uuid;
  v_saved   jsonb;
  v_failed  boolean;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'fbfiles+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_ann), (v_ben)) as u(id);
  insert into public.profiles (id, display_name) values (v_ann, 'Ann'), (v_ben, 'Ben')
  on conflict (id) do nothing;
  update public.profiles set display_name = case id when v_ann then 'Ann' else 'Ben' end where id in (v_ann, v_ben);
  insert into public.wallets (user_id) values (v_ann), (v_ben) on conflict (user_id) do nothing;

  v_pdf      := v_ann::text || '/fb-1.pdf';
  v_photo    := v_ann::text || '/fb-2.jpg';
  v_big      := v_ann::text || '/fb-3.pdf';
  v_txt      := v_ann::text || '/fb-4.txt';
  v_post_pdf := v_ann::text || '/fb-5.pdf';
  v_ben_pdf  := v_ben::text || '/fb-1.pdf';
  v_photo_big := v_ann::text || '/fb-6.jpg';
  v_pdf_mid  := v_ann::text || '/fb-7.pdf';
  insert into storage.objects (bucket_id, name, metadata) values
    ('task-media', v_pdf,      jsonb_build_object('size', 120000, 'mimetype', 'application/pdf')),
    ('task-media', v_photo,    jsonb_build_object('size', 800000, 'mimetype', 'image/jpeg')),
    ('task-media', v_big,      jsonb_build_object('size', 6 * 1048576, 'mimetype', 'application/pdf')),
    ('task-media', v_txt,      jsonb_build_object('size', 100, 'mimetype', 'text/plain')),
    ('task-media', v_post_pdf, jsonb_build_object('size', 50000, 'mimetype', 'application/pdf')),
    ('task-media', v_ben_pdf,  jsonb_build_object('size', 50000, 'mimetype', 'application/pdf')),
    -- Owner, 25 Nov: photos up to 1 MB (the app shrinks them first), PDFs up to 2 MB.
    ('task-media', v_photo_big, jsonb_build_object('size', 1500000, 'mimetype', 'image/jpeg')),
    ('task-media', v_pdf_mid,  jsonb_build_object('size', 1500000, 'mimetype', 'application/pdf'));

  v_id := gen_random_uuid();
  v_ref := 'media:' || v_id::text;
  insert into public.media (id, owner, provider, provider_file_id, path, purpose, kind, bytes, status, attached_at)
  values (v_id, v_ann, 'imagekit', 'fid1', '/td/u/' || v_ann::text || '/' || v_id::text || '.jpg', 'feedback', 'image', 900000, 'attached', now());
  v_id := gen_random_uuid();
  v_chat := 'media:' || v_id::text;
  insert into public.media (id, owner, provider, provider_file_id, path, purpose, kind, bytes, status, attached_at)
  values (v_id, v_ann, 'imagekit', 'fid2', '/td/u/' || v_ann::text || '/' || v_id::text || '.jpg', 'chat', 'image', 900000, 'attached', now());

  v_id := gen_random_uuid();
  v_bigref := 'media:' || v_id::text;
  insert into public.media (id, owner, provider, provider_file_id, path, purpose, kind, bytes, status, attached_at)
  values (v_id, v_ann, 'imagekit', 'fid3', '/td/u/' || v_ann::text || '/' || v_id::text || '.jpg', 'feedback', 'image', 1500000, 'attached', now());

  -- ---- the media registry takes the new purpose ------------------------------
  begin
    insert into public.media (owner, provider, path, purpose, kind, status)
    values (v_ann, 'supabase', v_ann::text || '/x.bin', 'nonsense', 'file', 'attached');
    raise exception 'FAIL: an unknown media purpose was accepted';
  exception when check_violation then null;
  end;

  -- ---- "Send feedback" (private) ---------------------------------------------
  perform pg_temp.become(v_ann);
  insert into public.feedback (user_id, kind, body, page, attachments)
  values (v_ann, 'broken', 'The map froze', 'home',
          jsonb_build_array(
            jsonb_build_object('path', v_pdf, 'kind', 'file', 'name', 'receipt.pdf'),
            jsonb_build_object('path', v_photo, 'kind', 'image', 'name', E'shot\n.jpg', 'extra', 'dropped'),
            jsonb_build_object('path', upper(v_ref), 'kind', 'image')));
  perform pg_temp.as_operator();
  select attachments into v_saved from public.feedback where user_id = v_ann order by created_at desc limit 1;
  if jsonb_array_length(v_saved) <> 3
     or v_saved -> 0 ->> 'name' <> 'receipt.pdf'
     or v_saved -> 1 ->> 'name' <> 'shot.jpg'
     or v_saved -> 1 ? 'extra'
     or v_saved -> 2 ->> 'path' <> v_ref
     or v_saved -> 2 ->> 'name' <> 'Photo' then
    raise exception 'FAIL: feedback files were not saved as { path, kind, name }: %', v_saved;
  end if;

  -- Refused: four files, someone else's file, too big, a text file, a PDF called a photo,
  -- a picture uploaded for something else, a file that is not there.
  perform pg_temp.become(v_ann);
  foreach v_saved in array array[
    jsonb_build_array(jsonb_build_object('path', v_pdf, 'kind', 'file'), jsonb_build_object('path', v_photo, 'kind', 'image'),
                      jsonb_build_object('path', v_ref, 'kind', 'image'), jsonb_build_object('path', v_post_pdf, 'kind', 'file')),
    jsonb_build_array(jsonb_build_object('path', v_ben_pdf, 'kind', 'file')),
    jsonb_build_array(jsonb_build_object('path', v_big, 'kind', 'file')),
    jsonb_build_array(jsonb_build_object('path', v_txt, 'kind', 'file')),
    jsonb_build_array(jsonb_build_object('path', v_pdf, 'kind', 'image')),
    jsonb_build_array(jsonb_build_object('path', v_chat, 'kind', 'image')),
    jsonb_build_array(jsonb_build_object('path', v_ann::text || '/nothing.pdf', 'kind', 'file')),
    jsonb_build_array(jsonb_build_object('path', v_pdf, 'kind', 'file'), jsonb_build_object('path', v_pdf, 'kind', 'file')),
    jsonb_build_array(jsonb_build_object('path', v_photo_big, 'kind', 'image')),
    jsonb_build_array(jsonb_build_object('path', v_bigref, 'kind', 'image')),
    '{"path": "x"}'::jsonb
  ] loop
    v_failed := false;
    begin
      insert into public.feedback (user_id, kind, body, attachments) values (v_ann, 'idea', 'With a file', v_saved);
    exception when others then v_failed := true;
    end;
    if not v_failed then raise exception 'FAIL: these feedback files were accepted: %', v_saved; end if;
  end loop;

  -- A PDF between 1 and 2 MB is fine (photos are held to 1 MB, PDFs to 2 MB).
  insert into public.feedback (user_id, kind, body, attachments)
  values (v_ann, 'idea', 'With a longer PDF', jsonb_build_array(jsonb_build_object('path', v_pdf_mid, 'kind', 'file')));

  -- Ben cannot open Ann's private files. Only plain paths are checked for a "no": psql connects as
  -- postgres, and private.is_admin() is true for that session, which opens every media: ref (171).
  perform pg_temp.as_operator();
  if private.can_read_task_media(v_pdf, v_ben) or private.can_read_task_media(v_photo, v_ben) then
    raise exception 'FAIL: another person can open a private feedback file';
  end if;
  if not private.can_read_task_media(v_ref, v_ann) then
    raise exception 'FAIL: the sender cannot open their own feedback picture';
  end if;

  -- ---- the board -----------------------------------------------------------------
  perform pg_temp.become(v_ann);
  v_post := public.feedback_board_post('Show receipts in the app', 'Like this one', 'feature',
              jsonb_build_array(jsonb_build_object('path', v_post_pdf, 'kind', 'file', 'name', 'receipt.pdf'),
                                jsonb_build_object('path', v_ref, 'kind', 'image', 'name', 'screen.jpg')));
  if jsonb_array_length(v_post -> 'attachments') <> 2 then
    raise exception 'FAIL: the posted idea does not list its files: %', v_post;
  end if;
  v_id := (v_post ->> 'id')::uuid;

  -- A name with a phone number in it is refused like the title would be.
  v_failed := false;
  begin
    perform public.feedback_board_post('Another idea here', '', 'feature',
              jsonb_build_array(jsonb_build_object('path', v_pdf, 'kind', 'file', 'name', 'call 9876543210.pdf')));
  exception when others then v_failed := true;
  end;
  if not v_failed then raise exception 'FAIL: a file name with a phone number went on the board'; end if;

  -- The older three-argument form still posts.
  v_post := public.feedback_board_post('Old app idea', '', 'other');
  if jsonb_array_length(v_post -> 'attachments') <> 0 then
    raise exception 'FAIL: the three-argument post should have no files';
  end if;

  perform pg_temp.become(v_ben);
  v_post := public.feedback_board_get(v_id);
  if jsonb_array_length(v_post -> 'post' -> 'attachments') <> 2 then
    raise exception 'FAIL: a signed-in reader does not see the files: %', v_post;
  end if;

  perform pg_temp.as_operator();
  if not private.can_read_task_media(v_post_pdf, v_ben) or not private.can_read_task_media(v_ref, v_ben) then
    raise exception 'FAIL: a signed-in reader cannot open the files on a board idea';
  end if;
  if private.can_read_task_media(v_post_pdf, null) then
    raise exception 'FAIL: a signed-out visitor can open the files on a board idea';
  end if;
  if (public.guest_feedback_board_get(v_id) -> 'post' -> 'attachments') <> '[]'::jsonb then
    raise exception 'FAIL: guests are shown the file list';
  end if;

  -- Hidden by the team: closed again.
  update public.feedback_posts set hidden_at = now() where id = v_id;
  if private.can_read_task_media(v_post_pdf, v_ben) then
    raise exception 'FAIL: the files on a hidden idea can still be opened';
  end if;

  -- Nobody changes the files after posting.
  if has_column_privilege('authenticated', 'public.feedback', 'attachments', 'UPDATE')
     or has_table_privilege('authenticated', 'public.feedback_posts', 'UPDATE') then
    raise exception 'FAIL: attachments can be changed after sending';
  end if;
end;
$$;

rollback;
