-- 184: one contact rule for the app, the api and the database (round 8: S1-3, S1-4, S1-5, S1-6, S2-7, S4-17,
-- S3-30, S3-31, S6-39, S6-40).
--
-- Before: the database's contact checks for task questions and answers (140) and the Ideas board (136) were
-- a short, weaker copy of the api's rule: ASCII digits only, no UPI ids, no chat apps or handles, nothing for
-- digits written another way or split by "/" "," "_" or invisible characters. Reviews (125) had no contact
-- check and no length limit at all, although they are public on every profile.
--
-- After: private.contact_issue(text) is the same rule as apps/mobile/src/lib/mask.ts and
-- supabase/functions/_shared/contacts.ts (findContactIssue): it returns 'email', 'upi', 'phone', 'link',
-- 'handle' or 'address' (door level only), or null. supabase/tests/contact_rule.test.sql runs it over the
-- same table of texts as the app's and the api's tests (supabase/functions/_shared/contactCases.ts), so the
-- three cannot drift apart. The question and board checks now call it, and submit_review refuses a comment
-- that carries a contact detail or is longer than 2000 characters (what the api already allowed).
--
-- Only function bodies change; nothing is dropped or renamed, and every function keeps its signature, so
-- the old app keeps working. Rows already saved are not touched. Safe to run more than once.

