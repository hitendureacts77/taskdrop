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
    .filter((x) => !/^\d+[a-z]?\s*[/-]/i.test(x))
    // "Ward 104 Kondapur" -> "Kondapur"; "5th Cross, ..." is a street, not an area.
    .map((x) => x.replace(/^ward\s*\d+\s*/i, '').trim())
    .filter((x) => x && !/^\d+(st|nd|rd|th)?\s+(cross|main|street|lane|road)\b/i.test(x))
    // A building or society name followed by the area: keep the area.
    .filter((x) => !/\b(residency|apartments?|towers?|enclave|society|heights|villa|nivas|complex)\b/i.test(x));
  if (parts.length === 0) return null;
  return parts.slice(-2).join(', ');
}
