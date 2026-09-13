-- ===========================================================================
-- TaskDrop core schema (migration 001)
-- Enums, core tables, new-user provisioning, and RLS-on (deny-all) everywhere.
-- Full RLS policy set follows in migration 002.
-- Money is stored in the smallest currency unit (paise/cents) as bigint.
-- Applied to project wjxvingpfbfvkfqhrguj via MCP on 2026-09-11.
-- ===========================================================================

-- ---- Enums -----------------------------------------------------------------
create type task_status as enum (
  'OPEN','LOCKED','TASK_STARTED','OVERDUE','WORK_DONE',
  'REVISION_REQUESTED','COMPLETED','AUTO_COMPLETED','CANCELLED','DISPUTED'
);
create type app_role       as enum ('admin','poster','worker');
create type task_flag      as enum ('none','urgent','unique');
create type pillar         as enum ('services','procurement','local_intel');
create type payout_mode    as enum ('one_time','milestones');
create type cancelled_by   as enum ('poster','worker');
create type cancel_reason  as enum ('normal','overdue');
create type assignment_status as enum ('assigned','started','released','refunded');

-- ---- Helper: updated_at ----------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---- profiles (1:1 with auth.users) ---------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  display_name text not null,
  avatar_url   text,
  skills       text[] not null default '{}',
  loc_lat      double precision,
  loc_lng      double precision,
  loc_label    text,
  poster_rating_avg   numeric(3,2) not null default 0,
  poster_rating_count integer      not null default 0,
  worker_rating_avg   numeric(3,2) not null default 0,
  worker_rating_count integer      not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---- roles (an account is poster+worker; admin is separate) ---------------
create table public.user_roles (
  user_id uuid not null references auth.users(id) on delete cascade,
  role    app_role not null,
  primary key (user_id, role)
);

create or replace function public.has_role(uid uuid, r app_role)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.user_roles where user_id = uid and role = r);
$$;
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_role(auth.uid(), 'admin');
$$;

-- ---- wallets ---------------------------------------------------------------
create table public.wallets (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  balance_minor      bigint not null default 0,
  clearing_minor     bigint not null default 0,
  currency           text   not null default 'INR',
  updated_at         timestamptz not null default now()
);
create trigger trg_wallets_updated before update on public.wallets
  for each row execute function public.set_updated_at();

-- ---- settings (admin-configurable; rules/ constants are the defaults) ------
create table public.settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now()
);
create trigger trg_settings_updated before update on public.settings
  for each row execute function public.set_updated_at();

insert into public.settings (key, value) values
  ('worker_commission_pct',      '0.20'),
  ('poster_service_fee_pct',     '0.03'),
  ('post_start_cancel_penalty_pct','0.05'),
  ('review_window_days',         '3'),
  ('clearing_period_days',       '7'),
  ('max_video_seconds',          '60');

-- ---- tasks -----------------------------------------------------------------
create table public.tasks (
  id                uuid primary key default gen_random_uuid(),
  poster_id         uuid not null references auth.users(id) on delete cascade,
  pillar            pillar not null,
  title             text not null,
  description       text not null default '',
  benchmark_minor   bigint not null,
  time_limit_minutes integer not null,
  flag              task_flag not null default 'none',
  status            task_status not null default 'OPEN',
  media_kind        text,
  media_path        text,
  media_seconds     integer,
  loc_lat           double precision,
  loc_lng           double precision,
  loc_label         text,
  locked_bid_id     uuid,
  locked_minor      bigint,
  payout_mode       payout_mode,
  started_at        timestamptz,
  work_done_at      timestamptz,
  auto_complete_at  timestamptz,
  completed_at      timestamptz,
  clear_at          timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create index tasks_status_idx on public.tasks(status);
create index tasks_poster_idx on public.tasks(poster_id);
create index tasks_pillar_idx on public.tasks(pillar);
create trigger trg_tasks_updated before update on public.tasks
  for each row execute function public.set_updated_at();

-- ---- bids / quotes ---------------------------------------------------------
create table public.bids (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references public.tasks(id) on delete cascade,
  worker_id         uuid not null references auth.users(id) on delete cascade,
  price_minor       bigint not null,
  time_limit_minutes integer not null,
  message           text,
  is_locked         boolean not null default false,
  created_at        timestamptz not null default now(),
  unique (task_id, worker_id)
);
create index bids_task_idx on public.bids(task_id);
create index bids_worker_idx on public.bids(worker_id);

-- ---- assignments (multi-assign; each carries its own escrow) ---------------
create table public.assignments (
  id             uuid primary key default gen_random_uuid(),
  task_id        uuid not null references public.tasks(id) on delete cascade,
  bid_id         uuid not null references public.bids(id) on delete cascade,
  worker_id      uuid not null references auth.users(id) on delete cascade,
  status         assignment_status not null default 'assigned',
  escrow_minor   bigint not null,
  payout_mode    payout_mode not null default 'one_time',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (task_id, worker_id)
);
create index assignments_task_idx on public.assignments(task_id);
create index assignments_worker_idx on public.assignments(worker_id);
create trigger trg_assignments_updated before update on public.assignments
  for each row execute function public.set_updated_at();

-- ---- reviews (role-scoped; poster & worker sets never merged) --------------
create table public.reviews (
  id          uuid primary key default gen_random_uuid(),
  task_id     uuid not null references public.tasks(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  subject_id  uuid not null references auth.users(id) on delete cascade,
  about_role  app_role not null,
  rating      smallint not null check (rating between 1 and 5),
  comment     text,
  created_at  timestamptz not null default now(),
  unique (task_id, author_id, about_role)
);
create index reviews_subject_idx on public.reviews(subject_id, about_role);

-- ---- cancellations_log (feeds the Admin Cancellation Monitor) --------------
create table public.cancellations_log (
  id                uuid primary key default gen_random_uuid(),
  task_id           uuid not null references public.tasks(id) on delete cascade,
  cancelled_by      cancelled_by not null,
  reason            cancel_reason not null default 'normal',
  phase             text not null,
  locked_minor      bigint,
  penalty_or_refund_minor bigint,
  created_at        timestamptz not null default now()
);
create index cancel_log_task_idx on public.cancellations_log(task_id);
create index cancel_log_by_reason_idx on public.cancellations_log(cancelled_by, reason);

-- ---- New-user provisioning: profile + wallet + poster & worker roles -------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email,'@',1), 'New user'));
  insert into public.wallets (user_id) values (new.id);
  insert into public.user_roles (user_id, role) values (new.id, 'poster'), (new.id, 'worker');
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---- RLS: switch ON everywhere. No policies yet == deny-all (safe). --------
alter table public.profiles          enable row level security;
alter table public.user_roles        enable row level security;
alter table public.wallets           enable row level security;
alter table public.settings          enable row level security;
alter table public.tasks             enable row level security;
alter table public.bids              enable row level security;
alter table public.assignments       enable row level security;
alter table public.reviews           enable row level security;
alter table public.cancellations_log enable row level security;
