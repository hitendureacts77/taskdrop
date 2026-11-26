-- 228: own skills, decided on the server only (two Low items from the security review of migration 226).
--
-- 1. `catalog_check` / `catalog_add` could be called straight through PostgREST by any signed-in user, who could
--    then send their own meaning vector and their own "same meaning" threshold (or skip the api's fuller contact
--    check). No app role can run them now; the api uses `catalog_check_for` / `catalog_add_for`, service role only:
--    the api works out the meaning vector itself and passes the caller's id. The threshold is no longer an
--    argument at all; it is read from one row, `private.catalog_settings.min_meaning`, so it can be tuned later
--    without a code change:
--        update private.catalog_settings set min_meaning = 0.9, updated_at = now();
-- 2. The trigger for older app builds (which write typed skills straight into profiles.skills) added unknown
--    names as LIVE, without the api's contact check or the 10-a-day cap. It now adds them HIDDEN, waiting for
--    staff on the Skills & categories page, and stops registering once that person has made 10 terms in a day
--    (the profile still saves). Only the api path, with its checks, makes live terms.
--
-- The api's ops (listCatalog, checkCatalogTerm, addCatalogTerm) and what they answer are unchanged, so every app
-- build keeps working. Undo: supabase/undo/228_own_skills_server_side.down.sql.

-- ------------------------------------------------------------ settings ----

create table if not exists private.catalog_settings (
  id boolean primary key default true check (id),
  -- Cosine similarity (gte-small) at or above which typed text counts as "already covered" by a term.
  min_meaning real not null default 0.88 check (min_meaning between 0.5 and 0.99),
  updated_at timestamptz not null default now()
);
comment on table private.catalog_settings is
  'One row. min_meaning = the "same meaning" threshold for own skills/categories (migration 228). Not readable by any app role.';
insert into private.catalog_settings (id) values (true) on conflict (id) do nothing;
alter table private.catalog_settings enable row level security;
revoke all on private.catalog_settings from public, anon, authenticated;

create or replace function private.catalog_min_meaning()
returns real
language sql
stable
set search_path = ''
as $fn$
  select coalesce((select s.min_meaning from private.catalog_settings s where s.id), 0.88::real);
$fn$;
revoke all on function private.catalog_min_meaning() from public, anon, authenticated;

-- ---------------------------------------------- the old client doors ----

-- Migrations only add (AGENTS.md rule 2), so the two 226 functions stay, but no app role can run them any more.
revoke all on function public.catalog_check(text, text, text, real) from public, anon, authenticated;
revoke all on function public.catalog_add(text, text, text, boolean, real) from public, anon, authenticated;
comment on function public.catalog_check(text, text, text, real) is 'Retired by migration 228: use catalog_check_for (service role, via the api).';
comment on function public.catalog_add(text, text, text, boolean, real) is 'Retired by migration 228: use catalog_add_for (service role, via the api).';

-- ------------------------------------------------- the api's doors ----

-- What typed text would be: exact, covered (and by what), refused, or new. `p_user` is the signed-in caller the
-- api vouches for; `p_embedding` is the api's own meaning vector of the text (null when the model is not there).
create or replace function public.catalog_check_for(p_user uuid, p_kind text, p_text text, p_embedding text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.assert_service_caller();
  if p_user is null then raise exception 'Sign in first'; end if;
  return private.catalog_check_core(p_kind, left(coalesce(p_text, ''), 60), p_embedding, private.catalog_min_meaning());
end;
$fn$;

-- Adds a new term for `p_user` when nothing covers it. `p_force` is the "My skill is something different" tap:
-- allowed for a spelling or meaning match, never for the same name or a phrase an admin set. 10 new terms a day.
create or replace function public.catalog_add_for(p_user uuid, p_kind text, p_text text, p_embedding text default null,
                                                  p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions', 'pg_temp'
as $fn$
declare
  v_min real := private.catalog_min_meaning();
  v_check jsonb;
  v_label text := btrim(regexp_replace(left(coalesce(p_text, ''), 60), '\s+', ' ', 'g'));
  v_id uuid;
begin
  perform private.assert_service_caller();
  if p_user is null or not exists (select 1 from public.profiles p where p.id = p_user and p.deleted_at is null) then
    raise exception 'Sign in first';
  end if;
  v_check := private.catalog_check_core(p_kind, v_label, p_embedding, v_min);
  if v_check ->> 'result' in ('refused', 'exact') then return v_check; end if;
  if v_check ->> 'result' = 'covered' and not (coalesce(p_force, false) and (v_check ->> 'canForce')::boolean) then
    return v_check;
  end if;

  -- One add at a time per person, so two quick taps cannot both slip under the cap.
  perform pg_advisory_xact_lock(hashtextextended('catalog_add:' || p_user::text, 0));
  if (select count(*) from public.catalog_terms where created_by = p_user and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'catalog_daily_limit';
  end if;

  -- First letter capital, the rest as typed ("aquarium cleaning" -> "Aquarium cleaning").
  v_label := upper(left(v_label, 1)) || substr(v_label, 2);
  insert into public.catalog_terms (kind, label, norm_key, source, created_by, embedding)
  values (p_kind, v_label, private.catalog_norm(v_label), 'user', p_user,
          case when p_embedding is null then null else p_embedding::extensions.vector(384) end)
  on conflict (kind, norm_key) do nothing
  returning id into v_id;
  if v_id is null then
    -- Someone added the same name a moment ago: use theirs.
    return private.catalog_check_core(p_kind, v_label, null, v_min);
  end if;
  return jsonb_build_object('result', 'added', 'term', private.catalog_term_json(v_id, 0));
end;
$fn$;

revoke all on function public.catalog_check_for(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.catalog_add_for(uuid, text, text, text, boolean) from public, anon, authenticated;
grant execute on function public.catalog_check_for(uuid, text, text, text) to service_role;
grant execute on function public.catalog_add_for(uuid, text, text, text, boolean) to service_role;

-- ------------------------------------------ older app builds (trigger) ----

-- An app build from before 226 still saves free-text skills. Register any name the list doesn't know so it is
-- counted and staff can see it, but HIDDEN: it skipped the api's checks, so staff decide whether it goes live.
-- Past 10 new terms in a day for that person, names are not registered at all (the profile still saves).
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
  v_made int;
begin
  select count(*) into v_made
    from public.catalog_terms where created_by = new.id and created_at > now() - interval '24 hours';
  foreach s in array coalesce(new.skills, '{}') loop
    exit when v_made >= 10;
    v_label := btrim(regexp_replace(left(coalesce(s, ''), 40), '\s+', ' ', 'g'));
    v_norm := private.catalog_norm(v_label);
    continue when v_norm = '' or char_length(v_label) < 2;
    continue when private.catalog_resolve('skill', v_norm) is not null;
    insert into public.catalog_terms (kind, label, norm_key, source, status, created_by)
    values ('skill', v_label, v_norm, 'user', 'hidden', new.id)
    on conflict (kind, norm_key) do nothing;
    if found then v_made := v_made + 1; end if;
  end loop;
  return null;
end;
$fn$;
revoke all on function private.catalog_register_skills() from public;
