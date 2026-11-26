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

/** The search box's match, the same on the list and the map: the words appear in the title or description. */
export function matchesQuery(row: { title: string; description?: string | null }, query: string): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${row.title} ${row.description ?? ''}`.toLowerCase().includes(q);
}

type Pinned = { id: string; loc_lat: number | null; loc_lng: number | null };

export type FindWorkSearch = {
  q?: string;
  limit: number;
  kind: 'request';
  near?: { lat: number; lng: number; radiusKm: number };
  /** Smart search: chip ids the person removed, and "keep my spelling". Left out when not set. */
  drop?: string[];
  exact?: boolean;
};

/**
 * The reads for one load. With a place: the jobs within `km` of it, and a newest-first read of which only the
 * remote ones are kept. Without a place: the one newest-first read, as before.
 */
export function findWorkSearches(
  at: { lat: number; lng: number } | null,
  km: number,
  query: string,
  smart: { drop?: readonly string[]; exact?: boolean } = {},
): { near: FindWorkSearch | null; wide: FindWorkSearch } {
  const base: FindWorkSearch = { q: query || undefined, limit: FIND_WORK_LIMIT, kind: 'request' as const };
  if (query && smart.drop && smart.drop.length > 0) base.drop = [...smart.drop];
  if (query && smart.exact) base.exact = true;
  return { near: at ? { ...base, near: { lat: at.lat, lng: at.lng, radiusKm: km } } : null, wide: base };
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

/**
 * The search box's match on rows that were NOT themselves read by that search (the map's own reads): when the
 * smart search's result ids are known, a row matches if it is one of them (a match by meaning has no words in
 * common with the box, so a substring test would drop it); until they are, the plain words test stands in.
 * Rows that did come from the server search are never re-filtered by words.
 */
export function matchesSearch(row: { id: string; title: string; description?: string | null }, query: string, ids: ReadonlySet<string> | null | undefined): boolean {
  if (!query.trim()) return true;
  return ids ? ids.has(row.id) : matchesQuery(row, query);
}
