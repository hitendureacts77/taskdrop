-- Sending a real SMS costs money, so the send path needs limits the dev-only
-- devCode shortcut never did. Two counters, because they stop different things:
--
--   per-phone  stops someone spamming one victim's handset
--   per-IP     stops someone rotating numbers to burn our SMS credit, which
--              per-phone limits alone do nothing about
--
-- The `attempts` budget also has to survive a resend. Until now the send path
-- upserted attempts: 0, so alternating resend and guess never exhausted the
-- five-guess cap — the cap was decorative.

alter table public.auth_codes
  add column if not exists sends_in_window integer not null default 0,
  add column if not exists window_started_at timestamptz not null default now(),
  add column if not exists last_sent_at timestamptz;

comment on table public.auth_codes is
  'Phone sign-in codes. RLS is enabled with zero policies deliberately: that is '
  'an implicit deny-all, so only the service role (the phone-auth function) can '
  'read or write it. Do not "helpfully" add a policy — a readable code table is '
  'an account-takeover hole.';

-- Keyed by IP rather than phone, so one attacker cannot spend our SMS budget by
-- cycling through numbers. Mobile carriers NAT many users behind one address,
-- so the per-IP ceiling is deliberately loose; it is a cost backstop, not a
-- precise per-user limit.
create table if not exists public.auth_send_log (
  ip                text primary key,
  sends             integer not null default 0,
  window_started_at timestamptz not null default now()
);

alter table public.auth_send_log enable row level security;

comment on table public.auth_send_log is
  'Per-IP OTP send counter. Same deny-all rule as auth_codes: service role only.';
