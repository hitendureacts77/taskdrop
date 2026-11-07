-- 158: City Hunt (design D19, owner-approved 2026-11-07).
--
-- A Hunt is a normal request with Hunt switched on in the posting options: many people look
-- at once ("Find Lantus pens in stock near Kondapur"), each sends a find (a photo taken now,
-- the place's name, a pin, a price), and the poster pays only the find they accept. The task's
-- own price is the reward. Nothing is taken when the Hunt is posted: nothing found, nothing paid.
--
--   tasks.hunt_window   '2h', 'today' (until 23:59 IST) or '3d', chosen by the poster
--   tasks.hunt_until    when the Hunt stops taking finds. Set here, from the database clock
--   tasks.hunt_needs    what a find must show: photo, place, pin, price (at least one)
--   public.hunt_finds   the finds. The finder reads their own rows; the poster reads them only
--                       through hunt_finds_for_task(), which hides the photo, the place, the pin,
--                       the price and the note until the poster accepts that find
--   public.hunt_lookers "I'm looking": who said they are looking, for the counts
--
-- Accepting a find (hunt_accept_find) runs, in one transaction, the money steps a normal job
-- takes, by calling the same functions: a bid at the reward is created for the finder,
-- lock_bid() chooses it and pays for it from the poster's wallet (service fee as usual, the
-- same "Not enough money in your wallet" refusal with the shortfall in DETAIL), start_task()
-- and mark_work_done() run as the finder (the find is their proof of work), and
-- confirm_release() pays the finder exactly as for any job (commission, clearing period,
-- cap_worker_net). So refunds, disputes, the platform ledger and the admin views see a normal
-- completed job.
--
-- Rules the server keeps: a Hunt is never combined with Flash Drop, Auto-hire, Crew, Repeat,
-- Regulars or Live answer; normal offers on a Hunt are refused; a finder is signed in, set up,
-- 18 or older and not the poster, sends at most 3 finds per Hunt and only while it runs; the
-- poster can still accept a find for 24 hours after the Hunt stops taking them. "Ended" is
-- worked out from these times when read: no new pg_cron job and no new automation.
--
-- Additive only: new nullable columns, two new tables, new functions and triggers. Two
-- notification triggers (on_bid_inserted, on_task_changed) are their migration-128 bodies with
-- one guard line added, so the accept step does not send "offered / picked / started / sent the
-- work / approved" to the two people; it sends its own Hunt wording instead. The guest task
-- card (guest_task_json) is its migration-154 body plus the three Hunt fields.

-- ---- columns -------------------------------------------------------------------------------------

alter table public.tasks
  add column if not exists hunt_until  timestamptz,
  add column if not exists hunt_window text,
  add column if not exists hunt_needs  text[];

alter table public.tasks drop constraint if exists tasks_hunt_window_valid;
alter table public.tasks
  add constraint tasks_hunt_window_valid check (hunt_window is null or hunt_window in ('2h', 'today', '3d'));

alter table public.tasks drop constraint if exists tasks_hunt_shape;
alter table public.tasks
  add constraint tasks_hunt_shape check (
    (hunt_window is null and hunt_until is null and hunt_needs is null)
    or (hunt_window is not null and hunt_until is not null and hunt_needs is not null
        and cardinality(hunt_needs) between 1 and 4
        and hunt_needs <@ array['photo', 'place', 'pin', 'price']::text[])
  );

create index if not exists tasks_hunt_until_idx on public.tasks (hunt_until) where hunt_until is not null;

comment on column public.tasks.hunt_window is 'City Hunt: how long it runs, as the poster chose it (2h, today, 3d).';
comment on column public.tasks.hunt_until is 'City Hunt: when it stops taking finds. Set by the database from hunt_window and its own clock.';
comment on column public.tasks.hunt_needs is 'City Hunt: what a find must show (photo, place, pin, price).';

-- The poster chooses these when posting; hunt_until is always set by the database.
grant insert (hunt_window, hunt_needs) on public.tasks to authenticated;

-- ---- the shape the server accepts ----------------------------------------------------------------

create or replace function private.shape_hunt()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_needs text[];
  v_until timestamptz;
