-- 097 -- Closing the admin control-center plan: what blocking does, a Sales role,
-- leads from outside the app, automation rules, a nightly money check, and a
-- "require a verified phone" switch.
--
--   Blocking      the person you block cannot offer on your jobs, and you no
--                 longer see theirs. A job you are already working on together
--                 stays visible and its chat stays open: money in motion is
--                 never stranded by a block.
--   Sales role    admin_staff.staff_role may now be 'sales'. Sales works in the
--                 people area (customers, notes, follow-ups, leads); it cannot
--                 touch money, settings or the team.
--   crm_leads     prospects who are not in the app yet (businesses to onboard).
--   crm_rules     automation rules, edited by full admins only. A scheduled job
--                 (Inngest, never pg_cron) calls run_crm_rules(); the rules
--                 themselves live here. Creates follow-up tasks (source
--                 'automation'), once per rule per person.
--   reconciliation_runs
--                 each nightly money check, written by Inngest through the
--                 service-only functions below; a mismatch leaves an alert.
--   require_phone_verified
--                 per-platform switch on app_controls (see 092). When on, the
--                 api refuses posting, offers and withdrawals from accounts
--                 with no confirmed phone number.
--
-- Additive: new tables, columns, policies and functions. The three existing
-- functions that are re-created (get_app_controls, admin_set_app_control,
-- admin_set_staff, staff_can, admin_reconcile) keep their signatures and
-- behaviour apart from what is described above.

-- ------------------------------------------------- require a verified phone --

alter table public.app_controls add column if not exists require_phone_verified boolean not null default false;

