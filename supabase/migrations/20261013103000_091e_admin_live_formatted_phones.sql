-- 091e — The admin live feed also rejects formatted phone numbers.
--
-- 091b hid a name holding six or more digits in a row. CodeRabbit pointed out
-- that "415-555-0123", "(415) 555 0123" or "+91 98765 43210" slip past that.
-- private.admin_live_clean_name() now counts the digits in the whole name,
-- ignoring spaces, dashes and brackets: six or more reads as a phone number.
--
-- Only replaces a function added by 091b.

create or replace function private.admin_live_clean_name(p_name text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_name is null or btrim(p_name) = '' then null
    -- six or more digits in all, however they are spaced, reads as a phone number
    when length(regexp_replace(p_name, '[^0-9]', '', 'g')) >= 6 then null
    when p_name ~ '@' then null
    else left(btrim(p_name), 60)
  end;
$$;
revoke all on function private.admin_live_clean_name(text) from public, anon, authenticated;
