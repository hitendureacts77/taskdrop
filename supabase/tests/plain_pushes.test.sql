-- Plain lock-screen pushes (migration 155, finding H42).
--
--   1. private.push_plain_line gives a plain two-line answer for each sensitive kind
--      (chat, task questions, payouts, wallet, support, security, staff warnings) and
--      nothing for any other kind, so offers and task progress keep their wording.
--   2. No plain line holds a digit, a rupee sign, an @ or a quote, so no amount, id or
--      typed text can get in.
--   3. The helper cannot be called by anon or authenticated.
--
-- Everything runs inside one transaction that is rolled back.
--
-- Run with:  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/plain_pushes.test.sql

begin;

do $$
declare
  k text;
  v text[];
begin
  foreach k in array array['message', 'question', 'payout_paid', 'payout_failed', 'wallet',
                           'wallet_refund', 'cancel_fine', 'support', 'security', 'admin_warning'] loop
    v := private.push_plain_line(k);
    if v is null or array_length(v, 1) <> 2 then
      raise exception 'plain push: % has no two-line answer', k;
    end if;
    if v[1] ~ '[0-9@"₹]' or v[2] ~ '[0-9@"₹]' then
      raise exception 'plain push: % line holds a digit, rupee sign, @ or quote', k;
    end if;
  end loop;

  if private.push_plain_line('message')::text <> '{"You have a new message","Open taskdrop to read it."}' then
    raise exception 'plain push: chat wording changed';
  end if;

  foreach k in array array['quote', 'picked', 'funded', 'started', 'submitted', 'released', 'cancelled',
                           'dispute', 'review_reminder', 'due_reminder', 'announcement', 'feedback',
                           'staff_alert', 'bid', 'locked', 'review', ''] loop
    if private.push_plain_line(k) is not null then
      raise exception 'plain push: % should keep its own wording', k;
    end if;
  end loop;
  if private.push_plain_line(null) is not null then
    raise exception 'plain push: a null kind should give nothing';
  end if;
end;
$$;

do $$
begin
  if has_function_privilege('anon', 'private.push_plain_line(text)', 'execute')
     or has_function_privilege('authenticated', 'private.push_plain_line(text)', 'execute') then
    raise exception 'plain push: the helper must not be callable by anon or authenticated';
  end if;
end;
$$;

rollback;
