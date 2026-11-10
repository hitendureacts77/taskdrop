-- Undo of migration 161: removes the two guards and puts migration 135's version of
-- private.shape_poster_options() back. Run by hand only.
-- The unique index on (task_id, worker_id) is NOT dropped: the same rule has existed since migration 001.
-- Offers removed by the clean-up step in 161 (only if the rule was missing) cannot be brought back.

drop trigger if exists bids_keep_sent on public.bids;
drop trigger if exists bids_edit_while_open on public.bids;
drop function if exists private.bids_keep_sent();
drop function if exists private.bids_edit_while_open();

create or replace function private.shape_poster_options()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.crew_id is not null and exists (
    select 1 from public.tasks t where t.crew_id = new.crew_id and t.poster_id <> new.poster_id
  ) then
    raise exception 'That crew belongs to someone else' using errcode = 'P0001';
  end if;

  if new.flash_until is not null then
    if new.assignment_mode is distinct from 'auto' then
      raise exception 'Flash Drop hires the first helper who accepts, so it needs Auto-hire'
        using errcode = 'P0001';
    end if;
    new.flash_until := now() + interval '30 minutes';
    new.flag := 'urgent';
  end if;

  if new.live_answer then
    if new.crew_id is not null then
      raise exception 'A Live answer is for one person' using errcode = 'P0001';
    end if;
    new.pillar := 'local_intel';
  end if;

  if new.crew_id is not null and new.repeat_every is not null then
    raise exception 'A crew job cannot repeat yet. Post it again when you need it' using errcode = 'P0001';
  end if;

  if new.preferred_worker_id is not null then
    if new.preferred_worker_id = new.poster_id then
      new.preferred_worker_id := null;
    elsif not exists (
      select 1 from public.assignments a
        join public.tasks t on t.id = a.task_id
       where t.poster_id = new.poster_id and a.worker_id = new.preferred_worker_id
    ) then
      raise exception 'You can offer a task first only to someone you hired before' using errcode = 'P0001';
    end if;
  end if;
  new.preferred_until := case when new.preferred_worker_id is null then null else now() + interval '10 minutes' end;

  if not new.want_photos then
    new.photos_public := false;
  end if;
  return new;
end;
$$;
revoke all on function private.shape_poster_options() from public, anon, authenticated;