begin
  if new.hunt_window is null then
    new.hunt_until := null;
    new.hunt_needs := null;
    return new;
  end if;

  if new.hunt_window not in ('2h', 'today', '3d') then
    raise exception 'Pick how long the Hunt runs: 2 hours, today or 3 days' using errcode = 'P0001';
  end if;
  if new.kind is distinct from 'request' then
    raise exception 'Only a request can be a Hunt' using errcode = 'P0001';
  end if;
  if new.flash_until is not null
     or new.assignment_mode::text = 'auto'
     or new.crew_id is not null
     or new.repeat_every is not null
     or new.preferred_worker_id is not null
     or coalesce(new.live_answer, false) then
    raise exception 'A Hunt cannot be combined with Flash Drop, Auto-hire, Crew, Repeat, Regulars or Live answer'
      using errcode = 'P0001';
  end if;

  select coalesce(array_agg(distinct n order by n), '{}'::text[]) into v_needs
    from unnest(coalesce(new.hunt_needs, '{}'::text[])) n;
  if cardinality(v_needs) = 0 or not (v_needs <@ array['photo', 'place', 'pin', 'price']::text[]) then
    raise exception 'Choose what a find must show: a photo, the place name, a pin or the price' using errcode = 'P0001';
  end if;
  if 'pin' = any (v_needs) and (new.loc_lat is null or new.loc_lng is null) then
    raise exception 'A pin on the map needs a task at a place' using errcode = 'P0001';
  end if;

  v_until := case new.hunt_window
    when '2h' then now() + interval '2 hours'
    when '3d' then now() + interval '3 days'
    else (((now() at time zone 'Asia/Kolkata')::date + time '23:59') at time zone 'Asia/Kolkata')
  end;
  -- "Today" posted in the last minutes of the day still gets a short window.
  v_until := greatest(v_until, now() + interval '15 minutes');

  new.hunt_needs := v_needs;
  new.hunt_until := v_until;
  -- The Hunt's deadline is its end, so every open-task list (signed in or guest) drops it then.
  new.due_at := v_until;
  return new;
end;
$$;
revoke all on function private.shape_hunt() from public, anon, authenticated;

drop trigger if exists tasks_shape_hunt on public.tasks;
create trigger tasks_shape_hunt
  before insert on public.tasks
  for each row execute function private.shape_hunt();

-- The reward and the time are what finders saw: a poster cannot change them afterwards. Only
-- direct edits by app users are refused; TaskDrop's own functions run as the owner.
create or replace function private.hunt_terms_fixed()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;
  if old.hunt_window is not null
     and (new.benchmark_minor is distinct from old.benchmark_minor
          or new.due_at is distinct from old.due_at
          or new.assignment_mode is distinct from old.assignment_mode
          or new.hunt_until is distinct from old.hunt_until
          or new.hunt_window is distinct from old.hunt_window
          or new.hunt_needs is distinct from old.hunt_needs) then
    raise exception 'A Hunt''s reward and time cannot be changed once it is posted' using errcode = 'P0001';
  end if;
  if old.hunt_window is null and new.hunt_window is not null then
    raise exception 'A task cannot become a Hunt after it is posted' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.hunt_terms_fixed() from public, anon, authenticated;

drop trigger if exists tasks_hunt_terms_fixed on public.tasks;
create trigger tasks_hunt_terms_fixed
  before update on public.tasks
  for each row execute function private.hunt_terms_fixed();

-- ---- the finds -------------------------------------------------------------------------------------

create table if not exists public.hunt_finds (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks (id) on delete cascade,
  finder_id      uuid not null references public.profiles (id) on delete cascade,
  photo_path     text check (photo_path is null or char_length(photo_path) between 3 and 300),
  place_name     text check (place_name is null or char_length(place_name) between 1 and 120),
  lat            double precision check (lat is null or lat between -90 and 90),
  lng            double precision check (lng is null or lng between -180 and 180),
  price_note     text check (price_note is null or char_length(price_note) between 1 and 60),
  note           text check (note is null or char_length(note) between 1 and 300),
  status         text not null default 'pending' check (status in ('pending', 'accepted', 'declined', 'closed')),
  decline_reason text check (decline_reason is null or decline_reason in ('not_it', 'gone', 'too_far', 'other')),
  asked_part     text check (asked_part is null or asked_part in ('photo', 'place', 'pin', 'price')),
  asked_at       timestamptz,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz,
  constraint hunt_finds_pin_pair check ((lat is null) = (lng is null))
);
create index if not exists hunt_finds_task_idx on public.hunt_finds (task_id, created_at);
create index if not exists hunt_finds_finder_idx on public.hunt_finds (finder_id, created_at);
-- One accepted find per Hunt, whatever happens.
create unique index if not exists hunt_finds_one_accepted on public.hunt_finds (task_id) where status = 'accepted';

comment on table public.hunt_finds is
  'City Hunt finds. The finder reads their own rows; the poster only through hunt_finds_for_task(), masked until accepted. Decline reasons and times are kept for the admin abuse signal.';

alter table public.hunt_finds enable row level security;

drop policy if exists hunt_finds_finder_read on public.hunt_finds;
create policy hunt_finds_finder_read on public.hunt_finds
  for select to authenticated
  using (finder_id = (select auth.uid()) or private.is_admin());

revoke all on public.hunt_finds from public, anon, authenticated;
grant select on public.hunt_finds to authenticated;

