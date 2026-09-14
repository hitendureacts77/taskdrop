-- Where a task's photo or video actually lives.
--
-- The bucket is PRIVATE. Task media is a picture of someone's front door, their
-- broken tap, the inside of their flat -- paired with a pin on a map. A public
-- bucket would put all of that behind a guessable-by-enumeration URL with no
-- sign-in at all, so reads go through signed URLs instead.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'task-media',
  'task-media',
  false,
  52428800, -- 50 MB: a 60-second phone video, with headroom.
  array[
    'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif',
    'video/mp4', 'video/quicktime', 'video/webm'
  ]
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Paths are "<user id>/<random>.<ext>", so the first folder is the owner and
-- the policies can check it without a join.
drop policy if exists "task media: owner uploads" on storage.objects;
create policy "task media: owner uploads"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'task-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Anyone signed in can read: a worker deciding whether to quote needs to see
-- the photo, and open tasks are browsable by every worker on the platform.
-- Signed-out visitors get nothing.
drop policy if exists "task media: signed-in reads" on storage.objects;
create policy "task media: signed-in reads"
  on storage.objects for select to authenticated
  using (bucket_id = 'task-media');

drop policy if exists "task media: owner replaces" on storage.objects;
create policy "task media: owner replaces"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'task-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "task media: owner deletes" on storage.objects;
create policy "task media: owner deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'task-media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
