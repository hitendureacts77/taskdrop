-- 226: workers and posters can add their own skills and categories (task 1.19 row E).
--
-- Owner (25 Nov): "If a worker has some other skill, he can create his own skill ... store the skill name so
-- other workers can use it too ... if it's popular it can become a normal skill. Not only skills, categories
-- also." Design v2: ONE list, ranked by use (skills by how many workers have them, categories by how many tasks
-- use them). A worker-made skill climbs the list by itself. If what they type is already covered ("Teaching
-- maths" -> Tutoring), they are asked to pick the existing one.
--
-- profiles.skills and tasks.category stay plain text (nothing is renamed or dropped). This adds the shared
-- list beside them:
--   * catalog_terms    one row per skill or category. Built-in ones are seeded from the app's lists;
--                      `source = 'user'` rows are the ones people added ("stored under Others").
--   * catalog_phrases  other words for a term, used by the "already covered" check.
-- Ranking is counted when asked (no stored counter to drift). Text matches a term by its normalised key, so
-- capitals, spaces, "&", "and" and plurals never make a second copy.
--
-- Nobody reads the tables directly: everything goes through the functions below.

create extension if not exists pg_trgm with schema extensions;
create extension if not exists vector with schema extensions;

-- --------------------------------------------------------------- tables ----

create table if not exists public.catalog_terms (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('skill', 'category')),
  label text not null check (char_length(label) between 2 and 40),
  norm_key text not null check (norm_key <> ''),
  source text not null default 'user' check (source in ('builtin', 'user')),
  builtin_order int,
  status text not null default 'live' check (status in ('live', 'hidden', 'merged')),
  merged_into uuid references public.catalog_terms (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  embedding extensions.vector(384),
  unique (kind, norm_key)
);
create index if not exists catalog_terms_created_by on public.catalog_terms (created_by, created_at);
create index if not exists catalog_terms_merged_into on public.catalog_terms (merged_into);

create table if not exists public.catalog_phrases (
  id uuid primary key default gen_random_uuid(),
  term_id uuid not null references public.catalog_terms (id) on delete cascade,
  kind text not null check (kind in ('skill', 'category')),
  phrase text not null check (char_length(phrase) between 2 and 60),
  norm_key text not null check (norm_key <> ''),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (kind, norm_key)
);
create index if not exists catalog_phrases_term on public.catalog_phrases (term_id);

alter table public.catalog_terms enable row level security;
alter table public.catalog_phrases enable row level security;
-- No policies on purpose: the functions below are the only door.
revoke all on public.catalog_terms, public.catalog_phrases from public, anon, authenticated;

-- -------------------------------------------------------------- helpers ----

-- The key two spellings share: lower case, only a-z and 0-9, "&" and "and" dropped, a plural "s" dropped from
-- words longer than three letters ("Repairs & Maintenance" = "repair maintenance").
create or replace function private.catalog_norm(p text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $fn$
  select coalesce(string_agg(case when length(w) > 3 and w ~ '[^s]s$' then left(w, -1) else w end, ' ' order by o), '')
    from regexp_split_to_table(
           btrim(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g')), ' '
         ) with ordinality as t (w, o)
   where w <> '' and w <> 'and';
$fn$;

-- Why a typed name can't be used, or null. The api also runs the fuller contact check (_shared/contacts.ts);
-- this one is the floor every path shares, including the trigger for older app builds.
create or replace function private.catalog_problem(p text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  v text := btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g'));
  v_norm text := private.catalog_norm(v);
  v_low text := lower(v);
  v_rude text[] := array[
    'fuck', 'fucking', 'fucker', 'shit', 'bitch', 'bastard', 'asshole', 'dick', 'pussy', 'cunt', 'whore', 'slut',
    'porn', 'sex', 'sexy', 'nude', 'escort', 'massage parlour', 'call girl', 'callgirl', 'hookup',
    'chutiya', 'chutia', 'madarchod', 'behenchod', 'bhenchod', 'bc', 'mc', 'bsdk', 'bhosdike', 'gaand', 'gandu',
    'randi', 'harami', 'kamina', 'lauda', 'lund', 'chut',
    'drugs', 'ganja', 'cocaine', 'betting', 'satta'
  ];
begin
  if char_length(v) < 2 or char_length(v) > 30 then return 'length'; end if;
  if v_norm = '' or v !~ '[A-Za-z]' then return 'letters'; end if;
  if regexp_replace(v, '[\s\-\.\(\)]', '', 'g') ~ '[0-9]{5,}'
     or v ~ '@' or v_low ~ '(https?:|www\.)' or v_low ~ '\.(com|in|net|org|co|io|me|xyz|app|info)(\M|$)' then
    return 'contact';
  end if;
  if exists (
    select 1 from unnest(v_rude) r
     where (' ' || v_norm || ' ') like ('% ' || private.catalog_norm(r) || ' %')
        or (' ' || regexp_replace(v_low, '[^a-z0-9]+', ' ', 'g') || ' ') like ('% ' || r || ' %')
  ) then
    return 'rude';
  end if;
  return null;
end;
$fn$;

-- The live (or hidden) term a normalised key belongs to: its own row, a merged row's target, or a phrase's term.
create or replace function private.catalog_resolve(p_kind text, p_norm text)
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select coalesce(
    (select case when t.status = 'merged' then t.merged_into else t.id end
       from public.catalog_terms t where t.kind = p_kind and t.norm_key = p_norm),
    (select ph.term_id from public.catalog_phrases ph where ph.kind = p_kind and ph.norm_key = p_norm)
  );
$fn$;

-- How many workers have each skill, or how many tasks use each category, keyed by the term it resolves to.
create or replace function private.catalog_uses(p_kind text)
returns table (term_id uuid, uses bigint)
language sql
stable
set search_path = ''
as $fn$
  with keys as (
    select case when t.status = 'merged' then t.merged_into else t.id end as term_id, t.norm_key
      from public.catalog_terms t where t.kind = p_kind
    union all
    select ph.term_id, ph.norm_key from public.catalog_phrases ph where ph.kind = p_kind
  ),
  used as (
    select p.id::text as who, private.catalog_norm(s) as norm_key
      from public.profiles p cross join lateral unnest(p.skills) s
     where p_kind = 'skill' and p.deleted_at is null
    union all
    select t.id::text, private.catalog_norm(t.category)
      from public.tasks t
     where p_kind = 'category' and t.category is not null
  )
  select k.term_id, count(distinct u.who)
    from used u join keys k on k.norm_key = u.norm_key
   where k.term_id is not null
   group by k.term_id;
$fn$;

create or replace function private.catalog_term_json(p_id uuid, p_uses bigint)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select jsonb_build_object('id', t.id, 'label', t.label, 'uses', coalesce(p_uses, 0), 'source', t.source)
    from public.catalog_terms t where t.id = p_id;
$fn$;

create or replace function private.catalog_uses_of(p_kind text, p_id uuid)
returns bigint
language sql
stable
set search_path = ''
as $fn$
  select coalesce((select u.uses from private.catalog_uses(p_kind) u where u.term_id = p_id), 0);
$fn$;

-- The "already covered" check behind catalog_check and catalog_add.
create or replace function private.catalog_check_core(p_kind text, p_text text, p_embedding text, p_min_meaning real)
returns jsonb
language plpgsql
stable
set search_path = 'public', 'extensions', 'pg_temp'
as $fn$
declare
  v_label text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_norm text := private.catalog_norm(v_label);
  v_problem text := private.catalog_problem(v_label);
  v_term public.catalog_terms;
  v_id uuid;
  v_sim real;
  v_emb extensions.vector(384);
begin
  if p_kind not in ('skill', 'category') then raise exception 'Unknown kind'; end if;
  if v_problem is not null then
    return jsonb_build_object('result', 'refused', 'reason', v_problem);
  end if;

  -- 1. The same name (any capitals, plural or "&"), or a name an admin merged away.
  select * into v_term from public.catalog_terms t where t.kind = p_kind and t.norm_key = v_norm;
  if found then
    if v_term.status = 'merged' and v_term.merged_into is not null then
      v_id := v_term.merged_into;
      if (select status from public.catalog_terms where id = v_id) <> 'live' then
        return jsonb_build_object('result', 'refused', 'reason', 'hidden');
      end if;
      return jsonb_build_object('result', 'covered', 'via', 'phrase', 'canForce', false,
        'term', private.catalog_term_json(v_id, private.catalog_uses_of(p_kind, v_id)));
    end if;
    if v_term.status <> 'live' then
      return jsonb_build_object('result', 'refused', 'reason', 'hidden');
    end if;
    return jsonb_build_object('result', 'exact',
      'term', private.catalog_term_json(v_term.id, private.catalog_uses_of(p_kind, v_term.id)));
  end if;

  -- 2. A phrase that means an existing term ("teaching maths" -> Tutoring).
  select ph.term_id into v_id
    from public.catalog_phrases ph join public.catalog_terms t on t.id = ph.term_id
   where ph.kind = p_kind and ph.norm_key = v_norm and t.status = 'live';
  if v_id is not null then
    return jsonb_build_object('result', 'covered', 'via', 'phrase', 'canForce', false,
      'term', private.catalog_term_json(v_id, private.catalog_uses_of(p_kind, v_id)));
  end if;

  -- 3. A small spelling slip ("Mehndi" / "Mehendi"). The length rule stops "Aquarium cleaning" matching "Cleaning".
  select x.term_id, x.sim into v_id, v_sim
    from (
      select t.id as term_id, similarity(t.norm_key, v_norm) as sim, t.norm_key as k
        from public.catalog_terms t where t.kind = p_kind and t.status = 'live'
      union all
      select ph.term_id, similarity(ph.norm_key, v_norm), ph.norm_key
        from public.catalog_phrases ph join public.catalog_terms t on t.id = ph.term_id
       where ph.kind = p_kind and t.status = 'live'
    ) x
   where x.sim >= 0.5 and abs(length(x.k) - length(v_norm)) <= greatest(2, length(v_norm) / 4)
   order by x.sim desc
   limit 1;
  if v_id is not null then
    return jsonb_build_object('result', 'covered', 'via', 'spelling', 'canForce', true,
      'term', private.catalog_term_json(v_id, private.catalog_uses_of(p_kind, v_id)));
  end if;

  -- 4. The same meaning, when the api could embed the text (gte-small, cosine similarity).
  if p_embedding is not null then
    v_emb := p_embedding::extensions.vector(384);
    select t.id, (1 - (t.embedding <=> v_emb))::real into v_id, v_sim
      from public.catalog_terms t
     where t.kind = p_kind and t.status = 'live' and t.embedding is not null
     order by t.embedding <=> v_emb
     limit 1;
    if v_id is not null and v_sim >= coalesce(p_min_meaning, 0.88) then
      return jsonb_build_object('result', 'covered', 'via', 'meaning', 'canForce', true, 'score', round(v_sim::numeric, 3),
        'term', private.catalog_term_json(v_id, private.catalog_uses_of(p_kind, v_id)));
    end if;
  end if;

  return jsonb_build_object('result', 'new', 'label', v_label);
end;
$fn$;

-- ------------------------------------------------------ app functions ----

-- The ranked list the pickers show: most used first, then the built-in order, then A-Z.
create or replace function public.catalog_list(p_kind text)
returns jsonb
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'label', t.label, 'uses', coalesce(u.uses, 0), 'source', t.source)
           order by coalesce(u.uses, 0) desc, (t.source = 'builtin') desc, t.builtin_order nulls last, lower(t.label)), '[]'::jsonb)
    from public.catalog_terms t
    left join private.catalog_uses(p_kind) u on u.term_id = t.id
   where t.kind = p_kind and t.status = 'live' and auth.uid() is not null;
$fn$;

create or replace function public.catalog_check(p_kind text, p_text text, p_embedding text default null, p_min_meaning real default 0.88)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  return private.catalog_check_core(p_kind, left(coalesce(p_text, ''), 60), p_embedding, p_min_meaning);
end;
$fn$;

-- Adds a new term when nothing covers it. `p_force` is the "My skill is something different" tap: allowed for a
-- spelling or meaning match, never for the same name or a phrase an admin set.
create or replace function public.catalog_add(p_kind text, p_text text, p_embedding text default null,
                                              p_force boolean default false, p_min_meaning real default 0.88)
returns jsonb
language plpgsql
security definer
set search_path = 'public', 'extensions', 'pg_temp'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_check jsonb;
  v_label text := btrim(regexp_replace(left(coalesce(p_text, ''), 60), '\s+', ' ', 'g'));
  v_id uuid;
begin
  if v_uid is null then raise exception 'Sign in first'; end if;
  v_check := private.catalog_check_core(p_kind, v_label, p_embedding, p_min_meaning);
  if v_check ->> 'result' in ('refused', 'exact') then return v_check; end if;
  if v_check ->> 'result' = 'covered' and not (coalesce(p_force, false) and (v_check ->> 'canForce')::boolean) then
    return v_check;
  end if;

  if (select count(*) from public.catalog_terms where created_by = v_uid and created_at > now() - interval '24 hours') >= 10 then
    raise exception 'catalog_daily_limit';
  end if;

  -- First letter capital, the rest as typed ("aquarium cleaning" -> "Aquarium cleaning").
  v_label := upper(left(v_label, 1)) || substr(v_label, 2);
  insert into public.catalog_terms (kind, label, norm_key, source, created_by, embedding)
  values (p_kind, v_label, private.catalog_norm(v_label), 'user', v_uid,
          case when p_embedding is null then null else p_embedding::extensions.vector(384) end)
  on conflict (kind, norm_key) do nothing
  returning id into v_id;
  if v_id is null then
    -- Someone added the same name a moment ago: use theirs.
    return private.catalog_check_core(p_kind, v_label, null, p_min_meaning);
  end if;
  return jsonb_build_object('result', 'added', 'term', private.catalog_term_json(v_id, 0));
end;
$fn$;

revoke all on function public.catalog_list(text) from public, anon;
revoke all on function public.catalog_check(text, text, text, real) from public, anon;
revoke all on function public.catalog_add(text, text, text, boolean, real) from public, anon;
grant execute on function public.catalog_list(text) to authenticated;
grant execute on function public.catalog_check(text, text, text, real) to authenticated;
grant execute on function public.catalog_add(text, text, text, boolean, real) to authenticated;

-- ----------------------------------------------- embeddings (api only) ----

-- Terms with no meaning vector yet (new built-ins, renamed ones, ones with new phrases). The text is the label
-- plus its phrases, so "Tutoring" carries "teaching maths, home tuition".
create or replace function public.catalog_embedding_todo(p_limit int default 3)
returns table (id uuid, text text)
language sql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
  select t.id,
         t.label || coalesce('. ' || (select string_agg(ph.phrase, ', ' order by ph.created_at)
                                        from public.catalog_phrases ph where ph.term_id = t.id), '')
    from public.catalog_terms t
   where t.status = 'live' and t.embedding is null
   order by (t.source = 'builtin') desc, t.created_at
   limit least(greatest(coalesce(p_limit, 3), 1), 20);
$fn$;

create or replace function public.catalog_set_embedding(p_id uuid, p_embedding text)
returns void
language sql
security definer
set search_path = 'public', 'extensions', 'pg_temp'
as $fn$
  update public.catalog_terms set embedding = p_embedding::extensions.vector(384) where id = p_id;
$fn$;

revoke all on function public.catalog_embedding_todo(int) from public, anon, authenticated;
revoke all on function public.catalog_set_embedding(uuid, text) from public, anon, authenticated;
grant execute on function public.catalog_embedding_todo(int) to service_role;
grant execute on function public.catalog_set_embedding(uuid, text) to service_role;

-- ------------------------------------------ older app builds (trigger) ----

-- An app build from before this change still saves free-text skills. Register any name the list doesn't know,
-- so it is counted and can be merged; one with a problem is added hidden.
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

drop trigger if exists catalog_register_skills on public.profiles;
create trigger catalog_register_skills
  after insert or update of skills on public.profiles
  for each row
  when (cardinality(new.skills) > 0)
  execute function private.catalog_register_skills();

-- ------------------------------------------------------ admin functions ----

create or replace function private.catalog_rewrite_uses(p_kind text, p_from_norm text, p_to_label text)
returns bigint
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_n bigint := 0;
begin
  if p_kind = 'skill' then
    -- Swap the old name for the new one and drop a second copy of the same skill, keeping the order.
    with changed as (
      update public.profiles p
         set skills = (
           select coalesce(array_agg(x.v order by x.o), '{}')
             from (
               select distinct on (private.catalog_norm(m.v)) m.v, m.o
                 from (
                   select case when private.catalog_norm(s) = p_from_norm then p_to_label else s end as v, o
                     from unnest(p.skills) with ordinality as u (s, o)
                 ) m
                order by private.catalog_norm(m.v), m.o
             ) x
         )
       where exists (select 1 from unnest(p.skills) s where private.catalog_norm(s) = p_from_norm)
      returning 1
    )
    select count(*) into v_n from changed;
  else
    with changed as (
      update public.tasks t set category = p_to_label, updated_at = now()
       where t.category is not null and private.catalog_norm(t.category) = p_from_norm
      returning 1
    )
    select count(*) into v_n from changed;
  end if;
  return v_n;
end;
$fn$;

create or replace function public.admin_catalog_list(p_kind text)
returns jsonb
language plpgsql
stable
security definer
set search_path = 'public', 'pg_temp'
as $fn$
begin
  perform private.require_people_staff();
  return (
    with u as (select * from private.catalog_uses(p_kind)),
    ranked as (
      select t.*, coalesce(u.uses, 0) as uses,
             case when t.status = 'live' then
               row_number() over (partition by (t.status = 'live')
                                  order by coalesce(u.uses, 0) desc, (t.source = 'builtin') desc, t.builtin_order nulls last, lower(t.label))
             end as rank
        from public.catalog_terms t left join u on u.term_id = t.id
       where t.kind = p_kind and t.status <> 'merged'
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'id', r.id, 'label', r.label, 'status', r.status, 'source', r.source, 'uses', r.uses, 'rank', r.rank,
             'created_at', r.created_at,
             'created_by_name', (select coalesce(nullif(pr.display_name, ''), pr.username) from public.profiles pr where pr.id = r.created_by),
             'phrases', (select coalesce(jsonb_agg(jsonb_build_object('id', ph.id, 'phrase', ph.phrase) order by ph.created_at), '[]'::jsonb)
                           from public.catalog_phrases ph where ph.term_id = r.id),
             'merged_labels', (select coalesce(jsonb_agg(m.label order by m.label), '[]'::jsonb)
                                 from public.catalog_terms m where m.merged_into = r.id and m.status = 'merged')
           ) order by r.rank nulls last, lower(r.label)), '[]'::jsonb)
      from ranked r
  );
