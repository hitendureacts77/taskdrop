-- 152: daily caps against abuse (security holes H43, H44, H47 from the 4-5 Nov bug and security hunt).
--
--   H43  Ad clicks were free, unlimited and unchecked, and clicks raise a promotion's rank.
--        Now: one counted click per viewer per promotion per day; the advertiser's own clicks (and the
--        job poster's) are never counted; impressions are capped per viewer per promotion per day, on top
--        of the 30-minute rule and the per-viewer daily ceiling that already existed (migration 076).
--        The ad_events table stays bounded: the caps above stop the growth, and the hourly housekeeping
--        job (Inngest, run_housekeeping) deletes free (cost 0) events older than `ad_events_keep_days`.
--        Events that carry a cost are money records and are kept.
--   H44  Nothing limited how many files, or how many bytes, one person could register in a day.
--        Now media_begin (where every upload is registered, for ImageKit pictures and for Supabase
--        Storage files) refuses past `media_uploads_day` uploads or `media_bytes_day` bytes in 24 hours.
--        A file's size is what ImageKit reported (bytes), else what Supabase Storage holds, else, for an
--        upload begun in the last 15 minutes that has no size yet, the most the app allows for that kind
--        (15 MB for a picture, 50 MB otherwise), so a burst of begun uploads cannot slip under the cap.
--   H47  Nothing limited how many jobs/services or private feedback notes one account could post a day.
--        Now a trigger on tasks and on feedback refuses past `post_cap_day` / `feedback_cap_day` in 24
--        hours, and the lower `post_cap_new_day` / `feedback_cap_new_day` while the account is still new
--        (the plan task 2.11 rule from migration 133: younger than `new_account_days` or fewer than
--        `new_account_tasks` finished jobs). A crew post (one task row per helper) counts once. The posts
--        the system makes (Repeat, tasks.repeated_from) are neither blocked nor counted, and so are the
--        seed script, the server and admin tools (only the app's own roles are limited, as in 133).
--        The public feedback board (feedback_board_post, 136/137) already allows five ideas a day to
--        everyone, which is tighter than these numbers, so it is left as it is.
--
-- Every number is a settings row, read with private.setting_num; the admin changes them in Settings.
-- Additive and repeatable: setting rows, an index, triggers created if missing, three functions
-- rewritten from their latest definitions (record_ad_impression 076, record_ad_click 045,
-- media_begin 109, run_housekeeping 104) with every earlier check kept.

insert into public.settings (key, value) values
  ('ad_click_viewer_promo_day',      '1'::jsonb),
  ('ad_impression_viewer_promo_day', '5'::jsonb),
  ('ad_impression_viewer_day',       '300'::jsonb),
  ('ad_events_keep_days',            '180'::jsonb),
  ('media_uploads_day',              '300'::jsonb),
  ('media_bytes_day',                '524288000'::jsonb),
  ('post_cap_day',                   '20'::jsonb),
  ('post_cap_new_day',               '5'::jsonb),
  ('feedback_cap_day',               '20'::jsonb),
  ('feedback_cap_new_day',           '5'::jsonb)
on conflict (key) do nothing;

-- ---- 1. ads (H43) -------------------------------------------------------------------------------

-- One counted click per viewer per promotion per day; never the advertiser's or the poster's own.
create or replace function public.record_ad_click(p_task_id uuid)
returns void
language plpgsql security definer
set search_path to 'public', 'pg_temp'
as $fn$
declare
  v_me    uuid := auth.uid();
  v_promo uuid;
  v_adv   uuid;
begin
  if v_me is null then return; end if;

  select p.id, p.user_id into v_promo, v_adv from public.task_promotions p
   where p.task_id = p_task_id and p.status = 'active'
     and p.starts_at <= now() and p.ends_at > now()
   limit 1;
  if v_promo is null then return; end if;

  -- The advertiser (and whoever posted the job) cannot lift their own promotion.
  if v_adv = v_me
     or exists (select 1 from public.tasks t where t.id = p_task_id and t.poster_id = v_me) then
    return;
  end if;

  -- Two taps at the same moment must not both pass the count below.
  perform pg_advisory_xact_lock(hashtextextended('ad-click:' || v_me::text || ':' || v_promo::text, 0));

  if (select count(*) from public.ad_events e
       where e.viewer_id = v_me and e.promotion_id = v_promo and e.kind = 'click'
         and e.created_at > now() - interval '1 day')
     >= private.setting_num('ad_click_viewer_promo_day', 1) then
    return; -- already counted for this viewer today
  end if;

  insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor)
  values (v_promo, p_task_id, v_me, 'click', 0);
