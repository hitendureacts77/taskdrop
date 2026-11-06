-- 157: follow-ups from the independent review of the guest hardening (migration 154).
--
-- Nothing is dropped and no stored row changes. Two things:
--
--   1. The guest limiter (H63) could be pushed to 'busy' for all guests by one
--      caller with many cheap addresses (an IPv6 /48 holds 65,536 /64 blocks, each with its own
--      address budget). api_guest_spend gets a second, wider key: the caller's network (an IPv6 /48,
--      an IPv4 /24), with its own per-minute limit, checked BEFORE the shared "all guests" row.
--      A request that ends up refused as 'busy' (or by the network limit) no longer stays counted
--      against the address, so a refused request cannot use up an address's budget.
--      The old five-argument function stays as it is (the api function that is live while this
--      migration is applied keeps working); the api now calls the seven-argument one below.
--
--   2. private.guest_area_label (H61) is replaced by a stricter version:
--        * a digit in any script counts as a digit (Devanagari, Telugu, Tamil, ...), not only 0-9;
--        * when the typed label has exactly three comma parts, only the last kept part is shown: a
--          short label has no room for an area AND a building, and a building name that is not on the
--          word list ("Lotus Park, Hyderabad" typed as three parts) would otherwise leak as the "area".
--      Longer labels still give the last two kept parts.
--
-- Only the service role may call the limiter. Nothing here writes outside private.api_rate.

-- ------------------------------------------------------------ the limiter --

