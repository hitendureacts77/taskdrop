-- 073 — Client roles may write only the columns the app actually sends.
--
-- Audit findings F-01, F-05, F-06 (docs/audit/SECURITY_FINDINGS.md).
--
-- Row-level security answers "which rows". It says nothing about "which
-- columns". Every table below had a policy of the form `owner = auth.uid()` and
-- a table-wide UPDATE grant, so an owner could rewrite any column of their own
-- row -- including tasks.funded_at, which start_task / confirm_release /
-- fund_task_from_wallet all treat as proof that escrow was paid.
--
-- Fix, in two independent layers so a future grant cannot silently reopen it:
--   1. column-level privileges (the database refuses the statement), and
--   2. a BEFORE INSERT/UPDATE guard on tasks that refuses protected columns for
--      the client roles even if someone grants them later.
-- SECURITY DEFINER RPCs run as the function owner and the edge functions run as
-- service_role, so neither is affected: current_user is not authenticated/anon.
--
-- Also: anon holds nothing. The app is signed-in-only (a signed-out visitor
-- gets the splash), so there is no reason for the anonymous role to touch a
-- table, and it held INSERT/UPDATE/DELETE on nearly all of them.

-- ---------------------------------------------------------------- anon ------
revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ------------------------------------------------- authenticated, baseline --
-- No client role needs TRUNCATE / REFERENCES / TRIGGER anywhere.
revoke truncate, references, trigger on all tables in schema public from authenticated;
alter default privileges in schema public revoke truncate, references, trigger on tables from authenticated;

-- Every INSERT/UPDATE/DELETE policy in the schema belongs to one of the tables
-- below, so DML on any other table was already refused by RLS. Revoke it
-- everywhere, then give back exactly what the app uses.
revoke insert, update, delete on all tables in schema public from authenticated;
alter default privileges in schema public revoke insert, update, delete on tables from authenticated;

-- tasks: a poster describes the job. They never touch payment or progress.
grant insert (poster_id, pillar, title, description, benchmark_minor, time_limit_minutes, flag,
              media_kind, media_path, media_seconds, loc_label, loc_lat, loc_lng, category,
              skills, difficulty, assignment_mode, due_at, milestones, kind)
  on public.tasks to authenticated;
grant update (title, description, benchmark_minor, time_limit_minutes, flag,
              media_kind, media_path, media_seconds, loc_label, loc_lat, loc_lng, category,
              skills, difficulty, assignment_mode, due_at, milestones)
  on public.tasks to authenticated;

-- bids: price, time and message. is_locked, task_id, worker_id are not editable.
grant insert (task_id, worker_id, price_minor, time_limit_minutes, message)
  on public.bids to authenticated;
grant update (price_minor, time_limit_minutes, message) on public.bids to authenticated;
grant delete on public.bids to authenticated;

-- messages
grant insert (task_id, sender_id, body) on public.messages to authenticated;

-- saved_tasks: the app upserts, which needs INSERT and UPDATE on the key columns.
grant insert, update, delete on public.saved_tasks to authenticated;

-- feedback
grant insert (user_id, kind, body, page) on public.feedback to authenticated;

-- profiles: editable profile fields only. Ratings, referral_code, id, created_at
-- and the legacy payout_upi are not.
grant update (display_name, avatar_url, skills, loc_lat, loc_lng, loc_label, onboarded_at,
              username, bio, languages, intent, last_seen_at, live_until, worker_bio,
              worker_onboarded_at)
  on public.profiles to authenticated;

-- payout_destinations: what the person typed. The Razorpay ids are written by
-- save_payout_fund_account() (service role), and the default by an RPC.
grant insert (user_id, kind, label, upi_id, account_name, account_number, ifsc)
  on public.payout_destinations to authenticated;
grant delete on public.payout_destinations to authenticated;

-- notifications: mark read, or delete.
grant update (read_at) on public.notifications to authenticated;
grant delete on public.notifications to authenticated;

