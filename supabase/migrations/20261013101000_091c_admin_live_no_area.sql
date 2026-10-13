-- 091c — The admin live feed carries no location at all.
--
-- 091 put tasks.loc_label into the "task posted" event as 'area'. Most labels
-- are area names ("Indiranagar"), but the column is free text and some are
-- longer and read like street addresses, so it broke the rule stated in 091:
-- events carry names, titles and amounts, never locations. (Found by
-- CodeRabbit on the pull request, then checked against the test database.)
--
-- Replaces private.live_task_posted() without 'area'. Coarse, deliberate
-- location data for the live map comes in a later step, from an explicit
-- coarse-area field rather than free text.
--
-- Only replaces a function added by 091.

create or replace function private.live_task_posted()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform private.admin_live('task_posted', 'task', new.id, new.poster_id,
    jsonb_build_object(
      'title', left(coalesce(new.title, ''), 120),
      'who', private.admin_live_name(new.poster_id),
      'amount_minor', new.benchmark_minor,
      'kind', new.kind,
      'category', new.category
    ));
  return null;
exception when others then
  return null;
end;
$$;
revoke all on function private.live_task_posted() from public, anon, authenticated;
