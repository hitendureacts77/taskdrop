-- 223: smart search (plan 1.19 row D).
--
-- Search used to be `title ilike %q% or description ilike %q%`: only posts holding the exact words typed.
-- This adds what the api needs to rank open posts by what the searcher means:
--   * words: an English full-text index over title (A), category (B) and description (C);
--   * spelling slips: a trigram index over the title;
--   * meaning: a 384-number "fingerprint" per post (Supabase's built-in gte-small model, made in the api Edge
--     Function), kept in its own table so the tasks table, its triggers and updated_at are untouched, and so no
--     poster can write their own post's fingerprint to game the ranking (only the service role writes it).
-- search_posts() answers ids and scores only; the api then reads the rows the usual way (row level security for
-- members, guest_open_posts(p_ids) for guests), so what anyone may see is decided exactly where it was before.
-- Nothing existing is changed or deleted.

create extension if not exists vector with schema extensions;
create extension if not exists pg_trgm with schema extensions;

-- The text a post is searched by, in one place, so the index and the queries use the very same expression.
create or replace function public.task_search_doc(p_title text, p_category text, p_description text)
returns tsvector
language sql
immutable
parallel safe
set search_path = ''
as $$
  select setweight(to_tsvector('english'::regconfig, coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('english'::regconfig, coalesce(p_category, '')), 'B')
      || setweight(to_tsvector('english'::regconfig, coalesce(p_description, '')), 'C')
$$;

-- What a fingerprint was made from. When the post's words change the hash no longer matches, and the old
-- fingerprint is ignored until a new one is made.
create or replace function public.task_search_hash(p_title text, p_category text, p_description text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select md5(coalesce(p_title, '') || '|' || coalesce(p_category, '') || '|' || coalesce(p_description, ''))
$$;

-- The search index runs these whenever a signed-in person adds or edits a post, so members keep them; nobody signed
-- out may run them.
revoke all on function public.task_search_doc(text, text, text) from public, anon;
revoke all on function public.task_search_hash(text, text, text) from public, anon;
grant execute on function public.task_search_doc(text, text, text) to authenticated, service_role;
grant execute on function public.task_search_hash(text, text, text) to authenticated, service_role;

create index if not exists tasks_search_fts_idx on public.tasks
  using gin (public.task_search_doc(title, category, description));
create index if not exists tasks_title_trgm_idx on public.tasks
  using gin (title extensions.gin_trgm_ops);

create table if not exists public.task_embeddings (
  task_id     uuid primary key references public.tasks(id) on delete cascade,
  embedding   extensions.vector(384) not null,
  source_hash text not null,
  model       text not null default 'gte-small',
  made_at     timestamptz not null default now()
);
create index if not exists task_embeddings_hnsw_idx on public.task_embeddings
  using hnsw (embedding extensions.vector_cosine_ops);

-- Service role only: no policies, so members and guests read and write nothing here.
alter table public.task_embeddings enable row level security;
revoke all on public.task_embeddings from anon, authenticated;

/**
 * Ranked open posts for a search. Returns ids and scores only.
 *
 * Candidates come from three places: posts holding any of the words (full-text), posts whose title is close to
 * what was typed (trigram, for spelling slips), and the posts nearest in meaning (fingerprints). Each is scored
 *   0.50 meaning + 0.30 words + 0.10 spelling + 0.10 freshness (halves about every 10 days)
 * and kept only when it matches on words, on spelling, or on meaning above the threshold (settings.search_semantic_min). Distance stays a hard
 * box here; the api applies the exact radius and a small nearness tie-break.
 *
 * p_words are the searcher's own words, p_expanded the words they stand for ("nal" -> tap, plumber); a match on
 * the searcher's own words counts about twice as much. Both are cleaned to plain letters and digits here.
 */
create or replace function public.search_posts(
  p_kind          text,
  p_words         text[],
  p_expanded      text[]  default null,
  p_raw           text    default null,
  p_embedding     text    default null,
  p_viewer        uuid    default null,
  p_pillar        text    default null,
  p_min_minor     bigint  default null,
  p_max_minor     bigint  default null,
  p_min_lat       double precision default null,
  p_max_lat       double precision default null,
  p_min_lng       double precision default null,
  p_max_lng       double precision default null,
  p_semantic_min  real    default null,
  p_limit         integer default 60
)
returns table (id uuid, score real, lexical real, semantic real, typo real)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  v_words    text;
  v_expanded text;
  q_words    tsquery;
  q_exp      tsquery;
  q_all      tsquery;
  v_emb      extensions.vector(384);
  v_raw      text := nullif(btrim(lower(coalesce(p_raw, ''))), '');
  v_limit    integer := least(greatest(coalesce(p_limit, 60), 1), 200);
  v_min      real;
begin
  -- How close in meaning counts as a match: the caller's value, else settings.search_semantic_min, else 0.80.
  select coalesce(p_semantic_min, (select (s.value #>> '{}')::real from settings s where s.key = 'search_semantic_min'), 0.80)
    into v_min;
  v_min := least(greatest(v_min, 0.5), 0.99);

  -- Who is calling. A signed-in person always searches as themself (their own posts left out, whatever viewer was
  -- passed); nobody signed out may call this. Only the service role (the api answering a guest, whose rows then
  -- come through guest_open_posts) may search with no viewer.
  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'Sign in to search' using errcode = '42501';
    end if;
    p_viewer := auth.uid();
  end if;
  select string_agg(w, ' | ') into v_words
    from (select distinct regexp_replace(lower(x), '[^a-z0-9]', '', 'g') as w
            from unnest(coalesce(p_words, '{}'::text[])) as u(phrase),
                 regexp_split_to_table(u.phrase, '\s+') as x) s
   where length(w) between 2 and 40;
  select string_agg(w, ' | ') into v_expanded
    from (select distinct regexp_replace(lower(x), '[^a-z0-9]', '', 'g') as w
            from unnest(coalesce(p_expanded, '{}'::text[])) as u(phrase),
                 regexp_split_to_table(u.phrase, '\s+') as x) s
   where length(w) between 2 and 40;

  if v_words is not null then q_words := to_tsquery('english', v_words); end if;
  if v_expanded is not null then q_exp := to_tsquery('english', v_expanded); end if;
  q_all := case
    when q_words is not null and q_exp is not null then q_words || q_exp
    else coalesce(q_words, q_exp)
  end;
  if p_embedding is not null then v_emb := p_embedding::extensions.vector(384); end if;
  -- Let the meaning index keep scanning past rows the filters drop (pgvector 0.8).
  perform set_config('hnsw.iterative_scan', 'relaxed_order', true);

  return query
  with vis as (
    select t.id, t.title, t.category, t.description, t.created_at
      from tasks t
     where t.status = 'OPEN'
       and t.kind::text = p_kind
       and (t.due_at is null or t.due_at > now())
       and (t.hunt_until is null or t.hunt_until > now())
       and (p_viewer is null or t.poster_id <> p_viewer)
       and (p_pillar is null or t.pillar::text = p_pillar)
       and (p_min_minor is null or t.benchmark_minor >= p_min_minor)
       and (p_max_minor is null or t.benchmark_minor <= p_max_minor)
       and (p_min_lat is null or (t.loc_lat between p_min_lat and p_max_lat
            and (p_min_lng is null or t.loc_lng between p_min_lng and p_max_lng)))
  ),
  lex_c as (
    select v.id from vis v
     where q_all is not null and task_search_doc(v.title, v.category, v.description) @@ q_all
     limit 400
  ),
  tri_c as (
    select v.id from vis v
     where v_raw is not null and v_raw <% lower(v.title)
     limit 100
  ),
  sem_c as (
    select e.task_id as id
      from task_embeddings e
      join vis v on v.id = e.task_id
     where v_emb is not null
     order by e.embedding <=> v_emb
     limit 150
  ),
  cand as (
    select c.id from lex_c c union select c.id from tri_c c union select c.id from sem_c c
  ),
  scored as (
    select v.id,
           -- Normalised to 0-1 (rank / (rank + 1)); the searcher's own words count about twice the words they stand for.
           (0.65 * case when q_words is not null then ts_rank_cd(task_search_doc(v.title, v.category, v.description), q_words, 32) else 0 end
            + 0.35 * case when q_exp is not null then ts_rank_cd(task_search_doc(v.title, v.category, v.description), q_exp, 32) else 0 end)::real as lex,
           (case when v_emb is not null and e.source_hash = task_search_hash(v.title, v.category, v.description)
                 then 1 - (e.embedding <=> v_emb) else null end)::real as sem,
           (case when v_raw is not null then word_similarity(v_raw, lower(v.title)) else 0 end)::real as tri,
           exp(-extract(epoch from (now() - v.created_at)) / 86400.0 / 14.0)::real as fresh
      from cand c
      join vis v on v.id = c.id
      left join task_embeddings e on e.task_id = v.id
  ),
  kept as (
    select s.*, max(s.lex) over () as lex_max
      from scored s
     where s.lex > 0 or s.tri >= 0.5 or coalesce(s.sem, 0) >= v_min
  )
  select k.id,
         (0.50 * greatest(0, least(1, (coalesce(k.sem, 0) - v_min) / greatest(1 - v_min, 0.01)))
          + 0.30 * case when k.lex_max > 0 then k.lex / k.lex_max else 0 end
          + 0.10 * k.tri
          + 0.10 * k.fresh)::real as score,
         k.lex, k.sem, k.tri
    from kept k
   order by 2 desc
   limit v_limit;
end;
$$;

revoke all on function public.search_posts(text, text[], text[], text, text, uuid, text, bigint, bigint, double precision, double precision, double precision, double precision, real, integer) from public, anon;
grant execute on function public.search_posts(text, text[], text[], text, text, uuid, text, bigint, bigint, double precision, double precision, double precision, double precision, real, integer) to authenticated, service_role;

/** Open posts whose fingerprint is missing or out of date, oldest first, for the api to fill. Service role only. */
create or replace function public.posts_needing_embedding(p_limit integer default 10)
returns table (id uuid, title text, category text, description text, source_hash text)
language sql
stable
security definer
set search_path = public
as $$
  select t.id, t.title, t.category, t.description, task_search_hash(t.title, t.category, t.description)
    from tasks t
    left join task_embeddings e on e.task_id = t.id
   where t.status = 'OPEN'
     and (t.due_at is null or t.due_at > now())
     and (e.task_id is null or e.source_hash <> task_search_hash(t.title, t.category, t.description))
   order by t.created_at desc
   limit least(greatest(coalesce(p_limit, 10), 1), 50)
$$;
revoke all on function public.posts_needing_embedding(integer) from public, anon, authenticated;
grant execute on function public.posts_needing_embedding(integer) to service_role;

-- How close in meaning counts as a match (0-1). Staff can tune it here without a deploy.
insert into public.settings (key, value) values ('search_semantic_min', to_jsonb(0.80))
  on conflict (key) do nothing;
