-- 091b — The admin live feed never shows a phone number or an email address.
--
-- handle_new_user() names a brand-new profile after the part of the email
-- before the @. People who sign in by phone have a synthetic email
-- (<number>@phone.taskdrop.app), so for a moment their "name" is their phone
-- number, and the sign-up event in 091 would carry it into the feed.
--
-- private.admin_live_clean_name() returns null (the panel then says "Someone")
-- for anything that looks like a phone number or an email address, and
-- trims and shortens the rest. Every name the feed shows goes through it.
--
-- Only replaces functions added by 091. Nothing else is touched.

create or replace function private.admin_live_clean_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name is null or btrim(p_name) = '' then null
    -- six or more digits anywhere reads as a phone number
    when p_name ~ '[0-9]{6,}' then null
    when p_name ~ '@' then null
    else left(btrim(p_name), 60)
  end;
$$;
revoke all on function private.admin_live_clean_name(text) from public, anon, authenticated;

create or replace function private.admin_live_name(p_user uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when p.deleted_at is null then private.admin_live_clean_name(p.display_name) end
  from public.profiles p
  where p.id = p_user;
$$;
revoke all on function private.admin_live_name(uuid) from public, anon, authenticated;

create or replace function private.live_profile_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_live('signup', 'profile', new.id, new.id,
    jsonb_build_object('who', private.admin_live_clean_name(new.display_name)));
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private.live_profile_created() from public, anon, authenticated;