create or replace function public.get_app_controls(p_platform text default null, p_version text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $$
declare
  v_platform text := lower(nullif(btrim(p_platform), ''));
  v_version  text := nullif(btrim(p_version), '');
  v_all      public.app_controls;
  v_plat     public.app_controls;
  v_min      text;
  v_banner   public.app_controls;
begin
  if v_platform is null or v_platform not in ('web', 'android', 'ios') then
    v_platform := null;
  end if;
  if v_version is not null and v_version !~ '^[0-9]+(\.[0-9]+){0,2}$' then
    v_version := null;
  end if;

  select * into v_all from public.app_controls where platform = 'all';
  if v_platform is not null then
    select * into v_plat from public.app_controls where platform = v_platform;
  end if;

  -- The higher of the two minimum versions.
  v_min := case
    when v_all.min_version is null then v_plat.min_version
    when v_plat.min_version is null then v_all.min_version
    when private.version_lt(v_all.min_version, v_plat.min_version) then v_plat.min_version
    else v_all.min_version
  end;

  -- A banner counts while it has text and has not ended; the platform's own wins.
  v_banner := case
    when coalesce(btrim(v_plat.banner_text), '') <> ''
         and (v_plat.banner_ends_at is null or v_plat.banner_ends_at > now()) then v_plat
    when coalesce(btrim(v_all.banner_text), '') <> ''
         and (v_all.banner_ends_at is null or v_all.banner_ends_at > now()) then v_all
    else null
  end;

  return jsonb_build_object(
    'platform',            v_platform,
    'maintenance',         coalesce(v_all.maintenance, false) or coalesce(v_plat.maintenance, false),
    'maintenance_message', case when coalesce(v_plat.maintenance, false)
                                then coalesce(v_plat.maintenance_message, v_all.maintenance_message)
                                else coalesce(v_all.maintenance_message, v_plat.maintenance_message) end,
    'min_version',         v_min,
    'update_required',     v_version is not null and v_min is not null and private.version_lt(v_version, v_min),
    'update_url',          coalesce(v_plat.update_url, v_all.update_url),
    'signups_open',        coalesce(v_all.signups_open, true)    and coalesce(v_plat.signups_open, true),
    'signin_phone',        coalesce(v_all.signin_phone, true)    and coalesce(v_plat.signin_phone, true),
    'signin_google',       coalesce(v_all.signin_google, true)   and coalesce(v_plat.signin_google, true),
    'signin_apple',        coalesce(v_all.signin_apple, true)    and coalesce(v_plat.signin_apple, true),
    'signin_password',     coalesce(v_all.signin_password, true) and coalesce(v_plat.signin_password, true),
    'posting',             coalesce(v_all.posting, true)         and coalesce(v_plat.posting, true),
    'bidding',             coalesce(v_all.bidding, true)         and coalesce(v_plat.bidding, true),
    'topups',              coalesce(v_all.topups, true)          and coalesce(v_plat.topups, true),
    'withdrawals',         coalesce(v_all.withdrawals, true)     and coalesce(v_plat.withdrawals, true),
    'promotions',          coalesce(v_all.promotions, true)      and coalesce(v_plat.promotions, true),
    'chat_photos',         coalesce(v_all.chat_photos, true)     and coalesce(v_plat.chat_photos, true),
    'require_phone_verified', coalesce(v_all.require_phone_verified, false) or coalesce(v_plat.require_phone_verified, false),
    'banner_text',         case when v_banner.platform is null then null else btrim(v_banner.banner_text) end,
    'banner_level',        case when v_banner.platform is null then null else v_banner.banner_level end,
    'banner_link',         case when v_banner.platform is null then null else v_banner.banner_link end
  );
end;
$$;
revoke all on function public.get_app_controls(text, text) from public;
grant execute on function public.get_app_controls(text, text) to anon, authenticated, service_role;

-- Change switches for one platform. p_changes holds only the keys to change,
-- e.g. {"bidding": false, "banner_text": "Back at 6pm"}.
create or replace function public.admin_set_app_control(p_platform text, p_changes jsonb, p_reason text default null)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_actor   uuid := auth.uid();
  v_claims  jsonb := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  v_bools   constant text[] := array['maintenance', 'signups_open', 'signin_phone', 'signin_google', 'signin_apple',
                                     'signin_password', 'posting', 'bidding', 'topups', 'withdrawals',
                                     'promotions', 'chat_photos', 'require_phone_verified'];
  v_texts   constant text[] := array['maintenance_message', 'min_version', 'update_url', 'banner_text',
                                     'banner_level', 'banner_link', 'banner_ends_at'];
  v_money   constant text[] := array['topups', 'withdrawals'];
  v_old     jsonb;
  v_new     jsonb;
  v_changed text[] := '{}';
  v_detail  text := '';
  v_mfa     boolean;
  v_key     text;
  v_val     jsonb;
  v_row     public.app_controls;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_platform is null or p_platform not in ('all', 'web', 'android', 'ios') then
    raise exception 'Unknown platform %', p_platform;
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Changes must be an object of switch names and values';
  end if;

  select to_jsonb(c) into v_old from public.app_controls c where c.platform = p_platform;
  if v_old is null then raise exception 'No controls row for %', p_platform; end if;

  -- Validate every key and value; collect what actually changes.
  for v_key, v_val in select * from jsonb_each(p_changes) loop
    if v_key = any (v_bools) then
      if jsonb_typeof(v_val) <> 'boolean' then raise exception '% must be true or false', v_key; end if;
    elsif v_key = any (v_texts) then
      if jsonb_typeof(v_val) not in ('string', 'null') then raise exception '% must be text or null', v_key; end if;
      if jsonb_typeof(v_val) = 'string' then
        -- text is stored trimmed; blank clears it
        v_val := case when btrim(v_val #>> '{}') = '' then 'null'::jsonb else to_jsonb(btrim(v_val #>> '{}')) end;
        p_changes := jsonb_set(p_changes, array[v_key], v_val);
      end if;
      if jsonb_typeof(v_val) = 'string' then
        case v_key
          when 'min_version' then
            if (v_val #>> '{}') !~ '^[0-9]+(\.[0-9]+){0,2}$' then raise exception 'min_version looks like 1.2.0'; end if;
          when 'banner_level' then
            if (v_val #>> '{}') not in ('info', 'warning', 'critical') then
              raise exception 'banner_level is info, warning or critical';
            end if;
          when 'update_url', 'banner_link' then
            if (v_val #>> '{}') !~ '^https://' then raise exception '% must start with https://', v_key; end if;
          when 'banner_ends_at' then
            perform (v_val #>> '{}')::timestamptz; -- raises on a bad date
          else null;
        end case;
      elsif v_key = 'banner_level' then
        raise exception 'banner_level is info, warning or critical';
      end if;
    else
      raise exception 'Unknown control %', v_key;
    end if;

    if v_old -> v_key is distinct from v_val
       and not (v_key = 'banner_ends_at' and jsonb_typeof(v_val) = 'string'
                and (v_old ->> v_key) is not null
                and (v_old ->> v_key)::timestamptz = (v_val #>> '{}')::timestamptz) then
      v_changed := v_changed || v_key;
      v_detail := v_detail || format('; %s: %s -> %s', v_key, coalesce(left(v_old ->> v_key, 40), 'null'),
                                     coalesce(left(v_val #>> '{}', 40), 'null'));
    end if;
  end loop;

  select to_jsonb(c) into v_new from public.app_controls c where c.platform = p_platform;
  if cardinality(v_changed) = 0 then
    return v_new; -- nothing to do, nothing to log
  end if;

  -- Who may: money switches need money (full admin or finance); the rest need
  -- a full admin. Money switches also need the authenticator code.
  if exists (select 1 from unnest(v_changed) k where k <> all (v_money)) then
    if not private.staff_can(v_actor, 'admin') then
      raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
        using errcode = '42501';
    end if;
  elsif not private.staff_can(v_actor, 'money') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(v_actor)
      using errcode = '42501';
  end if;
  if v_changed && v_money then
    select s.value = 'true'::jsonb into v_mfa from public.settings s where s.key = 'admin_require_mfa';
    if coalesce(v_mfa, true) and coalesce(v_claims ->> 'aal', '') <> 'aal2' then
      raise exception 'Verify your authenticator code first (Security page in the admin panel)'
        using errcode = '42501';
    end if;
  end if;

  v_new := v_old || (select coalesce(jsonb_object_agg(k, p_changes -> k), '{}'::jsonb) from unnest(v_changed) k);
  select * into v_row from jsonb_populate_record(null::public.app_controls, v_new);

  update public.app_controls c set
    maintenance = v_row.maintenance, maintenance_message = v_row.maintenance_message,
    min_version = v_row.min_version, update_url = v_row.update_url,
    signups_open = v_row.signups_open, signin_phone = v_row.signin_phone, signin_google = v_row.signin_google,
    signin_apple = v_row.signin_apple, signin_password = v_row.signin_password,
    posting = v_row.posting, bidding = v_row.bidding, topups = v_row.topups, withdrawals = v_row.withdrawals,
    promotions = v_row.promotions, chat_photos = v_row.chat_photos,
    require_phone_verified = v_row.require_phone_verified,
    banner_text = v_row.banner_text, banner_level = v_row.banner_level, banner_link = v_row.banner_link,
    banner_ends_at = v_row.banner_ends_at,
    updated_by = v_actor, updated_at = now()
  where c.platform = p_platform
  returning * into v_row;

  perform public.admin_log_event(
    'app_control_changed',
    'app_controls:' || p_platform,
    left(coalesce('reason: ' || left(nullif(btrim(p_reason), ''), 100), 'no reason given') || v_detail, 500));

  return to_jsonb(v_row);
end;
$fn$;
revoke all on function public.admin_set_app_control(text, jsonb, text) from public, anon;
grant execute on function public.admin_set_app_control(text, jsonb, text) to authenticated;

-- ----------------------------------------------------------------- blocking --

create or replace function private.is_blocking(p_blocker uuid, p_blocked uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_blocker is not null and p_blocked is not null
     and exists (select 1 from public.blocks b where b.blocker_id = p_blocker and b.blocked_id = p_blocked);
$$;
revoke all on function private.is_blocking(uuid, uuid) from public;
grant execute on function private.is_blocking(uuid, uuid) to anon, authenticated;

-- True when either side has blocked the other, for a bid on this job. Reads the
-- job as the table owner so it cannot be fooled by the caller's own view of it.
create or replace function private.bid_is_blocked(p_task uuid, p_worker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tasks t
     where t.id = p_task
       and (private.is_blocking(t.poster_id, p_worker) or private.is_blocking(p_worker, t.poster_id))
  );
$$;
revoke all on function private.bid_is_blocked(uuid, uuid) from public;
grant execute on function private.bid_is_blocked(uuid, uuid) to anon, authenticated;

-- Has this person ever been assigned this job? Keeps their history visible.
create or replace function private.has_assignment(p_task uuid, p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_user is not null and exists (select 1 from public.assignments a where a.task_id = p_task and a.worker_id = p_user);
$$;
revoke all on function private.has_assignment(uuid, uuid) from public;
grant execute on function private.has_assignment(uuid, uuid) to anon, authenticated;

-- Restrictive: ANDed with the existing visibility rules, never widening them.
-- You still see your own jobs, jobs you work(ed) on, and everything as staff.
drop policy if exists tasks_hide_blocked on public.tasks;
create policy tasks_hide_blocked on public.tasks
  as restrictive for select
  using (
    poster_id = (select auth.uid())
    or not private.is_blocking((select auth.uid()), poster_id)
    or private.has_assignment(id, (select auth.uid()))
    or private.is_admin()
  );

drop policy if exists bids_no_blocked on public.bids;
create policy bids_no_blocked on public.bids
  as restrictive for insert
  with check (not private.bid_is_blocked(task_id, worker_id));

-- --------------------------------------------------------------- Sales role --

do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.admin_staff'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%staff_role%'
  loop
    execute format('alter table public.admin_staff drop constraint %I', c.conname);
  end loop;
  alter table public.admin_staff
    add constraint admin_staff_staff_role_check
    check (staff_role in ('admin', 'finance', 'support', 'sales', 'viewer'));
end $$;

create or replace function private.staff_can(p_user uuid, p_area text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case private.staff_role(p_user)
    when 'admin'   then true
    when 'finance' then p_area = 'money'
    when 'support' then p_area = 'people'
    when 'sales'   then p_area = 'people'
    else false
  end;
$$;
revoke all on function private.staff_can(uuid, text) from public, anon, authenticated;

create or replace function public.admin_set_staff(p_user_id uuid, p_role text, p_notify boolean default null)
returns text
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_current text;
  v_full    int;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if p_role not in ('admin', 'finance', 'support', 'sales', 'viewer') then
    raise exception 'Unknown staff role %', p_role;
  end if;
  v_current := coalesce((select staff_role from public.admin_staff where user_id = p_user_id), 'admin');

  if p_user_id = auth.uid() and p_role <> v_current then
    raise exception 'You cannot change your own staff role';
  end if;

  -- Never leave TaskDrop without a full admin.
  if v_current = 'admin' and p_role <> 'admin' and private.has_role(p_user_id, 'admin') then
    select count(*) into v_full
      from public.user_roles ur
      left join public.admin_staff s on s.user_id = ur.user_id
     where ur.role = 'admin' and coalesce(s.staff_role, 'admin') = 'admin';
    if v_full <= 1 then
      raise exception 'This is the last full admin; make someone else a full admin first';
    end if;
  end if;

  insert into public.admin_staff (user_id, staff_role, notify, updated_at, updated_by)
  values (p_user_id, p_role, coalesce(p_notify, true), now(), auth.uid())
  on conflict (user_id) do update
    set staff_role = excluded.staff_role,
        notify     = coalesce(p_notify, public.admin_staff.notify),
        updated_at = now(),
        updated_by = auth.uid();
  return p_role;
end;
$fn$;
revoke all on function public.admin_set_staff(uuid, text, boolean) from public, anon;
grant execute on function public.admin_set_staff(uuid, text, boolean) to authenticated;

-- -------------------------------------------------------------------- leads --

create table if not exists public.crm_leads (
  id                uuid primary key default gen_random_uuid(),
  name              text not null check (char_length(btrim(name)) between 1 and 120),
  contact           text check (char_length(contact) <= 200),
  kind              text not null default 'business' check (kind in ('business', 'person', 'other')),
  source            text check (char_length(source) <= 120),
  stage             text not null default 'new' check (stage in ('new', 'contacted', 'talking', 'won', 'lost')),
  note              text check (char_length(note) <= 2000),
  owner_id          uuid references auth.users (id) on delete set null,
  user_id           uuid references auth.users (id) on delete set null,
  created_by        uuid references auth.users (id) on delete set null,
  created_at        timestamptz not null default now(),
  stage_changed_at  timestamptz not null default now()
);
create index if not exists crm_leads_stage_idx on public.crm_leads (stage, created_at desc);
create index if not exists crm_leads_owner_idx on public.crm_leads (owner_id) where stage not in ('won', 'lost');

alter table public.crm_leads enable row level security;
drop policy if exists crm_leads_admin_read on public.crm_leads;
create policy crm_leads_admin_read on public.crm_leads for select to authenticated using (private.is_admin());
revoke all on public.crm_leads from anon, authenticated;
grant select on public.crm_leads to authenticated;
drop trigger if exists require_staff_permission on public.crm_leads;
create trigger require_staff_permission before insert or update or delete on public.crm_leads
  for each row execute function private.require_staff_permission('people');

create or replace function public.crm_add_lead(
  p_name text, p_contact text default null, p_kind text default 'business',
  p_source text default null, p_note text default null, p_owner uuid default null)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_id uuid;
begin
  perform private.require_people_staff();
  if p_owner is not null and not private.has_role(p_owner, 'admin') then
    raise exception 'The owner must be a staff member';
  end if;
  insert into public.crm_leads (name, contact, kind, source, note, owner_id, created_by)
  values (btrim(p_name), nullif(btrim(coalesce(p_contact, '')), ''), coalesce(p_kind, 'business'),
          nullif(btrim(coalesce(p_source, '')), ''), nullif(btrim(coalesce(p_note, '')), ''), p_owner, auth.uid())
  returning id into v_id;
  perform public.admin_log_event('crm_lead_added', 'crm_leads:' || v_id, left(btrim(p_name), 100));
  return v_id;
end;
$fn$;
revoke all on function public.crm_add_lead(text, text, text, text, text, uuid) from public, anon;
grant execute on function public.crm_add_lead(text, text, text, text, text, uuid) to authenticated;

-- Change a lead's stage, note or owner. Null leaves a field as it is; pass
-- p_clear_owner to take the owner off.
create or replace function public.crm_update_lead(
  p_id uuid, p_stage text default null, p_note text default null, p_owner uuid default null, p_clear_owner boolean default false)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_old public.crm_leads;
begin
  perform private.require_people_staff();
  select * into v_old from public.crm_leads where id = p_id for update;
  if not found then raise exception 'That lead no longer exists'; end if;
  if p_stage is not null and p_stage not in ('new', 'contacted', 'talking', 'won', 'lost') then
    raise exception 'Unknown stage %', p_stage;
  end if;
  if p_owner is not null and not private.has_role(p_owner, 'admin') then
    raise exception 'The owner must be a staff member';
  end if;
  update public.crm_leads
     set stage = coalesce(p_stage, stage),
         stage_changed_at = case when p_stage is not null and p_stage <> stage then now() else stage_changed_at end,
         note = case when p_note is null then note else nullif(btrim(p_note), '') end,
         owner_id = case when p_clear_owner then null else coalesce(p_owner, owner_id) end
   where id = p_id;
  if p_stage is not null and p_stage <> v_old.stage then
    perform public.admin_log_event('crm_lead_stage', 'crm_leads:' || p_id, v_old.stage || ' -> ' || p_stage);
  end if;
end;
$fn$;
revoke all on function public.crm_update_lead(uuid, text, text, uuid, boolean) from public, anon;
grant execute on function public.crm_update_lead(uuid, text, text, uuid, boolean) to authenticated;

-- ----------------------------------------------------------- automation rules --

create table if not exists public.crm_rules (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(btrim(name)) between 1 and 120),
  kind        text not null check (kind in ('funded_no_task', 'dispute_opened')),
  days        integer not null default 7 check (days between 1 and 90),
  enabled     boolean not null default false,
  created_by  uuid references auth.users (id) on delete set null,
  updated_by  uuid references auth.users (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.crm_rules enable row level security;
drop policy if exists crm_rules_admin_read on public.crm_rules;
create policy crm_rules_admin_read on public.crm_rules for select to authenticated using (private.is_admin());
revoke all on public.crm_rules from anon, authenticated;
grant select on public.crm_rules to authenticated;
drop trigger if exists require_staff_permission on public.crm_rules;
create trigger require_staff_permission before insert or update or delete on public.crm_rules
  for each row execute function private.require_staff_permission('admin');

alter table public.crm_tasks add column if not exists rule_id uuid references public.crm_rules (id) on delete set null;
-- One follow-up per rule, per person, per job: the runner can never double up.
create unique index if not exists crm_tasks_rule_once_idx
  on public.crm_tasks (rule_id, user_id, coalesce(task_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where rule_id is not null;

-- Two starter rules, off until a full admin turns them on.
insert into public.crm_rules (name, kind, days, enabled)
select * from (values
  ('Topped up but has not posted a job', 'funded_no_task', 7, false),
  ('Dispute opened: follow up with the person', 'dispute_opened', 2, false)
) v (name, kind, days, enabled)
where not exists (select 1 from public.crm_rules);

create or replace function public.admin_save_crm_rule(p_id uuid, p_name text, p_kind text, p_days integer, p_enabled boolean)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_id uuid := p_id;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not private.staff_can(auth.uid(), 'admin') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(auth.uid())
      using errcode = '42501';
  end if;
  if p_kind not in ('funded_no_task', 'dispute_opened') then raise exception 'Unknown rule type %', p_kind; end if;
  if p_days is null or p_days not between 1 and 90 then raise exception 'Days must be between 1 and 90'; end if;
  if v_id is null then
    insert into public.crm_rules (name, kind, days, enabled, created_by, updated_by)
    values (btrim(p_name), p_kind, p_days, coalesce(p_enabled, false), auth.uid(), auth.uid())
    returning id into v_id;
  else
    update public.crm_rules
       set name = btrim(p_name), kind = p_kind, days = p_days, enabled = coalesce(p_enabled, enabled),
           updated_by = auth.uid(), updated_at = now()
     where id = v_id;
    if not found then raise exception 'That rule no longer exists'; end if;
  end if;
  perform public.admin_log_event('crm_rule_saved', 'crm_rules:' || v_id,
    left(btrim(p_name) || ' (' || p_kind || ', ' || p_days || ' days, ' || case when coalesce(p_enabled, false) then 'on' else 'off' end || ')', 300));
  return v_id;
end;
$fn$;
revoke all on function public.admin_save_crm_rule(uuid, text, text, integer, boolean) from public, anon;
grant execute on function public.admin_save_crm_rule(uuid, text, text, integer, boolean) to authenticated;

create or replace function public.admin_delete_crm_rule(p_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare v_name text;
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not private.staff_can(auth.uid(), 'admin') then
    raise exception 'Your staff role (%) can''t do this. Ask a full admin.', private.staff_role(auth.uid())
      using errcode = '42501';
  end if;
  delete from public.crm_rules where id = p_id returning name into v_name;
  if not found then raise exception 'That rule no longer exists'; end if;
  perform public.admin_log_event('crm_rule_deleted', 'crm_rules:' || p_id, left(v_name, 300));
end;
$fn$;
revoke all on function public.admin_delete_crm_rule(uuid) from public, anon;
grant execute on function public.admin_delete_crm_rule(uuid) to authenticated;

-- Run every enabled rule. Called on a schedule by the Inngest function, with
-- the service key. Returns how many follow-ups it created.
create or replace function public.run_crm_rules()
returns integer
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $fn$
declare
  r record;
  v_made integer := 0;
  v_n integer;
begin
  perform private.assert_service_caller();
  for r in select * from public.crm_rules where enabled loop
    if r.kind = 'funded_no_task' then
      -- Paid a top-up at least N days ago (but within 90), and has posted nothing since.
      with todo as (
        select distinct on (pay.user_id) pay.user_id, pay.paid_at
          from public.payments pay
         where pay.purpose::text = 'topup' and pay.status::text = 'paid'
           and pay.paid_at <= now() - make_interval(days => r.days)
           and pay.paid_at >= now() - interval '90 days'
           and not exists (select 1 from public.tasks t where t.poster_id = pay.user_id and t.created_at >= pay.paid_at)
         order by pay.user_id, pay.paid_at desc
      )
      insert into public.crm_tasks (user_id, title, detail, due_at, owner_id, source, rule_id)
      select t.user_id, left(r.name, 200),
             'Added a top-up on ' || to_char(t.paid_at at time zone 'Asia/Kolkata', 'DD Mon') || ' and has not posted a job since.',
             now() + interval '1 day',
             (select o.owner_id from public.crm_owners o where o.user_id = t.user_id),
             'automation', r.id
        from todo t
       where not exists (select 1 from public.crm_tasks c where c.rule_id = r.id and c.user_id = t.user_id)
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_made := v_made + v_n;
    elsif r.kind = 'dispute_opened' then
      -- A dispute opened in the last N days: follow up with the person who opened it.
      insert into public.crm_tasks (user_id, task_id, title, detail, due_at, owner_id, source, rule_id)
      select d.opened_by, d.task_id, left(r.name, 200), 'A dispute was opened on one of their jobs.',
             now() + interval '1 day',
             (select o.owner_id from public.crm_owners o where o.user_id = d.opened_by),
             'automation', r.id
        from public.task_disputes d
       where d.opened_by is not null and d.created_at >= now() - make_interval(days => r.days)
         and not exists (select 1 from public.crm_tasks c where c.rule_id = r.id and c.user_id = d.opened_by and c.task_id = d.task_id)
      on conflict do nothing;
      get diagnostics v_n = row_count;
      v_made := v_made + v_n;
    end if;
  end loop;
  return v_made;
end;
$fn$;
revoke all on function public.run_crm_rules() from public, anon, authenticated;
grant execute on function public.run_crm_rules() to service_role;

-- ------------------------------------------------------------ reconciliation --

create or replace function private.reconcile_rows(p_from date, p_to date)
returns table (check_code text, severity text, ref_type text, ref_id uuid, amount_minor bigint, at timestamptz, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  return query
  select 'funded_without_paid_payment'::text, 'high'::text, 'task'::text, t.id, t.locked_minor::bigint, t.funded_at,
         ('Job is funded but its payment is ' || coalesce(pay.status::text, 'missing'))::text
    from public.tasks t
    left join public.payments pay on pay.id = t.funding_payment_id
   where t.funded_at is not null and t.funding_payment_id is not null and coalesce(pay.status::text, '') <> 'paid'
     and (t.funded_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'paid_not_credited'::text, 'high'::text, 'payment'::text, pay.id, pay.amount_minor::bigint, pay.paid_at,
         ('Paid ' || pay.purpose::text || ' with no credit recorded')::text
    from public.payments pay
   where pay.status::text = 'paid' and pay.credited_at is null
     and not exists (select 1 from public.tasks t where t.funding_payment_id = pay.id)
     and (pay.paid_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payment_stuck_created'::text, 'medium'::text, 'payment'::text, pay.id, pay.amount_minor::bigint, pay.created_at,
         'Payment link created and never paid'::text
    from public.payments pay
   where pay.status::text = 'created' and pay.created_at < now() - interval '2 days'
     and (pay.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payout_waiting_long'::text, 'medium'::text, 'payout'::text, po.id, po.amount_minor::bigint, po.created_at,
         'Withdrawal still waiting'::text
    from public.payouts po
   where po.status::text = 'requested' and po.created_at < now() - interval '3 days'
     and (po.created_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'payout_paid_no_reference'::text, 'high'::text, 'payout'::text, po.id, po.amount_minor::bigint, po.updated_at,
         'Paid via RazorpayX without a provider reference'::text
    from public.payouts po
   where po.status::text = 'paid' and po.via = 'razorpayx' and po.provider_payout_id is null
     and (po.updated_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  union all
  select 'finished_without_commission'::text, 'high'::text, 'task'::text, t.id, null::bigint, t.updated_at,
         'Finished job has no worker commission in the ledger'::text
    from public.tasks t
   where t.status::text in ('COMPLETED', 'AUTO_COMPLETED') and t.funded_at is not null
     and exists (select 1 from public.assignments a where a.task_id = t.id)
     and not exists (select 1 from public.platform_ledger l where l.task_id = t.id and l.kind = 'worker_commission')
     and (t.updated_at at time zone 'Asia/Kolkata')::date between p_from and p_to
  order by 6 desc;
end;
$fn$;
revoke all on function private.reconcile_rows(date, date) from public, anon, authenticated;

-- Same checks and permissions as before; the query now lives in private.reconcile_rows.
create or replace function public.admin_reconcile(p_from date, p_to date)
returns table (check_code text, severity text, ref_type text, ref_id uuid, amount_minor bigint, at timestamptz, detail text)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not (private.staff_can(auth.uid(), 'money') or private.staff_role(auth.uid()) = 'viewer') then
    raise exception 'Your staff role (%) can''t see this.', private.staff_role(auth.uid()) using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then raise exception 'Choose a valid date range'; end if;
  if p_to - p_from > 400 then raise exception 'At most 400 days at a time'; end if;
  return query select * from private.reconcile_rows(p_from, p_to);
end;
$fn$;
revoke all on function public.admin_reconcile(date, date) from public, anon;
grant execute on function public.admin_reconcile(date, date) to authenticated;

create table if not exists public.reconciliation_runs (
  id          uuid primary key default gen_random_uuid(),
  ran_at      timestamptz not null default now(),
  kind        text not null check (kind in ('internal', 'razorpay')),
  from_day    date,
  to_day      date,
  checked     integer not null default 0,
  mismatches  integer not null default 0,
  detail      jsonb not null default '[]'::jsonb
);
create index if not exists reconciliation_runs_recent_idx on public.reconciliation_runs (ran_at desc);
alter table public.reconciliation_runs enable row level security;
revoke all on public.reconciliation_runs from public, anon, authenticated;

-- The internal money checks for the last N days. Service key only.
create or replace function public.run_reconciliation(p_days integer default 3)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $fn$
declare
  v_from date := (now() at time zone 'Asia/Kolkata')::date - greatest(coalesce(p_days, 3), 1);
  v_to   date := (now() at time zone 'Asia/Kolkata')::date;
  v_rows jsonb;
  v_n    integer;
  v_id   uuid;
begin
  perform private.assert_service_caller();
  select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb), count(*) into v_rows, v_n
    from (select * from private.reconcile_rows(v_from, v_to) limit 100) x;
  insert into public.reconciliation_runs (kind, from_day, to_day, checked, mismatches, detail)
  values ('internal', v_from, v_to, v_n, v_n, v_rows)
  returning id into v_id;
  if v_n > 0 then
    perform public.record_admin_alert('reconcile', 'Money check: ' || v_n || ' thing(s) do not add up',
      'Open Money check in the admin panel to see which.', jsonb_build_object('run', v_id, 'count', v_n));
  end if;
  return jsonb_build_object('run', v_id, 'mismatches', v_n);
end;
$fn$;
revoke all on function public.run_reconciliation(integer) from public, anon, authenticated;
grant execute on function public.run_reconciliation(integer) to service_role;

-- Payments the nightly job should ask Razorpay about. Service key only.
create or replace function public.reconcile_provider_candidates(p_days integer default 3)
returns table (id uuid, provider_ref text, status text, amount_minor bigint, created_at timestamptz)
language plpgsql
stable
security definer
set search_path = 'public', 'private', 'pg_temp'
as $fn$
begin
  perform private.assert_service_caller();
  return query
  select p.id, p.provider_ref, p.status::text, p.amount_minor::bigint, p.created_at
    from public.payments p
   where p.provider = 'razorpay' and p.provider_ref is not null
     and p.created_at >= now() - make_interval(days => greatest(coalesce(p_days, 3), 1))
   order by p.created_at desc
   limit 200;
end;
$fn$;
revoke all on function public.reconcile_provider_candidates(integer) from public, anon, authenticated;
grant execute on function public.reconcile_provider_candidates(integer) to service_role;

-- Save the outcome of the Razorpay comparison. Service key only.
create or replace function public.record_provider_reconciliation(p_checked integer, p_mismatches jsonb)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'private', 'pg_temp'
as $fn$
declare
  v_n  integer := coalesce(jsonb_array_length(coalesce(p_mismatches, '[]'::jsonb)), 0);
  v_id uuid;
begin
  perform private.assert_service_caller();
  insert into public.reconciliation_runs (kind, from_day, to_day, checked, mismatches, detail)
  values ('razorpay', (now() at time zone 'Asia/Kolkata')::date - 3, (now() at time zone 'Asia/Kolkata')::date,
          greatest(coalesce(p_checked, 0), 0), v_n, coalesce(p_mismatches, '[]'::jsonb))
  returning id into v_id;
  if v_n > 0 then
    perform public.record_admin_alert('reconcile', 'Razorpay check: ' || v_n || ' payment(s) differ from our records',
      'Open Money check in the admin panel to see which.', jsonb_build_object('run', v_id, 'count', v_n));
  end if;
  return v_id;
end;
$fn$;
revoke all on function public.record_provider_reconciliation(integer, jsonb) from public, anon, authenticated;
grant execute on function public.record_provider_reconciliation(integer, jsonb) to service_role;

-- The latest runs, for the Money check page. Money staff, viewers and admins.
create or replace function public.admin_reconciliation_runs(p_limit integer default 20)
returns table (id uuid, ran_at timestamptz, kind text, from_day date, to_day date, checked integer, mismatches integer, detail jsonb)
language plpgsql
stable
security definer
set search_path = 'public', 'private', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  if not (private.staff_can(auth.uid(), 'money') or private.staff_role(auth.uid()) = 'viewer') then
    raise exception 'Your staff role (%) can''t see this.', private.staff_role(auth.uid()) using errcode = '42501';
  end if;
  return query
  select r.id, r.ran_at, r.kind, r.from_day, r.to_day, r.checked, r.mismatches, r.detail
    from public.reconciliation_runs r
   order by r.ran_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 100);
end;
$fn$;
revoke all on function public.admin_reconciliation_runs(integer) from public, anon;
grant execute on function public.admin_reconciliation_runs(integer) to authenticated;

-- ------------------------------------------------------------------ devices --

-- Devices by platform and app version, for the admin Devices page.
create or replace function public.admin_devices_summary()
returns table (platform text, app_version text, devices bigint, people bigint, last_seen timestamptz)
language plpgsql
stable
security definer
set search_path = 'public', 'private', 'pg_temp'
as $fn$
begin
  if not private.is_admin() then raise exception 'Admins only'; end if;
  return query
  select d.platform, coalesce(d.app_version, 'unknown'), count(*)::bigint, count(distinct d.user_id)::bigint, max(d.last_seen_at)
    from public.app_devices d
   group by d.platform, coalesce(d.app_version, 'unknown')
   order by d.platform, max(d.last_seen_at) desc;
end;
$fn$;
revoke all on function public.admin_devices_summary() from public, anon;
grant execute on function public.admin_devices_summary() to authenticated;