create table if not exists public.hunt_lookers (
  task_id    uuid not null references public.tasks (id) on delete cascade,
  user_id    uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (task_id, user_id)
);
create index if not exists hunt_lookers_user_idx on public.hunt_lookers (user_id);

alter table public.hunt_lookers enable row level security;

drop policy if exists hunt_lookers_own_read on public.hunt_lookers;
create policy hunt_lookers_own_read on public.hunt_lookers
  for select to authenticated
  using (user_id = (select auth.uid()) or private.is_admin());

revoke all on public.hunt_lookers from public, anon, authenticated;
grant select on public.hunt_lookers to authenticated;

-- ---- normal offers on a Hunt are refused --------------------------------------------------------
-- Except the one bid hunt_accept_find() makes for the accepted finder, at the reward, inside its
-- own transaction (the transaction-local setting taskdrop.hunt_accept names that find).

create or replace function private.hunt_refuse_bids()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_task  public.tasks;
  v_find  text := nullif(current_setting('taskdrop.hunt_accept', true), '');
begin
  select * into v_task from public.tasks where id = new.task_id;
  if not found or v_task.hunt_window is null then
    return new;
  end if;
  if v_find is not null and exists (
    select 1 from public.hunt_finds f
     where f.id::text = v_find
       and f.task_id = new.task_id
       and f.finder_id = new.worker_id
       and f.status = 'pending'
  ) and new.price_minor = v_task.benchmark_minor then
    return new;
  end if;
  raise exception 'This is a Hunt: send a find instead of an offer' using errcode = 'P0001';
end;
$$;
revoke all on function private.hunt_refuse_bids() from public, anon, authenticated;

drop trigger if exists bids_hunt_finds_only on public.bids;
create trigger bids_hunt_finds_only
  before insert on public.bids
  for each row execute function private.hunt_refuse_bids();

-- ---- the two notification triggers, quiet while a find is being accepted -----------------------
-- Migration 128's bodies, unchanged except for the first line of each. hunt_accept_find() sends
-- its own messages ("Your find was accepted ...").

create or replace function private.on_bid_inserted()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_task public.tasks;
begin
  if coalesce(current_setting('taskdrop.hunt_accept', true), '') <> '' then return new; end if;
  select * into v_task from public.tasks where id = new.task_id;
  if found then
    perform private.notify(
      v_task.poster_id, 'quote',
      private.who(new.worker_id, 'A worker') || ' offered ' || private.rupees(new.price_minor),
      'To do ' || private.label(v_task.title) || '. Open it to compare offers.',
      v_task.id);
  end if;
  return new;
exception when others then
  return new;
end;
$$;

create or replace function private.on_task_changed()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_worker uuid;
  v_task   text;
  v_cust   text;
begin
  if coalesce(current_setting('taskdrop.hunt_accept', true), '') <> '' then return new; end if;
  -- Set here, not in DECLARE: an error there would not be caught by the handler
  -- below, and wording must never block a task from changing state.
  v_task := private.label(new.title);
  v_cust := private.who(new.poster_id, 'The customer');

  if new.status = 'LOCKED' and old.status is distinct from 'LOCKED' then
    select b.worker_id into v_worker from public.bids b where b.id = new.locked_bid_id;
    perform private.notify(v_worker, 'picked', v_cust || ' picked you',
      'For ' || v_task || '. You can start once they have paid.', new.id);
  end if;

  if new.funded_at is not null and old.funded_at is null then
    perform private.notify(private.task_worker(new.id), 'funded', v_cust || ' has paid. You can start',
      v_task || ': your payment is held safely until the work is approved.', new.id);
  end if;

  if new.status is distinct from old.status then
    v_worker := private.task_worker(new.id);
    case new.status
      when 'TASK_STARTED' then
        perform private.notify(new.poster_id, 'started',
          private.who(v_worker, 'Your worker') || ' started your task',
          v_task || ' is now in progress.', new.id);
      when 'WORK_DONE' then
        perform private.notify(new.poster_id, 'submitted',
          private.who(v_worker, 'Your worker') || ' sent in the work',
          'For ' || v_task || '. Approve it to pay them, or ask for changes.', new.id);
      when 'REVISION_REQUESTED' then
        perform private.notify(v_worker, 'revision', v_cust || ' asked for changes',
          'On ' || v_task || '. Open it to see what to fix, then send it again.', new.id);
      when 'COMPLETED', 'AUTO_COMPLETED' then
        if new.status = 'AUTO_COMPLETED' then
          perform private.notify(v_worker, 'released', 'Your work was approved',
            v_task || ': approved automatically. Your earnings will show in your wallet soon.', new.id);
        else
          perform private.notify(v_worker, 'released', v_cust || ' approved your work',
            v_task || ': your earnings will show in your wallet soon.', new.id);
        end if;
      when 'CANCELLED' then
        -- Whoever did not cancel it is the one who needs telling; both hear it,
        -- which is harmless for the person who pressed the button.
        perform private.notify(v_worker, 'cancelled', 'Task cancelled',
          v_task || ' was cancelled. You can offer on other tasks.', new.id);
        perform private.notify(new.poster_id, 'cancelled', 'Task cancelled',
          v_task || ' was cancelled.', new.id);
      when 'DISPUTED' then
        perform private.notify(v_worker, 'dispute', 'A problem was reported',
          'On ' || v_task || '. Our team is looking into it and will update you here.', new.id);
        perform private.notify(new.poster_id, 'dispute', 'A problem was reported',
          'On ' || v_task || '. Our team is looking into it and will update you here.', new.id);
      when 'OPEN' then
        if old.status in ('LOCKED', 'TASK_STARTED', 'OVERDUE') then
          perform private.notify(new.poster_id, 'reopened',
            private.who(v_worker, 'Your worker') || ' left your task',
            v_task || ' is open again, so new offers can come in.', new.id);
        end if;
      else
        null;
    end case;
  end if;
  return new;