-- One guest request, counted against: the caller's address key (p_key), the caller's wider network key
-- (p_net, an IPv6 /48 or an IPv4 /24, hashed like p_key) and all guests together, in the same one-minute
-- windows as api_rate_spend. Answers
--   'ok'         go ahead;
--   'heavy_off'  go ahead with light reads only (all guests over p_soft);
--   'limited'    this address is over p_limit, or this network over p_net_limit;
--   'busy'       all guests over p_hard.
-- A refused request leaves no count behind on any row (counts taken earlier in the call are given back).
create or replace function public.api_guest_spend(
  p_key       uuid,
  p_net       uuid,
  p_cost      integer,
  p_limit     integer,
  p_net_limit integer,
  p_soft      integer,
  p_hard      integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- The shared counter's key: no hashed address can be all zeros.
  c_all   constant uuid := '00000000-0000-0000-0000-000000000000';
  v_start timestamptz := to_timestamp(floor(extract(epoch from now()) / 60) * 60);
  v_cost  integer := least(greatest(coalesce(p_cost, 1), 1), 100);
  v_hits  integer;
begin
  if p_key is null or p_key = c_all or p_net is null or p_net = c_all or p_net = p_key then return 'limited'; end if;

  -- The address first.
  insert into private.api_rate as r (user_id, bucket, window_start, hits)
  values (p_key, 'guest', v_start, v_cost)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + v_cost
    where r.hits + v_cost <= p_limit
  returning r.hits into v_hits;
  if v_hits is null or v_hits > p_limit then return 'limited'; end if;

  -- Then the network: many addresses of one network share this budget.
  insert into private.api_rate as r (user_id, bucket, window_start, hits)
  values (p_net, 'guest_net', v_start, v_cost)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + v_cost
    where r.hits + v_cost <= p_net_limit
  returning r.hits into v_hits;
  if v_hits is null or v_hits > p_net_limit then
    update private.api_rate r set hits = greatest(r.hits - v_cost, 0)
     where r.user_id = p_key and r.bucket = 'guest' and r.window_start = v_start;
    return 'limited';
  end if;

  -- Last the shared row, so a refused request never touches it.
  insert into private.api_rate as r (user_id, bucket, window_start, hits)
  values (c_all, 'guest_all', v_start, v_cost)
  on conflict (user_id, bucket, window_start) do update set hits = r.hits + v_cost
    where r.hits + v_cost <= p_hard
  returning r.hits into v_hits;
  if v_hits is null or v_hits > p_hard then
    -- Refused as busy: give the address and the network their count back.
    update private.api_rate r set hits = greatest(r.hits - v_cost, 0)
     where r.window_start = v_start
       and ((r.user_id = p_key and r.bucket = 'guest') or (r.user_id = p_net and r.bucket = 'guest_net'));
    return 'busy';
  end if;
  if v_hits > p_soft then return 'heavy_off'; end if;
  return 'ok';
end;
$$;

revoke all on function public.api_guest_spend(uuid, uuid, integer, integer, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.api_guest_spend(uuid, uuid, integer, integer, integer, integer, integer) to service_role;

-- -------------------------------------------------------------- area label --

-- As in 154, with two changes (see the top): digits of any script, and a short label keeps its last part only.
-- "Flat 302, Sai Residency, 5th Cross, Madhapur, Hyderabad" -> "Madhapur, Hyderabad";
-- "Ward 104 Kondapur" -> "Kondapur"; "Raj Palace, Ameerpet, Hyderabad" -> "Hyderabad". Nothing left: null.
create or replace function private.guest_area_label(p_label text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  -- A digit of any script. [[:digit:]] depends on the database's locale (it can be ASCII only), so the ranges of
  -- the Unicode decimal-digit blocks are listed as well: Arabic-Indic, Devanagari, Bengali, Gurmukhi, Gujarati,
  -- Odia, Tamil, Telugu, Kannada, Malayalam, Sinhala, Thai, Lao, Tibetan, Myanmar, full-width.
  c_digit constant text :=
    '[[:digit:]0-9٠-٩۰-۹०-९০-৯੦-੯૦-૯୦-୯௦-௯౦-౯೦-೯൦-൯෦-෯๐-๙໐-໙༠-༩၀-၉０-９]';
  v_parts text[] := '{}';
  v_x     text;
  v_n     integer;
  v_raw   integer := 0;
begin
  if p_label is null or btrim(p_label) = '' then return null; end if;
  if btrim(p_label) ~* '^remote$' then return 'Remote'; end if;
  foreach v_x in array string_to_array(left(p_label, 500), ',') loop
    if btrim(v_x) <> '' then v_raw := v_raw + 1; end if;
    -- "Ward 104 Kondapur" -> "Kondapur" before numbers are looked at.
    v_x := btrim(regexp_replace(btrim(v_x), '^ward\s*' || c_digit || '+\s*', '', 'i'));
    continue when v_x = '';
    continue when v_x ~* '^india$';
    -- Any number: house, flat, plot or door numbers, PIN codes, "12/3", "5th Cross", coordinates.
    continue when v_x ~ c_digit;
    -- Door-level words, and "#".
    continue when v_x ~ '^#';
    continue when v_x ~* '^(flat|house|h\.?\s?no|door|plot|apt|apartment|block|shop|floor|wing|room|unit)\M';
    -- A building or society name: keep the area after it.
    continue when v_x ~* '\m(residency|apartments?|towers?|enclave|society|heights|villa|villas|nivas|complex|bhavan|building)\M';
    -- Landmarks point at the door as well as a number does.
    continue when v_x ~* '^(near|opp|opposite|behind|beside|next to|in front of)\M';
    v_parts := v_parts || left(v_x, 60);
  end loop;
  v_n := cardinality(v_parts);
  if v_n = 0 then return null; end if;
  -- One or two typed parts is the stored area ("Madhapur, Hyderabad"): show it whole. Exactly three typed parts leave
  -- no room to tell an area from a building, so only the last kept part is shown.
  if v_raw <= 2 then return array_to_string(v_parts, ', '); end if;
  if v_raw = 3 then return v_parts[v_n]; end if;
  return array_to_string(v_parts[greatest(v_n - 1, 1):v_n], ', ');
end;
$$;

revoke all on function private.guest_area_label(text) from public, anon, authenticated;
