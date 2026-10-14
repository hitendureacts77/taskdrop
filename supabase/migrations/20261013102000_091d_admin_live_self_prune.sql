-- 091d — The admin live feed keeps 30 days and cleans up after itself.
--
-- 091 left the 30-day clean-up for later because AGENTS.md rule 8 forbids new
-- pg_cron jobs and Inngest (Phase 5) isn't in this branch yet. Instead of
-- waiting, the feed prunes itself: every 25th event it writes also deletes up
-- to 500 events older than 30 days.
--
--   * No scheduler, no new job to run, nothing to monitor.
--   * The table stays at roughly 30 days of events however busy or quiet the
--     app is: it only grows when events happen, and each event can prune.
--   * A prune that fails (a lock, a full disk) never loses the event being
--     written and never blocks the change that caused it: it runs in its own
--     nested block, and the whole function already swallows errors.
--   * 25 and 500 keep each prune small: at most one bounded delete per 25
--     events, and a backlog (say, after the feed was switched off) clears
--     over the next few thousand events rather than in one long transaction.
--
-- If Phase 5 later wants this as an Inngest job, delete the prune block below
-- and call the same delete from the function; nothing else depends on it.
--
-- Only replaces a function added by 091 (and its table comment).

create or replace function private.admin_live(
  p_kind        text,
  p_record_type text,
  p_record_id   uuid,
  p_actor       uuid,
  p_summary     jsonb
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row public.admin_live_events;
begin
  insert into public.admin_live_events (kind, record_type, record_id, actor_id, summary)
  values (p_kind, p_record_type, p_record_id, p_actor, coalesce(p_summary, '{}'::jsonb))
  returning * into v_row;

  perform realtime.send(
    jsonb_build_object(
      'id', v_row.id,
      'kind', v_row.kind,
      'record_type', v_row.record_type,
      'record_id', v_row.record_id,
      'actor_id', v_row.actor_id,
      'summary', v_row.summary,
      'created_at', v_row.created_at
    ),
    'event',
    'admin:live',
    true
  );

  -- Keep 30 days: every 25th event, drop up to 500 older ones. Its own block,
  -- so a failure here cannot undo the event written above.
  if v_row.id % 25 = 0 then
    begin
      delete from public.admin_live_events
       where id in (
         select e.id from public.admin_live_events e
          where e.created_at < now() - interval '30 days'
          order by e.created_at
          limit 500
       );
    exception when others then
      null;
    end;
  end if;
exception when others then
  null;
end;
$$;
revoke all on function private.admin_live(text, text, uuid, uuid, jsonb) from public, anon, authenticated;

comment on table public.admin_live_events is
  'What just happened in the app, for the admin live feed (migration 091). Written only by triggers; admins read. Keeps 30 days: private.admin_live() prunes older rows as it writes (091d).';