end;
$fn$;

create or replace function public.admin_catalog_rename(p_id uuid, p_label text)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_term public.catalog_terms;
  v_label text := btrim(regexp_replace(coalesce(p_label, ''), '\s+', ' ', 'g'));
  v_norm text := private.catalog_norm(v_label);
  v_problem text := private.catalog_problem(v_label);
  v_other uuid;
begin
  perform private.require_people_staff();
  select * into v_term from public.catalog_terms where id = p_id and status <> 'merged' for update;
  if not found then raise exception 'That skill no longer exists'; end if;
  if v_problem is not null then raise exception 'That name can''t be used (%)', v_problem; end if;
  v_other := private.catalog_resolve(v_term.kind, v_norm);
  if v_other is not null and v_other <> p_id then
    raise exception 'That name is already used. Merge the two instead.';
  end if;
  if v_norm = v_term.norm_key and v_label = v_term.label then return; end if;
  -- A phrase of this same term with the new name is no longer needed.
  delete from public.catalog_phrases where term_id = p_id and norm_key = v_norm;
  update public.catalog_terms set label = v_label, norm_key = v_norm, embedding = null, updated_at = now() where id = p_id;
  perform private.catalog_rewrite_uses(v_term.kind, v_term.norm_key, v_label);
  perform public.admin_log_event('catalog.rename', p_id::text, format('%s -> %s', v_term.label, v_label));
