-- ===========================================================================
-- Phone sign-in codes (migration 005)
-- Written and read only by the phone-auth Edge Function (service role).
-- RLS is on with no policies, so clients can never read or forge a code.
-- ===========================================================================
create table public.auth_codes (
  phone       text primary key,
  code        text not null,
  attempts    integer not null default 0,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

alter table public.auth_codes enable row level security;
