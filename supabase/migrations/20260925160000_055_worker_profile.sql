-- 055: a worker profile of its own.
--
-- One account, one sign-in and one @username, but two faces: what a poster
-- shows (profiles.bio -- who they are as a client) and what a worker shows
-- (worker_bio, plus skills, languages and ratings). Switching to Earn for
-- the first time asks for the worker side; worker_onboarded_at marks it done.

alter table public.profiles
  add column if not exists worker_bio text,
  add column if not exists worker_onboarded_at timestamptz;

-- Anyone who already works on TaskDrop keeps working: they have skills, or
-- have quoted, or have been hired. Their existing bio was written for that,
-- so it becomes the worker bio.
update public.profiles p
   set worker_onboarded_at = coalesce(p.worker_onboarded_at, p.onboarded_at, now()),
       worker_bio = coalesce(p.worker_bio, nullif(p.bio, ''))
 where p.worker_onboarded_at is null
   and (coalesce(array_length(p.skills, 1), 0) > 0
        or exists (select 1 from public.bids b where b.worker_id = p.id)
        or exists (select 1 from public.assignments a where a.worker_id = p.id));