end;
$fn$;

create or replace function public.admin_catalog_merge(p_from uuid, p_to uuid)
returns bigint
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_from public.catalog_terms;
  v_to public.catalog_terms;
  v_n bigint;
begin
  perform private.require_people_staff();
  if p_from = p_to then raise exception 'Pick a different one to merge into'; end if;
  select * into v_from from public.catalog_terms where id = p_from and status <> 'merged' for update;
  select * into v_to from public.catalog_terms where id = p_to and status = 'live' for update;
  if v_from.id is null or v_to.id is null then raise exception 'That skill no longer exists'; end if;
  if v_from.kind <> v_to.kind then raise exception 'A skill can only merge into a skill, a category into a category'; end if;
  if v_from.source = 'builtin' then raise exception 'A built-in one can''t be merged away. Rename it instead.'; end if;

  -- Every name that pointed at "from" now points at "to".
  update public.catalog_terms set merged_into = p_to, updated_at = now() where merged_into = p_from;
  update public.catalog_phrases set term_id = p_to where term_id = p_from;
  update public.catalog_terms set status = 'merged', merged_into = p_to, embedding = null, updated_at = now() where id = p_from;
  update public.catalog_terms set embedding = null, updated_at = now() where id = p_to;

  v_n := private.catalog_rewrite_uses(v_from.kind, v_from.norm_key, v_to.label);
  perform public.admin_log_event('catalog.merge', p_from::text, format('%s -> %s (%s changed)', v_from.label, v_to.label, v_n));
  return v_n;