exception when others then
  return new;
end;
$$;

-- ---- helpers -------------------------------------------------------------------------------------

-- Kilometres between two points, rounded to 0.1 km; null when either is missing.
create or replace function private.hunt_km(p_lat1 double precision, p_lng1 double precision,
                                           p_lat2 double precision, p_lng2 double precision)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case when p_lat1 is null or p_lng1 is null or p_lat2 is null or p_lng2 is null then null
    else round((6371 * 2 * asin(least(1, sqrt(
           power(sin(radians(p_lat2 - p_lat1) / 2), 2)
           + cos(radians(p_lat1)) * cos(radians(p_lat2)) * power(sin(radians(p_lng2 - p_lng1) / 2), 2)
         ))))::numeric, 1)
  end
$$;
revoke all on function private.hunt_km(double precision, double precision, double precision, double precision)
  from public, anon, authenticated;

-- The words for a part, for notifications and refusals.
create or replace function private.hunt_part_words(p_part text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_part
    when 'photo' then 'photo'
    when 'place' then 'shop or place name'
    when 'pin'   then 'pin on the map'
    when 'price' then 'price'
    else 'detail'
  end
$$;
revoke all on function private.hunt_part_words(text) from public, anon, authenticated;

-- Refuses anyone who may not look or send finds on this Hunt: signed in, set up, 18 or older,
-- not deleted, not the poster, not blocked by or blocking the poster.
create or replace function private.hunt_assert_finder(p_me uuid, p_task public.tasks)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if p_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.profiles p
                  where p.id = p_me and p.deleted_at is null and p.onboarded_at is not null) then
    raise exception 'Finish setting up your profile first' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.age_checks a where a.user_id = p_me and a.passed) then
    raise exception 'You must be 18 or older to take part in a Hunt' using errcode = 'P0001';
  end if;
  if p_task.poster_id = p_me then
    raise exception 'This is your own Hunt' using errcode = 'P0001';
  end if;
  if private.blocked_between(p_me, p_task.poster_id) then
    raise exception 'You cannot take part in this Hunt.' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function private.hunt_assert_finder(uuid, public.tasks) from public, anon, authenticated;

-- ---- "I'm looking" -------------------------------------------------------------------------------

