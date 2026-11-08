/**
 * The map shows every task it was given (zoomed out: the whole country) while the
 * "How far" choice (5 / 10 / 25 km) only filters the list and summary cards and
 * zooms the map to fit that circle. Plain functions, no React Native, so the
 * node test runner can load them.
 */

/** The tile map floors its zoom into this range; the native map uses it as is. */
export const FIT_MIN_ZOOM = 5;
export const FIT_MAX_ZOOM = 17;

/**
 * The zoom at which a circle of radius `km` (its diameter) fills `pad` of the
 * smaller side of the map, `px` pixels. Web-mercator, 256 px tiles.
 */
export function zoomToFit(km: number, lat: number, px: number, pad = 0.85): number {
  const cos = Math.max(0.05, Math.cos((lat * Math.PI) / 180));
  const z = Math.log2((Math.max(1, px) * pad * 156543.03392 * cos) / (2000 * Math.max(0.1, km)));
  return Math.min(FIT_MAX_ZOOM, Math.max(FIT_MIN_ZOOM, z));
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Placed = { loc_lat: number | null; loc_lng: number | null };

/**
 * Only the items that sit inside `km` of `at`; one with no place is dropped. By
 * default an item's place is `loc_lat` / `loc_lng`; pass `pos` for other shapes.
 */
export function withinReach<T>(
  list: T[],
  at: { lat: number; lng: number },
  km: number,
  pos: (item: T) => { lat: number | null; lng: number | null } = (item) => ({
    lat: (item as unknown as Placed).loc_lat,
    lng: (item as unknown as Placed).loc_lng,
  }),
): T[] {
  return list.filter((item) => {
    const p = pos(item);
    return p.lat != null && p.lng != null && haversineKm(at, { lat: p.lat, lng: p.lng }) <= km;
  });
}

const plainRupees = (n: number) => `₹${Math.round(n).toLocaleString('en-IN')}`;

/** "under 1 km" / "~2.4 km", as farText in mapPins (kept here so this file stays loadable in tests). */
function far(km: number): string {
  return km < 1 ? 'under 1 km' : `~${km.toFixed(km < 10 ? 1 : 0)} km`;
}

/**
 * The words that name the reach: the two tile labels and the one-line pitch above
 * them. `best` and `nearest` are the jobs inside the reach (null when none).
 */
export function reachWords({
  radius,
  best,
  nearest,
  money = plainRupees,
}: {
  radius: number;
  best: { id: string; rupees: number; km: number } | null;
  nearest: { id: string; rupees: number; km: number } | null;
  /** How an amount is written; the screen passes the app's own rupee formatter. */
  money?: (n: number) => string;
}) {
  const bestLabel = `Best offer within ${radius} km`;
  const nearestLabel = 'Nearest job';
  let pitch = '';
  if (best && nearest) {
    pitch =
      best.id === nearest.id
        ? `A ${money(best.rupees)} job is ${far(best.km)} away, the best within ${radius} km.`
        : `The nearest job is ${far(nearest.km)} away. The best offer within ${radius} km is ${money(best.rupees)}.`;
  }
  return { bestLabel, nearestLabel, pitch };
}
