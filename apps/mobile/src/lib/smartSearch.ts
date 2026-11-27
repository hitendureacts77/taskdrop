/**
 * Smart search, the plain-logic part (plan 1.19 row D): the recent-searches list, and the words the search
 * pieces say. No React Native here, so it runs in Node (smartSearch.test.ts). The pieces themselves are
 * components/SmartSearch.tsx; the reads are searchSuggest / searchFallbacks in data/api.ts.
 */

/** Earn (a worker looking for jobs) or Hire (a customer looking for helpers). */
export type SearchRole = 'earn' | 'hire';

export const RECENT_SEARCHES_MAX = 5;
/** A search box is not a note: longer than this is not remembered. */
const RECENT_MAX_LENGTH = 60;

/** The last searches, newest first, no repeats (same words in any letter case), at most five. */
export function addRecent(list: readonly string[], q: string): string[] {
  const word = q.trim().replace(/\s+/g, ' ');
  if (word.length < 2 || word.length > RECENT_MAX_LENGTH) return [...list];
  const key = word.toLowerCase();
  return [word, ...list.filter((x) => x.toLowerCase() !== key)].slice(0, RECENT_SEARCHES_MAX);
}

/** What was stored, cleaned: strings only, no repeats, at most five. Anything else is an empty list. */
export function parseRecent(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    let out: string[] = [];
    for (const x of [...data].reverse()) if (typeof x === 'string') out = addRecent(out, x);
    return out;
  } catch {
    return [];
  }
}

/** "jobs" for Earn, "helpers" for Hire. */
export const roleNoun = (role: SearchRole) => (role === 'earn' ? 'jobs' : 'helpers');

/** The kind the api takes for each side. */
export const roleKind = (role: SearchRole) => (role === 'earn' ? ('request' as const) : ('service' as const));

/** The empty state's title: "No plumber jobs within 10 km", or without an area "No plumber jobs found". */
export function emptyTitle(opts: { role: SearchRole; chipLabel?: string | null; query: string; km?: number | null }): string {
  const what = (opts.chipLabel?.trim() || opts.query.trim()).toLowerCase();
  const noun = roleNoun(opts.role);
  const lead = what ? `No ${what} ${noun}` : `No ${noun}`;
  return opts.km != null && opts.km > 0 ? `${lead} within ${opts.km} km` : `${lead} found`;
}

/** The right-hand count of a suggestion: "14 near you" for the first one when an area is set, else the number. */
export function suggestionCount(count: number | null, first: boolean, hasArea: boolean): string | null {
  if (count == null) return null;
  return first && hasArea ? `${count} near you` : String(count);
}

/** "Close matches: plumbing, taps", the labels lower-cased. */
export function closeMatchesLabel(labels: readonly string[]): string {
  return `Close matches: ${labels.map((l) => l.toLowerCase()).join(', ')}`;
}

/** "14 jobs" / "1 job", "3 helpers" / "1 helper". */
export function countLabel(n: number, role: SearchRole): string {
  const noun = roleNoun(role);
  return `${n} ${n === 1 ? noun.replace(/s$/, '') : noun}`;
}

/** The loading line. */
export const loadingLine = (role: SearchRole) => `Finding ${roleNoun(role)} that match what you mean…`;

/** The radius the "Search within 25 km" row asks for. */
export const WIDER_KM = 25;