end;
$fn$;

create or replace function public.admin_catalog_set_hidden(p_id uuid, p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_term public.catalog_terms;
begin
  perform private.require_people_staff();
  select * into v_term from public.catalog_terms where id = p_id and status <> 'merged' for update;
  if not found then raise exception 'That skill no longer exists'; end if;
  if v_term.source = 'builtin' and p_hidden then raise exception 'A built-in one can''t be hidden. Rename it instead.'; end if;
  update public.catalog_terms set status = case when p_hidden then 'hidden' else 'live' end, updated_at = now() where id = p_id;
  perform public.admin_log_event(case when p_hidden then 'catalog.hide' else 'catalog.unhide' end, p_id::text, v_term.label);
end;
$fn$;

create or replace function public.admin_catalog_add_phrase(p_id uuid, p_phrase text)
returns uuid
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_term public.catalog_terms;
  v_phrase text := btrim(regexp_replace(coalesce(p_phrase, ''), '\s+', ' ', 'g'));
  v_norm text := private.catalog_norm(v_phrase);
  v_other uuid;
  v_id uuid;
begin
  perform private.require_people_staff();
  select * into v_term from public.catalog_terms where id = p_id and status = 'live';
  if not found then raise exception 'That skill no longer exists'; end if;
  if v_norm = '' or char_length(v_phrase) < 2 or char_length(v_phrase) > 60 then raise exception 'Type 2 to 60 letters'; end if;
  v_other := private.catalog_resolve(v_term.kind, v_norm);
  if v_other = p_id then return null; end if;
  if v_other is not null then
    raise exception 'That phrase already belongs to "%". Merge them instead.', (select label from public.catalog_terms where id = v_other);
  end if;
  insert into public.catalog_phrases (term_id, kind, phrase, norm_key, created_by)
  values (p_id, v_term.kind, v_phrase, v_norm, auth.uid()) returning id into v_id;
  update public.catalog_terms set embedding = null, updated_at = now() where id = p_id;
  perform public.admin_log_event('catalog.phrase_add', p_id::text, format('%s: %s', v_term.label, v_phrase));
  return v_id;
end;
$fn$;

create or replace function public.admin_catalog_remove_phrase(p_phrase_id uuid)
returns void
language plpgsql
security definer
set search_path = 'public', 'pg_temp'
as $fn$
declare
  v_term uuid;
  v_phrase text;
begin
  perform private.require_people_staff();
  delete from public.catalog_phrases where id = p_phrase_id returning term_id, phrase into v_term, v_phrase;
  if v_term is null then return; end if;
  update public.catalog_terms set embedding = null, updated_at = now() where id = v_term;
  perform public.admin_log_event('catalog.phrase_remove', v_term::text, v_phrase);
end;
$fn$;

revoke all on function public.admin_catalog_list(text) from public, anon;
revoke all on function public.admin_catalog_rename(uuid, text) from public, anon;
revoke all on function public.admin_catalog_merge(uuid, uuid) from public, anon;
revoke all on function public.admin_catalog_set_hidden(uuid, boolean) from public, anon;
revoke all on function public.admin_catalog_add_phrase(uuid, text) from public, anon;
revoke all on function public.admin_catalog_remove_phrase(uuid) from public, anon;
grant execute on function public.admin_catalog_list(text) to authenticated;
grant execute on function public.admin_catalog_rename(uuid, text) to authenticated;
grant execute on function public.admin_catalog_merge(uuid, uuid) to authenticated;
grant execute on function public.admin_catalog_set_hidden(uuid, boolean) to authenticated;
grant execute on function public.admin_catalog_add_phrase(uuid, text) to authenticated;
grant execute on function public.admin_catalog_remove_phrase(uuid) to authenticated;

revoke all on function private.catalog_norm(text) from public;
revoke all on function private.catalog_problem(text) from public;
revoke all on function private.catalog_resolve(text, text) from public;
revoke all on function private.catalog_uses(text) from public;
revoke all on function private.catalog_term_json(uuid, bigint) from public;
revoke all on function private.catalog_uses_of(text, uuid) from public;
revoke all on function private.catalog_check_core(text, text, text, real) from public;
revoke all on function private.catalog_register_skills() from public;
revoke all on function private.catalog_rewrite_uses(text, text, text) from public;

-- ---------------------------------------------------------------- seeds ----

-- The app's built-in lists (ProfileEditScreen SKILL_OPTIONS, lib/taskBrief CATEGORIES), in their order.
insert into public.catalog_terms (kind, label, norm_key, source, builtin_order)
select 'skill', l, private.catalog_norm(l), 'builtin', o
  from unnest(array[
    'Repairs', 'Delivery', 'Errands', 'Sourcing', 'Local intel', 'Cleaning', 'Carpentry', 'Painting',
    'Photography', 'Video editing', 'Graphic design', 'Content writing', 'Data entry', 'Tutoring',
    'Web development', 'Career coaching', 'Event planning', 'Translation', 'Research'
  ]) with ordinality as s (l, o)
on conflict (kind, norm_key) do update set source = 'builtin', builtin_order = excluded.builtin_order;

insert into public.catalog_terms (kind, label, norm_key, source, builtin_order)
select 'category', l, private.catalog_norm(l), 'builtin', o
  from unnest(array[
    'Home Services', 'Repairs & Maintenance', 'Errands & Delivery', 'Shopping & Sourcing', 'Local Checks & Info',
    'Tech & Websites', 'Design & Creative', 'Writing & Content', 'Photo & Video', 'Tutoring & Education',
    'Career & Resume', 'Business & Consulting', 'Events & Planning', 'Admin & Data Entry', 'Other'
  ]) with ordinality as s (l, o)
on conflict (kind, norm_key) do update set source = 'builtin', builtin_order = excluded.builtin_order;

-- Other words for the built-ins, so "Teaching maths" is steered to Tutoring. Admins add more on the
-- Skills & categories page.
insert into public.catalog_phrases (term_id, kind, phrase, norm_key)
select t.id, x.kind, x.phrase, private.catalog_norm(x.phrase)
  from (values
    ('skill', 'Repairs', 'fixing taps'), ('skill', 'Repairs', 'fan repair'), ('skill', 'Repairs', 'appliance repair'),
    ('skill', 'Repairs', 'mobile repair'), ('skill', 'Repairs', 'fixing things'), ('skill', 'Repairs', 'repair work'),
    ('skill', 'Repairs', 'mistri'),
    ('skill', 'Delivery', 'courier'), ('skill', 'Delivery', 'parcel delivery'), ('skill', 'Delivery', 'pickup and drop'),
    ('skill', 'Delivery', 'delivery boy'), ('skill', 'Delivery', 'food delivery'),
    ('skill', 'Errands', 'running errands'), ('skill', 'Errands', 'queue standing'), ('skill', 'Errands', 'standing in line'),
    ('skill', 'Errands', 'bill payment'), ('skill', 'Errands', 'odd jobs'),
    ('skill', 'Sourcing', 'finding products'), ('skill', 'Sourcing', 'buying for others'), ('skill', 'Sourcing', 'product sourcing'),
    ('skill', 'Local intel', 'local information'), ('skill', 'Local intel', 'checking a place'), ('skill', 'Local intel', 'site visit'),
    ('skill', 'Local intel', 'property check'),
    ('skill', 'Cleaning', 'house cleaning'), ('skill', 'Cleaning', 'home cleaning'), ('skill', 'Cleaning', 'deep cleaning'),
    ('skill', 'Cleaning', 'maid'), ('skill', 'Cleaning', 'bai'), ('skill', 'Cleaning', 'kaamwali'), ('skill', 'Cleaning', 'housekeeping'),
    ('skill', 'Cleaning', 'jhadu pocha'), ('skill', 'Cleaning', 'sweeping and mopping'),
    ('skill', 'Carpentry', 'woodwork'), ('skill', 'Carpentry', 'furniture repair'), ('skill', 'Carpentry', 'carpenter'),
    ('skill', 'Carpentry', 'furniture assembly'),
    ('skill', 'Painting', 'wall painting'), ('skill', 'Painting', 'house painting'), ('skill', 'Painting', 'painter'),
    ('skill', 'Photography', 'photo shoot'), ('skill', 'Photography', 'photographer'), ('skill', 'Photography', 'taking photos'),
    ('skill', 'Photography', 'event photography'),
    ('skill', 'Video editing', 'reels editing'), ('skill', 'Video editing', 'youtube editing'), ('skill', 'Video editing', 'editing videos'),
    ('skill', 'Video editing', 'video editor'),
    ('skill', 'Graphic design', 'logo making'), ('skill', 'Graphic design', 'poster design'), ('skill', 'Graphic design', 'banner design'),
    ('skill', 'Graphic design', 'graphic designer'), ('skill', 'Graphic design', 'thumbnail design'),
    ('skill', 'Content writing', 'blog writing'), ('skill', 'Content writing', 'article writing'), ('skill', 'Content writing', 'copywriting'),
    ('skill', 'Content writing', 'content writer'),
    ('skill', 'Data entry', 'typing'), ('skill', 'Data entry', 'typing work'), ('skill', 'Data entry', 'form filling'),
    ('skill', 'Data entry', 'copy paste work'),
    ('skill', 'Tutoring', 'teaching maths'), ('skill', 'Tutoring', 'teaching math'), ('skill', 'Tutoring', 'maths tuition'),
    ('skill', 'Tutoring', 'maths teacher'), ('skill', 'Tutoring', 'home tuition'), ('skill', 'Tutoring', 'tuition'),
    ('skill', 'Tutoring', 'tuition teacher'), ('skill', 'Tutoring', 'teaching'), ('skill', 'Tutoring', 'teacher'),
    ('skill', 'Tutoring', 'tutor'), ('skill', 'Tutoring', 'teaching science'), ('skill', 'Tutoring', 'teaching english'),
    ('skill', 'Tutoring', 'coaching classes'), ('skill', 'Tutoring', 'homework help'), ('skill', 'Tutoring', 'online classes'),
    ('skill', 'Web development', 'website making'), ('skill', 'Web development', 'website design'), ('skill', 'Web development', 'web developer'),
    ('skill', 'Web development', 'making websites'), ('skill', 'Web development', 'website development'),
    ('skill', 'Career coaching', 'career guidance'), ('skill', 'Career coaching', 'career counselling'), ('skill', 'Career coaching', 'career advice'),
    ('skill', 'Event planning', 'party planning'), ('skill', 'Event planning', 'event management'), ('skill', 'Event planning', 'wedding planning'),
    ('skill', 'Event planning', 'birthday party planning'),
    ('skill', 'Translation', 'translator'), ('skill', 'Translation', 'hindi to english'), ('skill', 'Translation', 'english to hindi'),
    ('skill', 'Translation', 'language translation'),
    ('skill', 'Research', 'online research'), ('skill', 'Research', 'market research'), ('skill', 'Research', 'finding information'),
    ('category', 'Home Services', 'house work'), ('category', 'Home Services', 'home help'), ('category', 'Home Services', 'household work'),
    ('category', 'Repairs & Maintenance', 'fan not working'), ('category', 'Repairs & Maintenance', 'fixing'), ('category', 'Repairs & Maintenance', 'repair'),
    ('category', 'Repairs & Maintenance', 'plumbing'), ('category', 'Repairs & Maintenance', 'electrical work'), ('category', 'Repairs & Maintenance', 'appliance repair'),
    ('category', 'Errands & Delivery', 'courier'), ('category', 'Errands & Delivery', 'pickup and drop'), ('category', 'Errands & Delivery', 'parcel'),
    ('category', 'Shopping & Sourcing', 'buy something'), ('category', 'Shopping & Sourcing', 'shopping'), ('category', 'Shopping & Sourcing', 'groceries'),
    ('category', 'Local Checks & Info', 'check a place'), ('category', 'Local Checks & Info', 'local information'), ('category', 'Local Checks & Info', 'site visit'),
    ('category', 'Tech & Websites', 'website'), ('category', 'Tech & Websites', 'app'), ('category', 'Tech & Websites', 'computer help'),
    ('category', 'Tech & Websites', 'laptop slow'),
    ('category', 'Design & Creative', 'logo'), ('category', 'Design & Creative', 'poster'), ('category', 'Design & Creative', 'graphic design'),
    ('category', 'Writing & Content', 'writing'), ('category', 'Writing & Content', 'blog'), ('category', 'Writing & Content', 'content'),
    ('category', 'Photo & Video', 'photography'), ('category', 'Photo & Video', 'video editing'), ('category', 'Photo & Video', 'photo shoot'),
    ('category', 'Tutoring & Education', 'tuition'), ('category', 'Tutoring & Education', 'teaching'), ('category', 'Tutoring & Education', 'classes'),
    ('category', 'Career & Resume', 'resume'), ('category', 'Career & Resume', 'cv'), ('category', 'Career & Resume', 'interview prep'),
    ('category', 'Business & Consulting', 'business advice'), ('category', 'Business & Consulting', 'consulting'), ('category', 'Business & Consulting', 'gst help'),
    ('category', 'Events & Planning', 'party'), ('category', 'Events & Planning', 'wedding'), ('category', 'Events & Planning', 'event'),
    ('category', 'Admin & Data Entry', 'data entry'), ('category', 'Admin & Data Entry', 'typing'), ('category', 'Admin & Data Entry', 'excel work')
  ) as x (kind, term, phrase)
  join public.catalog_terms t on t.kind = x.kind and t.norm_key = private.catalog_norm(x.term)
on conflict (kind, norm_key) do nothing;

-- Skills people already typed on their profiles become shared skills ("stored under Others"), so nothing is lost.
insert into public.catalog_terms (kind, label, norm_key, source, status, created_by)
select distinct on (private.catalog_norm(s.label)) 'skill', s.label, private.catalog_norm(s.label), 'user',
       case when private.catalog_problem(s.label) is null then 'live' else 'hidden' end, s.who
  from (
    select btrim(regexp_replace(left(sk, 40), '\s+', ' ', 'g')) as label, p.id as who, p.created_at
      from public.profiles p cross join lateral unnest(p.skills) sk
     where p.deleted_at is null
  ) s
 where char_length(s.label) >= 2 and private.catalog_norm(s.label) <> ''
   and private.catalog_resolve('skill', private.catalog_norm(s.label)) is null
 order by private.catalog_norm(s.label), s.created_at
on conflict (kind, norm_key) do nothing;

-- Categories already on tasks, the same way.
insert into public.catalog_terms (kind, label, norm_key, source, status)
select distinct on (private.catalog_norm(c.label)) 'category', c.label, private.catalog_norm(c.label), 'user',
       case when private.catalog_problem(c.label) is null then 'live' else 'hidden' end
  from (
    select btrim(regexp_replace(left(t.category, 40), '\s+', ' ', 'g')) as label, t.created_at
      from public.tasks t where t.category is not null
  ) c
 where char_length(c.label) >= 2 and private.catalog_norm(c.label) <> ''
   and private.catalog_resolve('category', private.catalog_norm(c.label)) is null
 order by private.catalog_norm(c.label), c.created_at
on conflict (kind, norm_key) do nothing;
