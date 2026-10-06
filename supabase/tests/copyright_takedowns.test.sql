-- Copyright notices (migration 085): log -> take down -> counter -> restore.
--
-- Everything runs inside one transaction that is rolled back.
--
-- is_admin() is true for any psql/SQL-editor session (the operator rule, 040),
-- so it is narrowed to the real admin role for the length of this transaction,
-- exactly as column_lockdown.test.sql does.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/copyright_takedowns.test.sql

begin;

create or replace function private.is_admin() returns boolean
language sql stable security definer set search_path = 'public' as
$$ select coalesce(private.has_role(auth.uid(), 'admin'), false) $$;

create or replace function pg_temp.become(p_user uuid) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

create or replace function pg_temp.as_owner() returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
  perform set_config('role', 'postgres', true);
end;
$$;

create temp table fx (k text primary key, v text);
grant all on fx to public;

do $$
declare
  v_admin    uuid := gen_random_uuid();
  v_uploader uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_task     uuid;
  v_listing  uuid;
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password,
                          email_confirmed_at, created_at, updated_at)
  select u.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
         'dmca+' || u.id || '@taskdrop.test', '', now(), now(), now()
  from (values (v_admin), (v_uploader), (v_stranger)) as u(id);
  insert into public.profiles (id, display_name) values
    (v_admin, 'Admin'), (v_uploader, 'Uploader'), (v_stranger, 'Stranger')
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role) values (v_admin, 'admin') on conflict do nothing;
  update public.profiles set avatar_url = v_uploader || '/face.png' where id = v_uploader;

  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, media_path)
  values (v_uploader, 'services', 'DMCA fixture job', 100000, 240, v_uploader || '/copied.jpg')
  returning id into v_task;
  insert into public.tasks (poster_id, pillar, title, benchmark_minor, time_limit_minutes, kind)
  values (v_uploader, 'services', 'DMCA fixture listing', 100000, 240, 'service')
  returning id into v_listing;

  insert into fx values ('admin', v_admin::text), ('uploader', v_uploader::text), ('stranger', v_stranger::text),
                        ('task', v_task::text), ('listing', v_listing::text);
end;
$$;

-- ---- 1. nobody but an admin can log, act on, or read notices ---------------
do $$
declare
  v_stranger uuid := (select v::uuid from fx where k = 'stranger');
  v_task     uuid := (select v::uuid from fx where k = 'task');
  n integer;
begin
  perform pg_temp.become(v_stranger);
  begin
    perform public.admin_log_copyright_notice('X', 'x@example.com', 'my photo', 'that job', v_task);
    raise exception 'FAIL: a non-admin logged a notice';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  select count(*) into n from public.copyright_notices;
  if n > 0 then raise exception 'FAIL: a non-admin can read notices'; end if;
  if public.copyright_strikes(v_stranger) is not null then raise exception 'FAIL: a non-admin can read strikes'; end if;
  perform pg_temp.as_owner();
end;
$$;

-- ---- 2. log, take the media down, and the uploader is told -----------------
do $$
declare
  v_admin    uuid := (select v::uuid from fx where k = 'admin');
  v_uploader uuid := (select v::uuid from fx where k = 'uploader');
  v_stranger uuid := (select v::uuid from fx where k = 'stranger');
  v_task     uuid := (select v::uuid from fx where k = 'task');
  v_path     text := v_uploader || '/copied.jpg';
  v_notice   uuid;
begin
  if not private.can_read_task_media(v_path, v_stranger) then
    raise exception 'FAIL (fixture): an open job''s photo should be visible before takedown';
  end if;

  perform pg_temp.become(v_admin);
  v_notice := public.admin_log_copyright_notice('Rights Holder', 'rh@example.com', 'My photograph', 'The job photo', v_task);
  if (select uploader_id from public.copyright_notices where id = v_notice) <> v_uploader then
    raise exception 'FAIL: the uploader was not taken from the job';
  end if;
  perform public.admin_copyright_takedown(v_notice, 'media', 'Matches the original');
  if public.copyright_strikes(v_uploader) <> 1 then raise exception 'FAIL: the takedown did not count as a strike'; end if;
  perform pg_temp.as_owner();

  if (select media_path from public.tasks where id = v_task) is not null then
    raise exception 'FAIL: the job still shows the photo';
  end if;
  if (select removed_value from public.copyright_notices where id = v_notice) <> v_path then
    raise exception 'FAIL: the detached file was not remembered for a restore';
  end if;
  if private.can_read_task_media(v_path, v_stranger) then
    raise exception 'FAIL: a stranger can still read the removed photo';
  end if;
  if not exists (select 1 from public.notifications where user_id = v_uploader and title like 'We removed something%') then
    raise exception 'FAIL: the uploader was not told';
  end if;
  insert into fx values ('notice', v_notice::text);
end;
$$;

-- ---- 3. a counter-notice cannot restore early; on the day, it restores -----
do $$
declare
  v_admin    uuid := (select v::uuid from fx where k = 'admin');
  v_uploader uuid := (select v::uuid from fx where k = 'uploader');
  v_task     uuid := (select v::uuid from fx where k = 'task');
  v_notice   uuid := (select v::uuid from fx where k = 'notice');
  v_from     date;
begin
  perform pg_temp.become(v_admin);
  v_from := public.admin_copyright_counter(v_notice, 'Counter-notice received, forwarded to complainant');
  if v_from < current_date + 13 then raise exception 'FAIL: restore allowed after only % days', v_from - current_date; end if;
  begin
    perform public.admin_copyright_restore(v_notice);
    raise exception 'FAIL: restored before the waiting period';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform pg_temp.as_owner();

  update public.copyright_notices set restore_from = current_date - 1 where id = v_notice;

  perform pg_temp.become(v_admin);
  perform public.admin_copyright_restore(v_notice);
  if public.copyright_strikes(v_uploader) <> 0 then raise exception 'FAIL: a restored notice still counts as a strike'; end if;
  perform pg_temp.as_owner();

  if (select media_path from public.tasks where id = v_task) is distinct from v_uploader || '/copied.jpg' then
    raise exception 'FAIL: the photo did not come back';
  end if;
end;
$$;

-- ---- 4. an open listing can be closed; a rejection needs a reason ----------
do $$
declare
  v_admin   uuid := (select v::uuid from fx where k = 'admin');
  v_listing uuid := (select v::uuid from fx where k = 'listing');
  v_a uuid;
  v_b uuid;
begin
  perform pg_temp.become(v_admin);
  v_a := public.admin_log_copyright_notice('Rights Holder', 'rh@example.com', 'My text', 'The listing text', v_listing);
  perform public.admin_copyright_takedown(v_a, 'listing');
  v_b := public.admin_log_copyright_notice('Someone', 's@example.com', 'Unclear', 'Unclear', null);
  begin
    perform public.admin_copyright_reject(v_b, '  ');
    raise exception 'FAIL: rejected without a reason';
  exception when others then
    if sqlerrm like 'FAIL:%' then raise; end if;
  end;
  perform public.admin_copyright_reject(v_b, 'Not a copyright claim');
  perform pg_temp.as_owner();
  if (select status::text from public.tasks where id = v_listing) <> 'CANCELLED' then
    raise exception 'FAIL: the listing is still open';
  end if;
end;
$$;

-- ---- 5. every change is in the admin audit log -----------------------------
do $$
begin
  if (select count(*) from public.admin_audit_log where target_table = 'copyright_notices') < 6 then
    raise exception 'FAIL: notice changes were not audited';
  end if;
end;
$$;

rollback;
