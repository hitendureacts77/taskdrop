/**
 * What Find work's list reads from the server, and how the answers are joined (Y1).
 *
 * One plain read returns only the newest 200 open requests anywhere, and the km, price and order filters then
 * run on those 200: once there are more than that, older jobs near the worker vanish and "Nearest" / "Best pay"
 * only sort the newest slice. With a place, the api narrows by a lat/lng box in SQL before it caps, so the
 * nearby read goes there; a radius search leaves out jobs with no pin (remote ones), so those get a read of
 * their own, as Home does (B35). Pure, no React Native, tested in Node (findWorkRead.test.ts).
 */

/** The most rows the api returns for one read, the same cap the map uses. */
export const FIND_WORK_LIMIT = 200;
/**
 * The most remote jobs asked for, by the list and the map alike (B170: the map asked for 50 by their own read
 * and the list kept the unpinned ones out of the newest 200, so "28 remote" on one was "20" on the other).
 */
export const REMOTE_LIMIT = FIND_WORK_LIMIT;

/** True when a read came back full: there may be more than it returned, so its length is only "at least". */
export const capped = (got: number, limit: number) => got >= limit;

/**
 * B156 / W2-20: with no area chosen, an in-person job cannot be "in reach", so Earn Home's lists keep only the
 * remote ones (no pin) rather than in-person jobs from any city. With an area, the server's reach already applies.
 */
export function inReachWithoutArea<T extends { loc_lat: number | null }>(rows: readonly T[], hasArea: boolean, max: number): T[] {
  return (hasArea ? [...rows] : rows.filter((r) => r.loc_lat == null)).slice(0, max);
}

/**
 * The words of a search, as the server splits them (S5-22): every ASCII sign (`_ % , ( ) ' = -` and the rest) splits
 * words, so "C++ (dev)" is "c" and "dev" for pinned jobs (matched on the server) and remote ones (matched here) alike.
 * Lower case, each once, at most 6. The server's copy is `searchWords` in supabase/functions/api/reads.ts.
 */
export function searchWords(text: string): string[] {
  const words = text.toLowerCase().slice(0, 200).split(/[\s\x21-\x2f\x3a-\x40\x5b-\x60\x7b-\x7e]+/).filter(Boolean);
  return [...new Set(words)].slice(0, 6);
}

/** The search box's match, the same on the list, the map and the server: every word is in the title or description. */
export function matchesQuery(row: { title: string; description?: string | null }, query: string): boolean {
  const hay = `${row.title} ${row.description ?? ''}`.toLowerCase();
  return searchWords(query).every((w) => hay.includes(w));
}

type Pinned = { id: string; loc_lat: number | null; loc_lng: number | null };

export type FindWorkSearch = {
  q?: string;
  limit: number;
  kind: 'request';
  near?: { lat: number; lng: number; radiusKm: number };
  /** 'near': the nearest jobs first within the radius (the server cuts the page after that order). */
  sort?: 'near';
};

/**
 * How far the list's nearby read reaches: the longest distance the filters offer (S5-27). The read is the nearest
 * jobs first, so any shorter distance (the one set, a draft in the Filters sheet, "Widen to 25 km") is counted from
 * the same rows, and changing the distance needs no new read.
 */
export const LIST_READ_KM = 100;

/**
 * The reads for one load. With a place: the nearest jobs within LIST_READ_KM of it, and a newest-first read of which
 * only the remote ones are kept. Without a place: the one newest-first read, as before.
 */
export function findWorkSearches(
  at: { lat: number; lng: number } | null,
  query: string,
): { near: FindWorkSearch | null; wide: FindWorkSearch } {
  const base = { q: query || undefined, limit: FIND_WORK_LIMIT, kind: 'request' as const };
  return { near: at ? { ...base, near: { lat: at.lat, lng: at.lng, radiusKm: LIST_READ_KM }, sort: 'near' } : null, wide: base };
}

/**
 * Is the count of jobs within `km` only "at least" (B170, S5-26)? Only when a nearest-first read came back full and
 * its farthest job is still inside `km`: past that edge, every job within `km` was read.
 */
export function nearCountCapped(kms: readonly number[], limit: number, km: number): boolean {
  if (kms.length < limit) return false;
  return kms.reduce((m, k) => Math.max(m, k), 0) <= km;
}

/**
 * The rows both reads found, once each (by id): every pinned job from the nearby read, and from the wide read
 * the remote ones plus, when there was no nearby read, everything. The client-only filters run after this.
 */
export function joinFindWork<T extends Pinned>(near: readonly T[] | null, wide: readonly T[]): T[] {
  if (near === null) return [...wide];
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of near) {
    if (row.loc_lat == null || row.loc_lng == null || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  for (const row of wide) {
    if ((row.loc_lat != null && row.loc_lng != null) || seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
  }
  return out;
}
