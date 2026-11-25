-- Removes everything supabase/seed/fake_world.sql made (staging only).
-- That is the 120 fake people and all they own, and the rows added to the 8074413313 account (ids fa4e0009-).
-- Rows real people made by hand are kept. The account's star ratings are worked out again afterwards.
begin;
set local session_replication_role = replica;
do $purge$
declare t record; cond text;
begin
  delete from auth.refresh_tokens where user_id like 'fa4e000%';
  delete from auth.mfa_amr_claims where session_id in (select id from auth.sessions where user_id::text like 'fa4e000%');
  for t in
    with fk as (
      select c.conrelid as rel, a.attname::text as col
        from pg_constraint c
        join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       where c.contype = 'f' and cardinality(c.conkey) = 1 and a.atttypid = 'uuid'::regtype
         and c.confrelid in ('auth.users'::regclass, 'public.profiles'::regclass, 'public.tasks'::regclass)
    ), ids as (
      select k.oid as rel
        from pg_class k join pg_namespace n on n.oid = k.relnamespace
        join pg_attribute a on a.attrelid = k.oid and a.attname = 'id' and a.atttypid = 'uuid'::regtype and not a.attisdropped
       where n.nspname = 'public' and k.relkind = 'r'
    )
    select r.rel::regclass as rel, exists (select 1 from ids where ids.rel = r.rel) as has_id,
           (select array_agg(distinct fk.col) from fk where fk.rel = r.rel) as cols
      from (select rel from fk union select rel from ids) r
  loop
    cond := null;
    if t.cols is not null then
      cond := format('((%s) and (%s))',
        (select string_agg(format('%I::text like %L', c, 'fa4e000%'), ' or ') from unnest(t.cols) c),
        (select string_agg(format('(%I is null or %I::text like %L)', c, c, 'fa4e000%'), ' and ') from unnest(t.cols) c));
    end if;
    if t.has_id then
      cond := concat_ws(' or ', format('id::text like %L', 'fa4e000%'), cond);
    end if;
    execute format('delete from %s where %s', t.rel, cond);
  end loop;
  delete from auth.users where id::text like 'fa4e000%';
end
$purge$;
update public.profiles p set
  worker_rating_avg   = coalesce((select round(avg(rating), 2) from public.reviews r where r.subject_id = p.id and r.about_role = 'worker'), 0),
  worker_rating_count = (select count(*) from public.reviews r where r.subject_id = p.id and r.about_role = 'worker'),
  poster_rating_avg   = coalesce((select round(avg(rating), 2) from public.reviews r where r.subject_id = p.id and r.about_role = 'poster'), 0),
  poster_rating_count = (select count(*) from public.reviews r where r.subject_id = p.id and r.about_role = 'poster')
where p.id = 'ec7ca544-48d7-403d-9f54-bcd7312abbd9';
commit;
