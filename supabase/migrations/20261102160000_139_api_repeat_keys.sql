-- 139: repeat keys (idempotency keys) for the api Edge Function's writes (plan task 2.12).
--
-- A write the app sends carries a random key, made once per tap. If the
-- connection drops before the answer comes back, the app sends the same write
-- again with the same key, and the server answers with the first reply instead
-- of doing the work twice. Today the money functions already refuse a second
-- payment for a paid task; this makes every write safe to send again, and lets
-- the app retry a write after a blip the way it already retries reads.
--
-- One row per person and key, kept for 24 hours. A row with no reply yet means
-- the first request is still running (or died before it could save its answer).
-- Old rows are pruned by the claim itself, a few at a time, so no new pg_cron
-- job is needed (AGENTS.md rule 8).

create table if not exists private.api_repeat_keys (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  key        text        not null check (key ~ '^[A-Za-z0-9_-]{16,64}$'),
  op         text        not null,
  args_hash  text        not null,
  reply      jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create index if not exists api_repeat_keys_created_at on private.api_repeat_keys (created_at);

-- private is not exposed through the API; RLS on with no policies as well, so
-- the table stays deny-all even if that ever changes.
alter table private.api_repeat_keys enable row level security;

/**
 * Claim a key before running a write. Answers one of:
 *   {"state":"new"}                  first time: run the write, then save its reply
 *   {"state":"done","reply":{...}}   already answered: send this reply again
 *   {"state":"running"}              the first request is still running
 *   {"state":"lost"}                 the first request ended without saving a reply; its outcome is unknown
 *   {"state":"mismatch"}             the key was used for a different request
 */
create or replace function public.api_repeat_claim(
  p_user uuid,
  p_key  text,
  p_op   text,
  p_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row private.api_repeat_keys%rowtype;
begin
  -- A few expired rows per claim keeps the table small without a scheduled job.
  delete from private.api_repeat_keys
  where ctid in (
    select ctid from private.api_repeat_keys
    where created_at < now() - interval '24 hours'
    limit 50
  );

  insert into private.api_repeat_keys (user_id, key, op, args_hash)
  values (p_user, p_key, p_op, p_hash)
  on conflict (user_id, key) do nothing;
  if found then
    return jsonb_build_object('state', 'new');
  end if;

  select * into v_row from private.api_repeat_keys where user_id = p_user and key = p_key;
  if v_row.op <> p_op or v_row.args_hash <> p_hash then
    return jsonb_build_object('state', 'mismatch');
  end if;
  if v_row.reply is not null then
    return jsonb_build_object('state', 'done', 'reply', v_row.reply);
  end if;
  -- An Edge Function is stopped long before 5 minutes, so a row still empty by then was abandoned.
  if v_row.created_at < now() - interval '5 minutes' then
    return jsonb_build_object('state', 'lost');
  end if;
  return jsonb_build_object('state', 'running');
end;
$$;

/** Save the reply a claimed write gave, so a repeat of it gets the same answer. */
create or replace function public.api_repeat_save(
  p_user  uuid,
  p_key   text,
  p_reply jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  update private.api_repeat_keys set reply = p_reply
  where user_id = p_user and key = p_key and reply is null;
$$;

-- Only our own server calls these (with the service key), naming the caller it
-- has already verified. A person must not be able to read or fill anyone else's keys.
revoke all on function public.api_repeat_claim(uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.api_repeat_save(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.api_repeat_claim(uuid, text, text, text) to service_role;
grant execute on function public.api_repeat_save(uuid, text, jsonb) to service_role;