end;
$fn$;
revoke all on function public.record_ad_click(uuid) from public, anon;
grant execute on function public.record_ad_click(uuid) to authenticated;

-- Migration 076's version, plus a cap per viewer per promotion per day and a settable daily ceiling.
create or replace function public.record_ad_impression(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me   uuid := auth.uid();
  v_row  record;
  v_cost bigint;
begin
  if v_me is null then
    return;
  end if;

  select * into v_row from public.ad_auction() a where a.task_id = p_task_id;
  if not found then
    return; -- not sponsored right now, or out of budget: nothing to bill
  end if;

  if exists (select 1 from public.task_promotions p
              where p.id = v_row.promotion_id and p.user_id = v_me) then
    return; -- an advertiser is never billed for their own views
  end if;

  perform pg_advisory_xact_lock(hashtextextended('ad-view:' || v_me::text || ':' || v_row.promotion_id::text, 0));

  if exists (select 1 from public.ad_events e
              where e.viewer_id = v_me and e.promotion_id = v_row.promotion_id
                and e.kind = 'impression' and e.created_at > now() - interval '30 minutes') then
    return; -- already counted for this viewer
  end if;

  if (select count(*) from public.ad_events e
       where e.viewer_id = v_me and e.promotion_id = v_row.promotion_id
         and e.kind = 'impression' and e.created_at > now() - interval '1 day')
     >= private.setting_num('ad_impression_viewer_promo_day', 5) then
    return; -- one viewer cannot drain one promotion's budget
  end if;

  if (select count(*) from public.ad_events e
       where e.viewer_id = v_me and e.kind = 'impression'
         and e.created_at > now() - interval '1 day') >= private.setting_num('ad_impression_viewer_day', 300) then
    return; -- one account cannot generate unlimited billable views
  end if;

  v_cost := greatest(
    round(v_row.charge_minor::numeric / private.setting_num('ad_cpm_divisor', 1000))::bigint,
    private.setting_num('ad_min_charge_minor', 1)::bigint
  );
  v_cost := least(v_cost, v_row.daily_budget_minor - v_row.spent_today_minor);
  if v_cost <= 0 then
    return;
  end if;

  insert into public.ad_events (promotion_id, task_id, viewer_id, kind, cost_minor)
  values (v_row.promotion_id, p_task_id, v_me, 'impression', v_cost);
end;
$$;
revoke all on function public.record_ad_impression(uuid) from public, anon;
grant execute on function public.record_ad_impression(uuid) to authenticated;

-- The hourly housekeeping (Inngest) also trims free ad events. Migration 104's version, one new step.
create or replace function public.run_housekeeping()
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $$
declare
  v_rate integer; v_pw integer; v_codes integer; v_sends integer; v_places integer; v_notes integer;
  v_live integer; v_ads integer;
begin
  perform private.assert_service_caller();

  delete from private.api_rate where window_start < now() - interval '1 hour';
  get diagnostics v_rate = row_count;

  delete from public.password_attempts where at < now() - interval '30 days';
  get diagnostics v_pw = row_count;

  delete from public.auth_codes where expires_at < now() - interval '1 day';
  get diagnostics v_codes = row_count;

  delete from public.auth_send_log where window_started_at < now() - interval '1 day';
  get diagnostics v_sends = row_count;

  delete from public.places_quota where window_started_at < now() - interval '1 day';
  get diagnostics v_places = row_count;

  delete from public.notifications where created_at < now() - interval '90 days';
  get diagnostics v_notes = row_count;

  delete from public.admin_live_events e
   using (select x.id from public.admin_live_events x
           where x.created_at < now() - interval '30 days'
           order by x.created_at
           limit 5000
           for update skip locked) old
   where e.id = old.id;
  get diagnostics v_live = row_count;

  -- Free ad events (clicks) past their keep time; events with a cost are money records and stay.
  delete from public.ad_events e
   using (select x.id from public.ad_events x
           where x.cost_minor = 0
             and x.created_at < now() - make_interval(days => greatest(private.setting_num('ad_events_keep_days', 180)::integer, 7))
           order by x.created_at
           limit 5000
           for update skip locked) old
   where e.id = old.id;
  get diagnostics v_ads = row_count;

  return jsonb_build_object(
    'api_rate', v_rate, 'password_attempts', v_pw, 'auth_codes', v_codes,
    'auth_send_log', v_sends, 'places_quota', v_places, 'notifications', v_notes,
    'admin_live_events', v_live, 'ad_events', v_ads);
end;
$$;
revoke all on function public.run_housekeeping() from public, anon, authenticated;
grant execute on function public.run_housekeeping() to service_role;

-- ---- 2. files (H44) -----------------------------------------------------------------------------

-- Migration 109's version, plus the daily count and byte caps for this person.
create or replace function public.media_begin(
  p_id       uuid,
  p_provider text,
  p_purpose  text,
  p_kind     text,
  p_mime     text,
  p_path     text
) returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_me    uuid := (select auth.uid());
  v_n     bigint;
  v_bytes numeric;
begin
  if v_me is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if p_provider = 'imagekit' then
    if p_kind <> 'image' or p_path !~ ('^/[a-z0-9_-]+/u/' || v_me::text || '/[A-Za-z0-9._-]+$') then
      raise exception 'Invalid upload' using errcode = '22023';
    end if;
  elsif p_provider = 'supabase' then
    if p_path not like v_me::text || '/%' or p_path like '%..%' then
      raise exception 'Invalid upload' using errcode = '22023';
    end if;
  else
    raise exception 'Invalid upload' using errcode = '22023';
  end if;

  -- A person with a hundred unfinished uploads is not taking photos.
  if p_provider = 'imagekit'
     and (select count(*) from public.media where owner = v_me and status = 'pending') >= 100 then
    raise exception 'Too many uploads in progress. Please try again in a little while.' using errcode = 'P0001';
  end if;

  -- Daily caps. A retried call for a path already registered is the same upload, not a new one.
  if not exists (select 1 from public.media where provider = p_provider and path = p_path) then
    perform pg_advisory_xact_lock(hashtextextended('media-day:' || v_me::text, 0));

    select count(*),
           coalesce(sum(coalesce(
             m.bytes,
             (select nullif(o.metadata ->> 'size', '')::numeric
                from storage.objects o where o.bucket_id = 'task-media' and o.name = m.path limit 1),
             case when m.created_at > now() - interval '15 minutes'
                  then (case m.kind when 'image' then 15 else 50 end) * 1048576
                  else 0 end)), 0)
      into v_n, v_bytes
      from public.media m
     where m.owner = v_me and m.created_at > now() - interval '1 day';

    if v_n >= private.setting_num('media_uploads_day', 300) then
      raise exception 'You have reached today''s upload limit. Please try again tomorrow.' using errcode = 'P0001';
    end if;
    if v_bytes + (case p_kind when 'image' then 15 else 50 end) * 1048576 > private.setting_num('media_bytes_day', 524288000) then
      raise exception 'You have uploaded a lot of files today. Please try again tomorrow.' using errcode = 'P0001';
    end if;
  end if;

  insert into public.media (id, owner, provider, path, purpose, kind, mime, status, attached_at)
  values (
    p_id, v_me, p_provider, p_path, p_purpose, p_kind, nullif(left(p_mime, 100), ''),
    case when p_provider = 'supabase' then 'attached' else 'pending' end,
    case when p_provider = 'supabase' then now() end
  )
  on conflict (provider, path) do update set updated_at = now()   -- a retried call with the same path
  returning id into p_id;
  return p_id;
end;
$$;
revoke all on function public.media_begin(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.media_begin(uuid, text, text, text, text, text) to authenticated;

create index if not exists media_owner_created_idx on public.media (owner, created_at desc);

-- ---- 3. posting (H47) ---------------------------------------------------------------------------

-- True while the account is "new" under the plan task 2.11 rule (migration 133), or has no profile yet.
create or replace function private.is_new_account(p_user uuid)
returns boolean
language sql stable
security definer
set search_path = ''
as $$
  select private.new_account_cap(p_user, 1) is not null
      or not exists (select 1 from public.profiles where id = p_user)
$$;
revoke all on function private.is_new_account(uuid) from public, anon, authenticated;

create index if not exists tasks_poster_created_idx on public.tasks (poster_id, created_at desc);

-- Jobs and services a person may post in 24 hours. A crew post (one row per helper) counts once.
create or replace function private.limit_daily_posts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap   bigint;
  v_n     bigint;
  v_slots bigint;
begin
  if not private.is_app_caller() then return new; end if;   -- the server, the seed and admin tools
  if new.repeated_from is not null then return new; end if; -- Repeat: posted by the system
  -- The second and later slots of a crew the same person is already posting. A crew has as many rows as
  -- it has slots and no more: reusing one crew id to post without end is refused.
  if new.crew_id is not null then
    select count(*) into v_slots from public.tasks t where t.crew_id = new.crew_id and t.poster_id = new.poster_id;
    if v_slots >= coalesce(new.crew_size, 1) then
      raise exception 'That crew is already full. Post a new job instead.' using errcode = 'P0001';
    elsif v_slots > 0 then
      return new;
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('post-day:' || new.poster_id::text, 0));

  v_cap := case when private.is_new_account(new.poster_id)
                then private.setting_int('post_cap_new_day', 5)
                else private.setting_int('post_cap_day', 20) end;
  select count(distinct coalesce(t.crew_id, t.id)) into v_n
    from public.tasks t
   where t.poster_id = new.poster_id
     and t.repeated_from is null
     and t.created_at > now() - interval '1 day';
  if v_n >= v_cap then
    raise exception 'You can post up to % jobs a day. Please come back tomorrow.', v_cap
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_daily_posts() from public, anon, authenticated;

drop trigger if exists limit_daily_posts on public.tasks;
create trigger limit_daily_posts
  before insert on public.tasks
  for each row execute function private.limit_daily_posts();

-- Private feedback notes ("Send feedback") a person may send in 24 hours.
create index if not exists feedback_user_created_idx on public.feedback (user_id, created_at desc);

create or replace function private.limit_daily_feedback()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cap bigint;
  v_n   bigint;
begin
  if not private.is_app_caller() then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended('feedback-day:' || new.user_id::text, 0));

  v_cap := case when private.is_new_account(new.user_id)
                then private.setting_int('feedback_cap_new_day', 5)
                else private.setting_int('feedback_cap_day', 20) end;
  select count(*) into v_n from public.feedback f
   where f.user_id = new.user_id and f.created_at > now() - interval '1 day';
  if v_n >= v_cap then
    raise exception 'You can send up to % feedback notes a day. Please come back tomorrow.', v_cap
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function private.limit_daily_feedback() from public, anon, authenticated;

drop trigger if exists limit_daily_feedback on public.feedback;
create trigger limit_daily_feedback
  before insert on public.feedback
  for each row execute function private.limit_daily_feedback();
