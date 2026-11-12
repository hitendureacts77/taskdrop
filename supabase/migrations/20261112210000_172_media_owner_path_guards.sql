-- 172: the database itself refuses a plain storage path outside the writer's own folder (B59, direct door).
--
-- Migration 171 stops such a path from being shared; the api refuses it too (writes.ts updateProfile,
-- sendMessage, submitProof). A signed-in person can still write these columns straight through PostgREST
-- (profiles.avatar_url update, messages and task_proofs inserts), so these checks keep a bad path from
-- being saved at all:
--   * profiles.avatar_url: a plain path must start with '<profiles.id>/';
--   * messages.body '::media::<path>' (not '::media::media:<id>'): the path must start with '<sender_id>/';
--   * task_proofs.files[*].path (not 'media:<id>'): each path must start with '<worker_id>/'.
-- A path with '..' is refused. Outside picture links (http/https) and 'media:<id>' references are left
-- alone: 171 checks a reference's owner when it is read.
--
-- Only signed-in callers are checked: when auth.uid() is null (service role, seeds, imports, migrations,
-- jobs) nothing changes. The triggers fire only when the column is set or changed, so an update that leaves
-- it alone is never refused because of an older row. Security invoker: no table is read.
-- Staging on 2026-11-12 had no existing row that breaks these rules (see 171).

create or replace function private.path_in_own_folder(p_owner uuid, p_path text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select p_owner is not null and p_path like p_owner::text || '/%' and position('..' in p_path) = 0;
$$;
revoke all on function private.path_in_own_folder(uuid, text) from public, anon;
grant execute on function private.path_in_own_folder(uuid, text) to authenticated;

create or replace function private.guard_media_owner_path()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_path text;
begin
  if auth.uid() is null then
    return new;
  end if;

  if tg_table_name = 'profiles' then
    v_path := new.avatar_url;
    if v_path is not null and v_path not like 'media:%' and v_path !~* '^https?://'
       and not private.path_in_own_folder(new.id, v_path) then
      raise exception 'That picture is not one of your own files' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'messages' then
    if new.body like '::media::%' and new.body not like '::media::media:%'
       and not private.path_in_own_folder(new.sender_id, substr(new.body, length('::media::') + 1)) then
      raise exception 'That photo is not one of your own files' using errcode = 'P0001';
    end if;
  elsif tg_table_name = 'task_proofs' then
    if jsonb_typeof(new.files) = 'array' then
      for v_path in
        select f ->> 'path' from jsonb_array_elements(new.files) f
         where jsonb_typeof(f) = 'object' and jsonb_typeof(f -> 'path') = 'string'
      loop
        if v_path not like 'media:%' and not private.path_in_own_folder(new.worker_id, v_path) then
          raise exception 'A proof file is not one of your own files' using errcode = 'P0001';
        end if;
      end loop;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function private.guard_media_owner_path() from public, anon, authenticated;

-- One trigger for inserts and one for updates, so an update compares with the old value and a column sent
-- back unchanged is never checked. (New triggers only; nothing existing is dropped.)
drop trigger if exists profiles_avatar_own_path_ins on public.profiles;
create trigger profiles_avatar_own_path_ins
  before insert on public.profiles
  for each row
  when (new.avatar_url is not null)
  execute function private.guard_media_owner_path();
drop trigger if exists profiles_avatar_own_path_upd on public.profiles;
create trigger profiles_avatar_own_path_upd
  before update of avatar_url on public.profiles
  for each row
  when (new.avatar_url is not null and new.avatar_url is distinct from old.avatar_url)
  execute function private.guard_media_owner_path();

drop trigger if exists messages_media_own_path_ins on public.messages;
create trigger messages_media_own_path_ins
  before insert on public.messages
  for each row
  when (new.body like '::media::%')
  execute function private.guard_media_owner_path();
drop trigger if exists messages_media_own_path_upd on public.messages;
create trigger messages_media_own_path_upd
  before update of body on public.messages
  for each row
  when (new.body like '::media::%' and new.body is distinct from old.body)
  execute function private.guard_media_owner_path();

drop trigger if exists task_proofs_files_own_path_ins on public.task_proofs;
create trigger task_proofs_files_own_path_ins
  before insert on public.task_proofs
  for each row
  when (new.files is not null)
  execute function private.guard_media_owner_path();
drop trigger if exists task_proofs_files_own_path_upd on public.task_proofs;
create trigger task_proofs_files_own_path_upd
  before update of files on public.task_proofs
  for each row
  when (new.files is distinct from old.files)
  execute function private.guard_media_owner_path();
