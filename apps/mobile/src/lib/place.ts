/**
 * The rough area of an address, for anyone who isn't on the job yet.
 *
 * Addresses in TaskDrop are door-level ("2222, Ward 104 Kondapur", "Flat
 * 402, Sai Residency, Madhapur, Hyderabad"). Before someone is hired, only
 * the neighbourhood is shown -- "Kondapur", "Madhapur, Hyderabad" -- never
 * the house, flat or plot number, a PIN code or raw coordinates. The exact
 * address is shared with the person hired, once the job starts.
 */
export function roughPlace(label: string | null | undefined): string | null {
  if (!label) return null;
  if (/^remote$/i.test(label.trim())) return 'Remote';
  const parts = label
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean)
    // Country, PIN codes, bare numbers and coordinates say nothing to a person.
    .filter((x) => !/^india$/i.test(x))
    .filter((x) => !/^[\d\s./#-]+$/.test(x))
    // Door-level pieces: house, flat, plot, door, block numbers, "#45", "12/3".
    .filter((x) => !/^(flat|house|h\.?\s?no|door|plot|apt|apartment|block|shop|floor|#)\b/i.test(x))
    // Round 8 (S1-10): also written together or with a sign ("Flat402", "H.No-12"), a letter and a number
    // ("A-402", "H-12", "B402") and a number in front of a street or building ("12 MG Road").
    .filter((x) => !/^(flat|house|h\.?\s?no|door|plot|apt|apartment|block|shop|floor)\s*[#:.-]?\s*\d/i.test(x))
    .filter((x) => !/^[a-z]{1,2}\s*-?\s*\d+[a-z]?\b/i.test(x))
    .filter((x) => !/^\d+[a-z]?\s*[/-]/i.test(x))
    .filter((x) => !/^\d+[a-z]?\s/i.test(x))
    // A PIN code next to the state ("Telangana 500081") goes; the state stays.
    .map((x) => x.replace(/\s*\b\d{6}\b\s*/g, ' ').trim())
    // "Ward 104 Kondapur" -> "Kondapur"; "5th Cross, ..." is a street, not an area.
    .map((x) => x.replace(/^ward\s*\d+\s*/i, '').trim())
    .filter((x) => x && !/^\d+(st|nd|rd|th)?\s+(cross|main|street|lane|road)\b/i.test(x))
    // A building or society name followed by the area: keep the area.
    .filter((x) => !/\b(residency|apartments?|towers?|enclave|society|heights|villa|nivas|complex)\b/i.test(x));
  if (parts.length === 0) return null;
  return parts.slice(-2).join(', ');
}

/**
 * One place label, tidy: each part trimmed, empty parts dropped, joined with ", " and no run of spaces
 * (B176: "Madhapur,  Ward 104 Kondapur,  Greater ..." carried a double space after every comma).
 */
export function tidyLabel(label: string): string {
  return label
    .split(',')
    .map((x) => x.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(', ');
}

/**
 * The name of the place someone picked, for their own header: the first part that is an area, not a door
 * number ("Madhapur, Ward 104 Kondapur, Greater ..." is Madhapur, not Kondapur, B176). Null when none is.
 */
export function pickedPlaceName(label: string | null | undefined): string | null {
  if (!label) return null;
  for (const part of tidyLabel(label).split(', ')) {
    const name = roughPlace(part);
    if (name) return name;
  }
  return null;
}
