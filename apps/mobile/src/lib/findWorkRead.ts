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

type Pinned = { id: string; loc_lat: number | null; loc_lng: number | null };

export type FindWorkSearch = {
  q?: string;
  limit: number;
  kind: 'request';
  near?: { lat: number; lng: number; radiusKm: number };
};

/**
 * The reads for one load. With a place: the jobs within `km` of it, and a newest-first read of which only the
 * remote ones are kept. Without a place: the one newest-first read, as before.
 */
export function findWorkSearches(
  at: { lat: number; lng: number } | null,
  km: number,
  query: string,
): { near: FindWorkSearch | null; wide: FindWorkSearch } {
  const base = { q: query || undefined, limit: FIND_WORK_LIMIT, kind: 'request' as const };
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