-- task_proofs: the assigned worker submits proof (policy checks the assignment).
grant insert (task_id, worker_id, summary, files) on public.task_proofs to authenticated;

-- push_tokens: the app removes its own token on sign-out; registering is an RPC.
grant delete on public.push_tokens to authenticated;

-- Admin panel, signed in as an admin user: these two are gated by an
-- is_admin() policy (ALL), so they keep their grants.
grant select, insert, update, delete on public.settings   to authenticated;
grant select, insert, update, delete on public.user_roles to authenticated;

-- reviews are written only by submit_review() (SECURITY DEFINER), which
-- validates the task and recomputes the ratings. The direct policies let an
-- author re-point a review at another task or write one that never went
-- through that validation.
drop policy if exists reviews_insert_participant on public.reviews;
drop policy if exists reviews_update_own         on public.reviews;

-- Legacy single-UPI column. Payout destinations replaced it (migration 026) and
-- no screen reads it; stop it holding a value anyone could read.
update public.profiles set payout_upi = null where payout_upi is not null;

-- ------------------------------------------------ remove_listing replaces a
-- client-side `update tasks set status = 'CANCELLED'`. The client no longer has
-- any grant on tasks.status.
create or replace function public.remove_listing(p_task_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := auth.uid();
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  update public.tasks
     set status = 'CANCELLED', updated_at = now()
   where id = p_task_id
     and poster_id = v_me
     and kind = 'service'
     and status = 'OPEN';
  if not found then
    raise exception 'That listing is not yours, or it can no longer be taken down';
  end if;
end;
$$;
revoke all on function public.remove_listing(uuid) from public, anon;
grant execute on function public.remove_listing(uuid) to authenticated;

-- ---------------------------------------------------- tasks: belt and braces
create or replace function private.guard_task_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.status is distinct from 'OPEN'::public.task_status
       or new.funded_at           is not null
       or new.funding_payment_id  is not null
       or new.funded_via          is not null
       or new.funded_minor        is not null
       or coalesce(new.funded_credits_minor, 0) <> 0
       or new.wallet_refunded_at  is not null
       or new.locked_bid_id       is not null
       or new.locked_minor        is not null
       or new.payout_mode         is not null
       or new.started_at          is not null
       or new.work_done_at        is not null
       or new.auto_complete_at    is not null
       or new.completed_at        is not null
       or new.clear_at            is not null
       or new.cleared_at          is not null then
      raise exception 'Payment and progress fields on a task are set by TaskDrop, not edited directly'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.id                   is distinct from old.id
     or new.poster_id         is distinct from old.poster_id
     or new.kind              is distinct from old.kind
     or new.pillar            is distinct from old.pillar
     or new.created_at        is distinct from old.created_at
     or new.status            is distinct from old.status
     or new.funded_at         is distinct from old.funded_at
     or new.funding_payment_id is distinct from old.funding_payment_id
     or new.funded_via        is distinct from old.funded_via
     or new.funded_minor      is distinct from old.funded_minor
     or new.funded_credits_minor is distinct from old.funded_credits_minor
     or new.wallet_refunded_at is distinct from old.wallet_refunded_at
     or new.locked_bid_id     is distinct from old.locked_bid_id
     or new.locked_minor      is distinct from old.locked_minor
     or new.payout_mode       is distinct from old.payout_mode
     or new.started_at        is distinct from old.started_at
     or new.work_done_at      is distinct from old.work_done_at
     or new.auto_complete_at  is distinct from old.auto_complete_at
     or new.completed_at      is distinct from old.completed_at
     or new.clear_at          is distinct from old.clear_at
     or new.cleared_at        is distinct from old.cleared_at then
    raise exception 'Payment and progress fields on a task are set by TaskDrop, not edited directly'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists tasks_guard_columns on public.tasks;
create trigger tasks_guard_columns
  before insert or update on public.tasks
  for each row execute function private.guard_task_columns();

-- Advisor WARN: the existing profile guard had a role-mutable search_path.
alter function private.guard_profile_columns() set search_path = '';
