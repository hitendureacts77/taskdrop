-- Undo for 20261127110000_228_own_skills_server_side.sql (security review of task 1.19 row E).
-- Revert the PR first (the api goes back to calling catalog_check / catalog_add as the caller), then run this.
-- Gives signed-in users back 226's catalog_check / catalog_add (which take the vector and threshold from the
-- caller), removes catalog_check_for / catalog_add_for and the settings row, and puts 226's trigger back (old-build
-- skills added live). Terms the 228 trigger added hidden stay hidden; staff can unhide them on the admin page.

grant execute on function public.catalog_check(text, text, text, real) to authenticated;
grant execute on function public.catalog_add(text, text, text, boolean, real) to authenticated;
comment on function public.catalog_check(text, text, text, real) is null;
comment on function public.catalog_add(text, text, text, boolean, real) is null;

drop function if exists public.catalog_check_for(uuid, text, text, text);
drop function if exists public.catalog_add_for(uuid, text, text, text, boolean);
drop function if exists private.catalog_min_meaning();
drop table if exists private.catalog_settings;

create or replace function private.catalog_register_skills()
returns trigger
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  s text;
  v_label text;
  v_norm text;
begin
  foreach s in array coalesce(new.skills, '{}') loop
    v_label := btrim(regexp_replace(left(coalesce(s, ''), 40), '\s+', ' ', 'g'));
    v_norm := private.catalog_norm(v_label);
    continue when v_norm = '' or char_length(v_label) < 2;
    continue when private.catalog_resolve('skill', v_norm) is not null;
    insert into public.catalog_terms (kind, label, norm_key, source, status, created_by)
    values ('skill', v_label, v_norm, 'user',
            case when private.catalog_problem(v_label) is null then 'live' else 'hidden' end, new.id)
    on conflict (kind, norm_key) do nothing;
  end loop;
  return null;
end;
$fn$;
revoke all on function private.catalog_register_skills() from public;