create or replace function private.contact_issue(p_text text)
returns text
language plpgsql
immutable
set search_path = ''
as $fn$
declare
  -- Spaces, written out so that the app, the server and the database read the same ones.
  sp constant text := ' \t\n\r\f\v   -     　';
  s  constant text := '[' || sp || ']';
  -- The same word lists as the app's rule.
  mail_hosts constant text := 'gmail|googlemail|yahoo|ymail|hotmail|outlook|live|rediffmail|rediff|icloud|protonmail|proton|zoho';
  upi_handles constant text := 'ok[a-z]+|ybl|ibl|axl|apl|yapl|paytm|pt[a-z]+|upi|icici|sbi|hdfcbank|axisbank|kotak|airtel|jio|fbl|freecharge|abfspay|wa[a-z]+|axisb|idfcbank|federal|indus|rbl|barodampay|unionbank|pnb|boi|cnrb|kbl|aubank|dbs|hsbc|sc|citi';
  tlds constant text := 'com|in|net|org|io|me|co|app|link|ly|ee|be|gl|gg|site|online|xyz|info|biz|store|shop|dev|page|to|tv|ai|us|uk|bio|li|cc|ws';
  apps constant text := 'whats\s?app|watsapp|whatsap|insta(?:gram)?|telegram|snapchat|facebook|messenger';
  app_words constant text := 'page|pages|account|accounts|reel|reels|post|posts|story|stories|ad|ads|marketing|profile|profiles|content|follower|followers|growth|business|shop|store|video|videos|photo|photos|pic|pics|filter|filters|live|influencer|influencers|bio|theme|grid|highlight|highlights|caption|captions|group|groups|channel|channels|status|chat|chats|call|calls|web|app|apps|api|bot|bots|login|verification|verified|handle|link|links|tick|ban|banned|hacked|help|support|expert|work|job|jobs|task|tasks|service|services|setup|management|manager|and|or|for|to|the|a|an|of|with|from|in|on|at|by|it|this|that|also|too|not|only';
  units constant text := 'min|mins|minute|minutes|hr|hrs|hour|hours|km|kms|day|days|week|weeks|month|months|year|years|time|times|people|person|persons|item|items|pcs|kg|kgs|bhk|floor|floors|door|doors|feet|ft|sq|am|pm|x';
  -- Digits written another way: first code point, last code point, the digit the first one stands for
  -- (DIGIT_RANGES in the app's rule).
  ranges constant int[] := array[
    [1632,1641,0], [1776,1785,0], [1984,1993,0], [2406,2415,0], [2534,2543,0], [2662,2671,0], [2790,2799,0],
    [2918,2927,0], [3046,3055,0], [3174,3183,0], [3302,3311,0], [3430,3439,0], [3558,3567,0], [3664,3673,0],
    [3792,3801,0], [3872,3881,0], [4160,4169,0], [4240,4249,0], [6112,6121,0], [6160,6169,0], [65296,65305,0],
    [120782,120831,0], [8320,8329,0], [8304,8304,0], [185,185,1], [178,179,2], [8308,8313,4], [9312,9320,1],
    [9450,9450,0], [9332,9340,1], [9352,9360,1], [9461,9469,1], [9471,9471,0], [10102,10110,1],
    [10112,10120,1], [10122,10130,1]];
  r       int[];
  cp      int;
  v_from  text := '';
  v_to    text := '';
  v_clean text;
  v_plain text;
  v_run   text;
  v_rest  text;
  v_dig   text;
  v_parts text[];
  v_word  text;
  i       int;
begin
  if p_text is null or p_text = '' then
    return null;
  end if;

  -- The text as the rule reads it: invisible characters gone, every digit a 0-9 digit (cleanText).
  foreach r slice 1 in array ranges loop
    for cp in r[1]..r[2] loop
      v_from := v_from || chr(cp);
      v_to := v_to || ((r[3] + cp - r[1]) % 10)::text;
    end loop;
  end loop;
  v_clean := translate(
    regexp_replace(p_text, '[­͏؜ᅟᅠ឴឵᠎​-‏‪-‮⁠-⁤⁪-⁯⃣ㅤ︀-️﻿ﾠ]', '', 'g'),
    v_from, v_to);
  -- And spelled-out digits as digits, for the phone number check only (normalizeDigits).
  v_plain := v_clean;
  i := 0;
  foreach v_word in array array['zero','one','two','three','four','five','six','seven','eight','nine'] loop
    v_plain := regexp_replace(v_plain, '\y' || v_word || '\y', i::text, 'gi');
    i := i + 1;
  end loop;

  -- Emails.
  if v_clean ~* '[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}'
     or v_clean ~* ('[A-Z0-9._%+-]+' || s || '*@' || s || '*[A-Z0-9-]+(?:' || s || '*\.' || s || '*[A-Z0-9-]+)*' || s || '*\.' || s || '*(?:com|in|net|org|co|io|me|info|biz|edu|gov|ac|ai|app|dev|xyz|us|uk)\y')
     or v_clean ~* ('[A-Z0-9_.+-]+' || s || '*[(\[{<]' || s || '*at' || s || '*[)\]}>]' || s || '*[A-Z0-9_-]+(?:' || s || '*(?:[(\[{<]' || s || '*dot' || s || '*[)\]}>]|\.)' || s || '*[A-Z0-9_-]+)*')
     or v_clean ~* ('\y[A-Z0-9_.+-]+' || s || '+at' || s || '+(?:[A-Z0-9_-]+' || s || '+dot' || s || '+[A-Z]{2,}\y|(?:' || mail_hosts || ')\y)')
  then
    return 'email';
  end if;

  -- UPI ids.
  if v_clean ~* '[A-Z0-9._-]{2,}@[A-Z][A-Z0-9]+'
     or v_clean ~* ('[A-Z0-9._-]{2,}' || s || '*@' || s || '*(?:' || upi_handles || ')\y')
     or v_clean ~* ('\yupi(?:' || s || '*(?:id|handle|address|no\.?|number))?' || s || '*(?:is|:|-|=)' || s || '*[A-Z0-9._-]*[@0-9_.][A-Z0-9._@-]*')
  then
    return 'upi';
  end if;

  -- Phone numbers (isPhoneRun): runs of digits joined by spaces, dashes, dots, commas, slashes, underscores or
  -- brackets; a date in front is not part of one; with + or a leading 0 from 8 digits, otherwise from 10,
  -- unless the run is two or more round amounts.
  for v_run in
    select (regexp_matches(v_plain, '\+?[0-9](?:[' || sp || '\-–—.,/_()]{0,3}[0-9])*', 'g'))[1]
  loop
    v_rest := regexp_replace(v_run, '^(?:0?[1-9]|[12][0-9]|3[01])[./-](?:0?[1-9]|1[0-2])[./-](?:19|20)[0-9]{2}(?![0-9])', '');
    v_dig := regexp_replace(v_rest, '[^0-9]', '', 'g');
    if left(v_run, 1) = '+' then
      if length(v_dig) >= 8 then return 'phone'; end if;
    elsif length(v_dig) >= 8 and left(v_dig, 1) = '0' then
      return 'phone';
    elsif length(v_dig) >= 10 then
      v_parts := regexp_split_to_array(v_rest, ',' || s || '+|' || s || '*[-–—]' || s || '*');
      if not (
        cardinality(v_parts) >= 2
        and not exists (
          select 1 from unnest(v_parts) p
           where regexp_replace(p, '[^0-9]', '', 'g') !~ '^[0-9]{3,}$'
              or regexp_replace(p, '[^0-9]', '', 'g') !~ '00$')
      ) then
        return 'phone';
      end if;
    end if;
  end loop;

  -- Links, with or without http or www (the bare-domain ending must be written in small letters).
  if v_clean ~* ('\y(?:https?://|www\.)[^' || sp || ']+')
     or v_clean ~ ('\y[A-Za-z0-9-]*[A-Za-z][A-Za-z0-9-]*(?:\.[A-Za-z0-9-]+)*\.(?:' || tlds || ')\y(?:/[^' || sp || ']*)?')
  then
    return 'link';
  end if;

  -- Handles and chat apps.
  if v_clean ~* '(?<![A-Z0-9_@.])@(?![0-9]{1,2}(?::[0-9]{2})?[ ]?(?:am|pm)\y)[A-Z0-9_.]{3,}'
     or v_clean ~* ('\y(?:' || apps || ')(?:' || s || '+(?:id|handle|username|user' || s || '?name|no\.?|number|account|acc|profile))*' || s || '*(?:[:=@]|-' || s || '|' || s || 'is\y)' || s || '*@?(?!(?:' || app_words || ')\y)[A-Z0-9._]{2,}')
     or v_clean ~* ('\y(?:' || apps || ')' || s || '+(?:me|us)\y')
     or v_clean ~* ('\y(?:' || apps || ')' || s || '+@?(?=[A-Z0-9._]*[A-Z])[A-Z0-9._]*[0-9_.][A-Z0-9._]*[A-Z0-9_]')
     or v_clean ~* ('\y(?:insta|snap|tg)' || s || '+(?!(?:' || app_words || ')\y)[A-Z]{2,}' || s || '*(?:$|[,.!;?\n])')
     or v_clean ~* ('\y(?:dm|message|msg|text|ping|call|contact|reach|find|follow|add|hmu)' || s || '+(?:(?:me|us)' || s || '+)?(?:on|at|via|in|through)' || s || '+(?:' || apps || '|fb|ig|wa|snap)\y')
  then
    return 'handle';
  end if;

  -- Door-level addresses (a PIN code is an area, so it is allowed).
  if v_clean ~* ('\y(?:flat|h\.?' || s || '?no|plot|apartment|apt)' || s || '*(?:no\.?|number|#)?' || s || '*[:#.-]?' || s || '*[0-9]+[a-z]?\y(?!' || s || '*(?:' || units || ')\y)')
     or v_clean ~* ('\y(?:house|door|block|shop)' || s || '*(?:(?:no\.?|number|#)' || s || '*[:.-]?|[:#-])' || s || '*[0-9]+[a-z]?\y')
     or v_clean ~* ('\y(?:house|door|block|shop)' || s || '+[0-9]+[a-z]?' || s || '*(?:,|$)')
     or v_clean ~* ('#' || s || '?[0-9]+[a-z]?' || s || '*,[^.\n]{0,40}\y(?:main|cross|road|rd|street|st|lane|floor|nagar|colony|layout|block|apartments?|residency|towers?|society|enclave|phase|sector|stage)\y')
     or v_clean ~* ('\y[0-9]+' || s || '*(?:st|nd|rd|th)?' || s || '+(?:cross|main|street|lane|road)\y')
     or v_clean ~* ('\y[0-9]{1,4}' || s || '*[/-]' || s || '*[0-9]{1,4}\y[^.\n]{0,40}\y(?:street|st|road|rd|lane|cross|main|nagar|colony|layout|society)\y')
     or v_clean ~* ('\ymy' || s || '+(?:home' || s || '+)?address' || s || '+is\y')
  then
    return 'address';
  end if;

  return null;
end;
$fn$;
revoke all on function private.contact_issue(text) from public, anon, authenticated;

-- The questions and answers check (140) and the Ideas board check (136): the one rule.
create or replace function private.question_has_contact(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.contact_issue(p_text) is not null;
$$;
revoke all on function private.question_has_contact(text) from public, anon, authenticated;

create or replace function private.feedback_has_contact(p_text text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select private.contact_issue(p_text) is not null;
$$;
revoke all on function private.feedback_has_contact(text) from public, anon, authenticated;

-- Reviews (125, unchanged but for the two checks marked NEW): public on every profile, so no contact details,
-- and at most 2000 characters (the api's limit; the app's box holds 1800 plus the praise tags).
create or replace function public.submit_review(
  p_task_id uuid,
  p_rating  smallint,
  p_comment text default null
)
returns public.reviews
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_me       uuid := auth.uid();
  v_task     public.tasks;
  v_worker   uuid;
  v_subject  uuid;
  v_role     app_role;
  v_row      public.reviews;
  v_comment  text := nullif(btrim(coalesce(p_comment, '')), '');
begin
  if v_me is null then
    raise exception 'Not signed in';
  end if;
  if p_rating is null or p_rating < 1 or p_rating > 5 then
    raise exception 'Rating must be between 1 and 5';
  end if;
  -- NEW (S2-7): a length limit.
  if char_length(coalesce(v_comment, '')) > 2000 then
    raise exception 'Keep a review under 2000 characters';
  end if;
  -- NEW (S2-7, S4-17): the one contact rule, like questions and answers.
  if private.contact_issue(v_comment) is not null then
    raise exception 'Leave phone numbers, emails, UPI IDs, links, chat handles and house numbers out. Reviews are public';
  end if;

  select * into v_task from public.tasks where id = p_task_id;
  if not found then
    raise exception 'Task not found';
  end if;

  select a.worker_id into v_worker
  from public.assignments a
  where a.task_id = p_task_id and a.status in ('started','released')
  order by a.created_at desc
  limit 1;

  if v_worker is null then
    raise exception 'This task has no worker to review yet';
  end if;

  -- Whoever is calling reviews the other side.
  if v_me = v_task.poster_id then
    v_subject := v_worker;
    v_role    := 'worker';
  elsif v_me = v_worker then
    v_subject := v_task.poster_id;
    v_role    := 'poster';
  else
    raise exception 'You were not part of this task';
  end if;

  -- Only a finished job can be reviewed.
  if v_task.status::text not in ('COMPLETED', 'AUTO_COMPLETED') then
    raise exception 'You can leave a review once the work is approved';
  end if;

  insert into public.reviews (task_id, author_id, subject_id, about_role, rating, comment)
  values (p_task_id, v_me, v_subject, v_role, p_rating, v_comment)
  on conflict (task_id, author_id, about_role) do update
    set rating = excluded.rating, comment = excluded.comment
  returning * into v_row;

  -- Recompute from source so an edited review cannot drift the average.
  perform private.recompute_ratings(v_subject);

  return v_row;
end;
$$;
revoke all on function public.submit_review(uuid, smallint, text) from public;
revoke execute on function public.submit_review(uuid, smallint, text) from anon;
grant execute on function public.submit_review(uuid, smallint, text) to authenticated;
