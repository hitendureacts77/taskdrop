/**
 * When the map lets go (the person stopped moving it) the results refresh by themselves (plan D21, decision
 * 36b): no "Search this area" button. These are the plain rules for when to ask and what to keep, with no React
 * Native, so the node test runner can load them.
 */
type Point = { lat: number; lng: number };

/** Straight-line distance in km (kept here so this file loads in the node test runner without imports). */
function distanceKm(a: Point, b: Point): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Wait this long after the last move end before asking. */
export const REFRESH_DEBOUNCE_MS = 600;
/** Answers are kept this long, so going back to a place just seen asks nothing. */
export const REFRESH_CACHE_MS = 5 * 60 * 1000;

/** How far the middle must move (km) before it is worth asking again: a third of the reach, never under 1 km. */
export function refreshDistanceKm(radiusKm: number): number {
  return Math.max(1, radiusKm / 3);
}

/**
 * Ask again? Yes when nothing was searched yet, when the map was zoomed out past the reach, or when the middle
 * moved more than `refreshDistanceKm` from where the last search was made.
 */
export function shouldRefresh({
  searchedAt,
  centre,
  radiusKm,
  zoomedOutPastReach = false,
}: {
  searchedAt: Point | null;
  centre: Point;
  radiusKm: number;
  zoomedOutPastReach?: boolean;
}): boolean {
  if (!searchedAt || zoomedOutPastReach) return true;
  return distanceKm(searchedAt, centre) > refreshDistanceKm(radiusKm);
}

/** A search made at nearly the same place with the same reach is the same search: the centre is rounded to ~0.01 degrees (about 1 km). */
export function refreshKey(kind: string, centre: Point, radiusKm: number): string {
  return `${kind}|${centre.lat.toFixed(2)}|${centre.lng.toFixed(2)}|${radiusKm}`;
}

/** A small in-memory cache with an expiry. `now` is a parameter so tests need no clock. */
export function createRefreshCache<T>(ttlMs: number = REFRESH_CACHE_MS, max = 20) {
  const map = new Map<string, { at: number; value: T }>();
  return {
    get(key: string, now: number): T | undefined {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (now - hit.at > ttlMs) {
        map.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key: string, value: T, now: number) {
      map.delete(key);
      map.set(key, { at: now, value });
      // The oldest goes first.
      while (map.size > max) map.delete(map.keys().next().value as string);
    },
    clear() {
      map.clear();
    },
    get size() {
      return map.size;
    },
  };
}
