/**
 * The ranked skill / category list, turned into what a picker shows.
 *
 * The list arrives ranked (most used first). The picker shows the top 12; anything
 * the person already picked that sits further down still shows, so a pick never
 * vanishes. Matching is case-insensitive, so "painting" finds "Painting".
 * Pure on purpose: no screen code in here.
 */

export type CatalogItem = { id: string; label: string; uses: number; source: string };

export const TOP_SHOWN = 12;

/** The built-in skills; the picker falls back to these when the server list is unavailable. */
export const SKILL_OPTIONS = [
  'Repairs', 'Delivery', 'Errands', 'Sourcing', 'Local intel', 'Cleaning', 'Carpentry', 'Painting',
  'Photography', 'Video editing', 'Graphic design', 'Content writing', 'Data entry', 'Tutoring',
  'Web development', 'Career coaching', 'Event planning', 'Translation', 'Research',
];

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

const unlisted = (label: string): CatalogItem => ({ id: `picked:${label.trim().toLowerCase()}`, label: label.trim(), uses: 0, source: 'user' });

export const isPicked = (selected: readonly string[], label: string) => selected.some((s) => same(s, label));

/** The list label for a picked text ("painting" -> "Painting"), or the text itself when it is not listed. */
export function canonicalLabel(items: readonly CatalogItem[], text: string): string {
  return items.find((i) => same(i.label, text))?.label ?? text.trim();
}

export type PickView = {
  /** What to draw as pills, in rank order. */
  shown: CatalogItem[];
  /** Every term in the list (picked ones that are not listed are not counted). */
  total: number;
  /** True when the full list has more than the pills show. */
  hasMore: boolean;
};

export function pickView(items: readonly CatalogItem[], selected: readonly string[], top = TOP_SHOWN): PickView {
  const shown: CatalogItem[] = [];
  items.forEach((it, i) => {
    if (i < top || isPicked(selected, it.label)) shown.push(it);
  });
  // A pick the list does not know (an older profile, a term merged away): keep it visible at the end.
  for (const s of selected) {
    if (!items.some((it) => same(it.label, s)) && !shown.some((it) => same(it.label, s))) shown.push(unlisted(s));
  }
  return { shown, total: items.length, hasMore: items.length > top };
}

/** Profile variant: picked ones first (in pick order), then the rest in rank order. */
export function profileView(items: readonly CatalogItem[], selected: readonly string[]) {
  const picked = selected.map((s) => items.find((it) => same(it.label, s)) ?? unlisted(s));
  const rest = items.filter((it) => !isPicked(selected, it.label));
  return { picked, rest };
}

/** The full list filtered by what was typed: terms that start with it first, then ones that contain it. */
export function searchItems(items: readonly CatalogItem[], text: string): CatalogItem[] {
  const n = text.trim().toLowerCase();
  if (!n) return [...items];
  const starts = items.filter((it) => it.label.toLowerCase().startsWith(n));
  const has = items.filter((it) => !it.label.toLowerCase().startsWith(n) && it.label.toLowerCase().includes(n));
  return [...starts, ...has];
}

/** True when the typed text is exactly a listed term (so no "add as new" line is needed). */
export const hasExact = (items: readonly CatalogItem[], text: string) => items.some((it) => same(it.label, text));

export const showAllLabel = (total: number, kind: 'skill' | 'category') =>
  `Show all ${total} ${kind === 'skill' ? 'skills' : 'categories'}`;

/** Capitalise the first letter, as profiles have always stored skills. */
export const tidy = (text: string) => {
  const s = text.trim().replace(/\s+/g, ' ');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
