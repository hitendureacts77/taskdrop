/**
 * The full map's search box and category chips (plan D11): pure, so the web
 * and Google maps filter the same way and it can be tested without a screen.
 */

/** Lower case, accents and punctuation gone, so "A/C" finds "AC repair". */
function fold(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True when every word typed shows up somewhere in the fields (a title, a
 * service, an area, a skill). An empty search matches everything.
 */
export function matchesSearch(query: string, fields: (string | null | undefined)[]): boolean {
  const words = fold(query).split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const text = fold(fields.filter(Boolean).join(' '));
  // Also squashed, so "ac" finds "A/C repair".
  const hay = text + ' ' + text.replace(/ /g, '');
  return words.every((w) => hay.includes(w));
}

/**
 * The categories worth a chip: the ones actually on the map, busiest first
 * (ties keep the order they came in), at most `max`. A category with nothing
 * near would only lead to an empty map.
 */
export function chipCategories(categories: (string | null | undefined)[], max = 6): string[] {
  const count = new Map<string, number>();
  for (const c of categories) if (c && c !== 'Other') count.set(c, (count.get(c) ?? 0) + 1);
  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([c]) => c);
}

/** "Repairs & Maintenance" -> "Repairs": short enough for a chip. */
export function chipLabel(category: string): string {
  return category.split(/\s*&\s*/)[0]!.trim();
}