create or replace function public.hunt_look(p_task uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me   uuid := auth.uid();
  v_task public.tasks;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  select * into v_task from public.tasks where id = p_task;
  if not found or v_task.hunt_window is null then
    raise exception 'That Hunt is no longer available' using errcode = 'P0001';
  end if;
  perform private.hunt_assert_finder(v_me, v_task);
  if v_task.status <> 'OPEN' or v_task.hunt_until <= now() then
    raise exception 'This Hunt has ended' using errcode = 'P0001';
  end if;

  insert into public.hunt_lookers (task_id, user_id) values (p_task, v_me)
  on conflict (task_id, user_id) do nothing;

  return jsonb_build_object(
    'taskId', p_task,
    'lookers', (select count(*) from public.hunt_lookers l where l.task_id = p_task),
    'finds', (select count(*) from public.hunt_finds f where f.task_id = p_task),
    'looking', true
  );
end;
$$;
revoke all on function public.hunt_look(uuid) from public, anon, authenticated;
grant execute on function public.hunt_look(uuid) to authenticated;

-- ---- counts for cards and the task page ----------------------------------------------------------
-- Only numbers: how many are looking, how many finds were sent, and the caller's own share.

create or replace function public.hunt_counts(p_tasks uuid[])
returns table (task_id uuid, lookers integer, finds integer, looking boolean, my_finds integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  return query
    select t.id,
           (select count(*)::integer from public.hunt_lookers l where l.task_id = t.id),
           (select count(*)::integer from public.hunt_finds f where f.task_id = t.id),
           exists (select 1 from public.hunt_lookers l where l.task_id = t.id and l.user_id = v_me),
           (select count(*)::integer from public.hunt_finds f where f.task_id = t.id and f.finder_id = v_me)
      from public.tasks t
     where t.id = any ((coalesce(p_tasks, '{}'::uuid[]))[1:100])
       and t.hunt_window is not null
       and (t.status = 'OPEN' or t.poster_id = v_me
            or exists (select 1 from public.hunt_finds f where f.task_id = t.id and f.finder_id = v_me));
end;
$$;
revoke all on function public.hunt_counts(uuid[]) from public, anon, authenticated;
grant execute on function public.hunt_counts(uuid[]) to authenticated;

-- ---- sending a find ------------------------------------------------------------------------------

create or replace function public.hunt_send_find(
  p_task       uuid,
  p_photo_path text,
  p_place_name text,
  p_lat        double precision,
  p_lng        double precision,
  p_price_note text,
  p_note       text
)
returns public.hunt_finds
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me    uuid := auth.uid();
  v_task  public.tasks;
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
  v_place text := left(nullif(btrim(coalesce(p_place_name, '')), ''), 120);
  v_price text := left(nullif(btrim(coalesce(p_price_note, '')), ''), 60);
  v_note  text := left(nullif(btrim(coalesce(p_note, '')), ''), 300);
  v_row   public.hunt_finds;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  -- Locked, so the count below and an accept running at the same moment cannot cross.
  select * into v_task from public.tasks where id = p_task for update;
  if not found or v_task.hunt_window is null then
    raise exception 'That Hunt is no longer available' using errcode = 'P0001';
  end if;
  perform private.hunt_assert_finder(v_me, v_task);
  if v_task.status <> 'OPEN' then
    raise exception 'This Hunt is closed' using errcode = 'P0001';
  end if;
  if v_task.hunt_until <= now() then
    raise exception 'This Hunt has ended, so it no longer takes finds' using errcode = 'P0001';
  end if;
  if (select count(*) from public.hunt_finds f where f.task_id = p_task and f.finder_id = v_me) >= 3 then
    raise exception 'You can send up to 3 finds on one Hunt' using errcode = 'P0001';
  end if;

  if (p_lat is null) <> (p_lng is null)
     or (p_lat is not null and (p_lat not between -90 and 90 or p_lng not between -180 and 180)) then
    raise exception 'That pin could not be used. Try again where you stand.' using errcode = 'P0001';
  end if;

  -- The photo must be the finder's own finished upload, in private storage.
  if v_photo is not null then
    if v_photo like 'media:%' then
      if not exists (select 1 from public.media m
                      where 'media:' || m.id::text = v_photo
                        and m.owner = v_me and m.status = 'attached' and m.kind = 'image' and m.purpose = 'proof') then
        raise exception 'That photo could not be used. Take it again.' using errcode = 'P0001';
      end if;
    elsif v_photo not like v_me::text || '/%' or position('..' in v_photo) > 0
          or not exists (select 1 from storage.objects o where o.bucket_id = 'task-media' and o.name = v_photo) then
      raise exception 'That photo could not be used. Take it again.' using errcode = 'P0001';
    end if;
  end if;

  if 'photo' = any (v_task.hunt_needs) and v_photo is null then
    raise exception 'This Hunt needs a photo taken now' using errcode = 'P0001';
  end if;
  if v_photo is null and v_place is null and p_lat is null and v_price is null then
    raise exception 'Add at least a photo, the place name, a pin or the price' using errcode = 'P0001';
  end if;

  insert into public.hunt_finds (task_id, finder_id, photo_path, place_name, lat, lng, price_note, note)
  values (p_task, v_me, v_photo, v_place, p_lat, p_lng, v_price, v_note)
  returning * into v_row;

  -- Sending a find counts as looking.
  insert into public.hunt_lookers (task_id, user_id) values (p_task, v_me)
  on conflict (task_id, user_id) do nothing;

  perform private.notify(v_task.poster_id, 'hunt_find', 'New find on your Hunt',
    'For ' || private.label(v_task.title) || '. Open it to check the find. You pay only if you accept it.',
    v_task.id);
  return v_row;
end;
$$;
revoke all on function public.hunt_send_find(uuid, text, text, double precision, double precision, text, text)
  from public, anon, authenticated;
grant execute on function public.hunt_send_find(uuid, text, text, double precision, double precision, text, text)
  to authenticated;

-- ---- reading the finds ---------------------------------------------------------------------------
-- The poster: every find on their Hunt, with who sent it, when, how far from the task's spot and
-- which proof it carries, but the photo, the place, the pin, the price and the note only for the
-- find they accepted. A finder: their own finds, in full. Anyone else: nothing.

create or replace function public.hunt_finds_for_task(p_task uuid)
returns table (
  id uuid, task_id uuid, finder_id uuid, finder_name text, finder_rating numeric, finder_rating_count integer,
  created_at timestamptz, status text, decided_at timestamptz, decline_reason text, asked_part text, asked_at timestamptz,
  distance_km numeric, has_photo boolean, has_place boolean, has_pin boolean, has_price boolean,
  mine boolean, unlocked boolean,
  photo_path text, place_name text, lat double precision, lng double precision, price_note text, note text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me     uuid := auth.uid();
  v_poster uuid;
  v_lat    double precision;
  v_lng    double precision;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  select t.poster_id, coalesce(tp.loc_lat, t.loc_lat), coalesce(tp.loc_lng, t.loc_lng)
    into v_poster, v_lat, v_lng
    from public.tasks t
    left join public.task_private tp on tp.task_id = t.id
   where t.id = p_task and t.hunt_window is not null;
  if v_poster is null then
    return;
  end if;

  return query
    select f.id, f.task_id, f.finder_id,
           p.display_name, p.worker_rating_avg::numeric, p.worker_rating_count::integer,
           f.created_at, f.status, f.decided_at, f.decline_reason, f.asked_part, f.asked_at,
           private.hunt_km(v_lat, v_lng, f.lat, f.lng),
           f.photo_path is not null, f.place_name is not null, f.lat is not null, f.price_note is not null,
           f.finder_id = v_me,
           (f.finder_id = v_me or f.status = 'accepted'),
           case when f.finder_id = v_me or f.status = 'accepted' then f.photo_path end,
           case when f.finder_id = v_me or f.status = 'accepted' then f.place_name end,
           case when f.finder_id = v_me or f.status = 'accepted' then f.lat end,
           case when f.finder_id = v_me or f.status = 'accepted' then f.lng end,
           case when f.finder_id = v_me or f.status = 'accepted' then f.price_note end,
           case when f.finder_id = v_me or f.status = 'accepted' then f.note end
      from public.hunt_finds f
      left join public.profiles p on p.id = f.finder_id
     where f.task_id = p_task
       and (v_poster = v_me or f.finder_id = v_me)
     order by f.created_at;
end;
$$;
revoke all on function public.hunt_finds_for_task(uuid) from public, anon, authenticated;
grant execute on function public.hunt_finds_for_task(uuid) to authenticated;

-- ---- accepting a find: the money moves exactly as for a normal job --------------------------------

create or replace function public.hunt_accept_find(p_find uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me       uuid := auth.uid();
  v_task_id  uuid;
  v_task     public.tasks;
  v_find     public.hunt_finds;
  v_bid      uuid;
  v_claims   text;
  v_sub      text;
  v_before   bigint;
  v_after    bigint;
  v_summary  text;
  v_other    record;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  select f.task_id into v_task_id from public.hunt_finds f where f.id = p_find;
  if v_task_id is null then
    raise exception 'That find is no longer available' using errcode = 'P0001';
  end if;

  -- Task first, then the find: the same order as sending, declining and asking.
  select * into v_task from public.tasks where id = v_task_id for update;
  select * into v_find from public.hunt_finds where id = p_find for update;

  if v_task.poster_id is distinct from v_me then
    raise exception 'Only the person who posted this Hunt can accept a find' using errcode = 'P0001';
  end if;
  if v_task.hunt_window is null then
    raise exception 'This task is not a Hunt' using errcode = 'P0001';
  end if;
  if v_task.status <> 'OPEN' then
    raise exception 'This Hunt is closed' using errcode = 'P0001';
  end if;
  if v_find.status <> 'pending' then
    raise exception 'That find was already answered' using errcode = 'P0001';
  end if;
  if now() > v_task.hunt_until + interval '24 hours' then
    raise exception 'This Hunt has ended' using errcode = 'P0001';
  end if;
  if private.blocked_between(v_me, v_find.finder_id) then
    raise exception 'You cannot accept this find.' using errcode = 'P0001';
  end if;

  -- Lets exactly this bid past bids_hunt_finds_only, and keeps the normal job notifications quiet.
  perform set_config('taskdrop.hunt_accept', p_find::text, true);

  -- 1. The finder's offer, at the reward the poster set.
  insert into public.bids (task_id, worker_id, price_minor, time_limit_minutes, message)
  values (v_task.id, v_find.finder_id, v_task.benchmark_minor,
          greatest(coalesce(v_task.time_limit_minutes, 60), 1), 'Hunt find')
  returning id into v_bid;

  -- 2. Chosen and paid for from the poster's wallet, as when a poster picks an offer. A wallet
  --    that is short raises 'Not enough money in your wallet' (shortfall in DETAIL) and the whole
  --    accept is undone: nothing is taken, the find stays pending.
  perform public.lock_bid(v_bid, 'one_time'::public.payout_mode);

  -- 3. The two steps a helper takes, run as the finder: start, then send the work. The find is the
  --    proof of work, so the poster, the finder, a dispute and the admin views all see it there.
  v_claims := current_setting('request.jwt.claims', true);
  v_sub := current_setting('request.jwt.claim.sub', true);
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_find.finder_id, 'role', 'authenticated')::text, true);
  perform set_config('request.jwt.claim.sub', v_find.finder_id::text, true);

  perform public.start_task(v_task.id);

  v_summary := 'Hunt find: ' || coalesce(v_find.place_name, 'see the photo')
    || coalesce(' · Price: ' || v_find.price_note, '')
    || case when v_find.lat is not null
            then ' · Pin: ' || round(v_find.lat::numeric, 5)::text || ', ' || round(v_find.lng::numeric, 5)::text
            else '' end
    || coalesce(' · ' || v_find.note, '');
  insert into public.task_proofs (task_id, worker_id, summary, files)
  values (v_task.id, v_find.finder_id, left(v_summary, 2000),
          case when v_find.photo_path is null then '[]'::jsonb
               else jsonb_build_array(jsonb_build_object('path', v_find.photo_path, 'kind', 'image', 'name', 'Find photo')) end);

  perform public.mark_work_done(v_task.id);

  perform set_config('request.jwt.claims', coalesce(v_claims, ''), true);
  perform set_config('request.jwt.claim.sub', coalesce(v_sub, ''), true);
  if auth.uid() is distinct from v_me then
    raise exception 'Something went wrong. Please try again.' using errcode = 'P0001';
  end if;

  -- 4. Approved and paid out by the poster, as confirm_release does for every job.
  insert into public.wallets (user_id) values (v_find.finder_id) on conflict (user_id) do nothing;
  select clearing_minor into v_before from public.wallets where user_id = v_find.finder_id;
  perform public.confirm_release(v_task.id);
  select clearing_minor into v_after from public.wallets where user_id = v_find.finder_id;

  -- 5. The find is the one; every other pending find on this Hunt is closed.
  update public.hunt_finds set status = 'accepted', decided_at = now() where id = p_find;
  for v_other in
    update public.hunt_finds set status = 'closed', decided_at = now()
     where task_id = v_task.id and status = 'pending'
    returning finder_id
  loop
    if v_other.finder_id is distinct from v_find.finder_id then
      perform private.notify(v_other.finder_id, 'hunt_closed', 'It was found. Thanks for looking.',
        private.label(v_task.title) || ' was found by someone else. The next Hunt could be yours.', v_task.id);
    end if;
  end loop;

  perform private.notify(v_find.finder_id, 'hunt_accepted',
    'Your find was accepted · ' || private.rupees(greatest(coalesce(v_after, 0) - coalesce(v_before, 0), 0)) || ' is on its way',
    private.label(v_task.title) || ': your earnings will show in your wallet soon.', v_task.id);

  perform set_config('taskdrop.hunt_accept', '', true);

  select * into v_task from public.tasks where id = v_task.id;
  return jsonb_build_object(
    'taskId', v_task.id,
    'findId', p_find,
    'status', v_task.status,
    'paidMinor', v_task.funded_minor
  );
end;
$$;
revoke all on function public.hunt_accept_find(uuid) from public, anon, authenticated;
grant execute on function public.hunt_accept_find(uuid) to authenticated;

-- ---- "Not it" ------------------------------------------------------------------------------------

create or replace function public.hunt_decline_find(p_find uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_task_id uuid;
  v_task    public.tasks;
  v_find    public.hunt_finds;
  v_words   text;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  if p_reason is null or p_reason not in ('not_it', 'gone', 'too_far', 'other') then
    raise exception 'Pick a reason' using errcode = 'P0001';
  end if;
  select f.task_id into v_task_id from public.hunt_finds f where f.id = p_find;
  if v_task_id is null then
    raise exception 'That find is no longer available' using errcode = 'P0001';
  end if;
  select * into v_task from public.tasks where id = v_task_id for update;
  select * into v_find from public.hunt_finds where id = p_find for update;
  if v_task.poster_id is distinct from v_me then
    raise exception 'Only the person who posted this Hunt can answer a find' using errcode = 'P0001';
  end if;
  if v_find.status <> 'pending' then
    raise exception 'That find was already answered' using errcode = 'P0001';
  end if;

  update public.hunt_finds
     set status = 'declined', decline_reason = p_reason, decided_at = now()
   where id = p_find;

  v_words := case p_reason
    when 'not_it'  then 'it was not what they asked for'
    when 'gone'    then 'it is out of stock or gone'
    when 'too_far' then 'it is too far'
    else 'it was not the one'
  end;
  perform private.notify(v_find.finder_id, 'hunt_declined', 'Your find was not picked',
    'For ' || private.label(v_task.title) || ': ' || v_words || '.'
      || case when v_task.status = 'OPEN' and v_task.hunt_until > now()
              then ' You can send another find while the Hunt is on.' else '' end,
    v_task.id);

  return jsonb_build_object('findId', p_find, 'status', 'declined');
end;
$$;
revoke all on function public.hunt_decline_find(uuid, text) from public, anon, authenticated;
grant execute on function public.hunt_decline_find(uuid, text) to authenticated;

-- ---- "Ask for the shop name" ---------------------------------------------------------------------
-- A notification to the finder; no new chat. One ask per find.

create or replace function public.hunt_ask_part(p_find uuid, p_part text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me      uuid := auth.uid();
  v_task_id uuid;
  v_task    public.tasks;
  v_find    public.hunt_finds;
  v_has     boolean;
begin
  if v_me is null then
    raise exception 'Not signed in' using errcode = 'P0001';
  end if;
  if p_part is null or p_part not in ('photo', 'place', 'pin', 'price') then
    raise exception 'Choose what to ask for' using errcode = 'P0001';
  end if;
  select f.task_id into v_task_id from public.hunt_finds f where f.id = p_find;
  if v_task_id is null then
    raise exception 'That find is no longer available' using errcode = 'P0001';
  end if;
  select * into v_task from public.tasks where id = v_task_id for update;
  select * into v_find from public.hunt_finds where id = p_find for update;
  if v_task.poster_id is distinct from v_me then
    raise exception 'Only the person who posted this Hunt can answer a find' using errcode = 'P0001';
  end if;
  if v_find.status <> 'pending' or v_task.status <> 'OPEN' then
    raise exception 'That find was already answered' using errcode = 'P0001';
  end if;
  if v_find.asked_part is not null then
    raise exception 'You already asked this finder' using errcode = 'P0001';
  end if;
  v_has := case p_part
    when 'photo' then v_find.photo_path is not null
    when 'place' then v_find.place_name is not null
    when 'pin'   then v_find.lat is not null
    else v_find.price_note is not null
  end;
  if v_has then
    raise exception 'That find already has it' using errcode = 'P0001';
  end if;

  update public.hunt_finds set asked_part = p_part, asked_at = now() where id = p_find;

  perform private.notify(v_find.finder_id, 'hunt_ask',
    'The customer asked for the ' || private.hunt_part_words(p_part),
    'On ' || private.label(v_task.title) || '. Send a new find with the ' || private.hunt_part_words(p_part)
      || ' while the Hunt is on.',
    v_task.id);

  return jsonb_build_object('findId', p_find, 'askedPart', p_part);
end;
$$;
revoke all on function public.hunt_ask_part(uuid, text) from public, anon, authenticated;
grant execute on function public.hunt_ask_part(uuid, text) to authenticated;

-- ---- guests: the Hunt fields on the public task card ---------------------------------------------
-- Migration 154's list plus hunt_until, hunt_window and hunt_needs (when and what, nothing about
-- any find). Guests never see finds: no guest operation reads them.

create or replace function private.guest_task_json(t public.tasks)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', t.id,
    'poster_id', t.poster_id,
    'kind', t.kind,
    'pillar', t.pillar,
    'category', t.category,
    'skills', t.skills,
    'difficulty', t.difficulty,
    'title', t.title,
    'description', t.description,
    'benchmark_minor', t.benchmark_minor,
    'time_limit_minutes', t.time_limit_minutes,
    'flag', t.flag,
    'status', t.status,
    'assignment_mode', t.assignment_mode,
    'due_at', t.due_at,
    'media_kind', t.media_kind,
    'media_path', t.media_path,
    'media_seconds', t.media_seconds,
    'loc_lat', round(t.loc_lat::numeric, 2)::float8,
    'loc_lng', round(t.loc_lng::numeric, 2)::float8,
    'loc_label', private.guest_area_label(t.loc_label),
    'milestones', t.milestones,
    'topup_pct', t.topup_pct,
    'flash_until', t.flash_until,
    'live_answer', t.live_answer,
    'crew_id', t.crew_id,
    'crew_size', t.crew_size,
    'crew_slot', t.crew_slot,
    'repeat_every', t.repeat_every,
    'want_photos', t.want_photos,
    'photos_public', t.photos_public,
    'created_at', t.created_at,
    'updated_at', t.updated_at,
    'hunt_until', t.hunt_until,
    'hunt_window', t.hunt_window,
    'hunt_needs', t.hunt_needs
  )
$$;
revoke all on function private.guest_task_json(public.tasks) from public, anon, authenticated;
