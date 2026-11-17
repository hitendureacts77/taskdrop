-- 190: database checks on a task's words and a video's length (round 8: S2-12, S1-12, S4-21).
--
-- `tasks` is writable straight through the REST door (column grant + tasks_insert_own), so the api's
-- limits can be walked around. The table itself now refuses a blank or oversized title, a description
-- over 20,000 characters (the api's own cut) and a video longer than 60 seconds (packages/rules MEDIA).
--
-- Each check is added only when every existing row already passes (live data was clean on 17 Nov), so an
-- old row is never rewritten or locked out of a later update. Safe to run twice. Additive: nothing is
-- dropped or renamed (AGENTS rule 2).

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'tasks_title_length' and conrelid = 'public.tasks'::regclass)
     and not exists (select 1 from public.tasks where not (char_length(btrim(title)) between 1 and 300)) then
    alter table public.tasks add constraint tasks_title_length check (char_length(btrim(title)) between 1 and 300);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_description_length' and conrelid = 'public.tasks'::regclass)
     and not exists (select 1 from public.tasks where not (char_length(description) <= 20000)) then
    alter table public.tasks add constraint tasks_description_length check (char_length(description) <= 20000);
  end if;

  if not exists (select 1 from pg_constraint where conname = 'tasks_media_seconds_range' and conrelid = 'public.tasks'::regclass)
     and not exists (select 1 from public.tasks where not (media_seconds is null or (media_seconds between 1 and 60))) then
    alter table public.tasks add constraint tasks_media_seconds_range check (media_seconds is null or (media_seconds between 1 and 60));
  end if;
end $$;
