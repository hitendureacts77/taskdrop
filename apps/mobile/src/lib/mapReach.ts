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

/** The reaches you can pick in one tap; "Custom" adds one more. */
export const REACH_PRESETS = [5, 10, 25];
/** A custom distance is a whole number of km in this range. */
export const MIN_REACH_KM = 1;
export const MAX_REACH_KM = 100;
/** The server's own limit for the "My people" call. */
export const PEOPLE_MAX_KM = 50;
/** Where the last custom distance is kept on the device. */
export const CUSTOM_REACH_KEY = 'taskdrop.map.customReachKm';

/** Straight-line distance in km (haversine). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  return haversineKm(a, b);
}

/** Round to a whole number of km and keep it in 1 to 100. */
export function clampReach(n: number): number {
  if (!Number.isFinite(n)) return MIN_REACH_KM;
  return Math.min(MAX_REACH_KM, Math.max(MIN_REACH_KM, Math.round(n)));
}

/**
 * What someone typed into the "Set your distance" box: "45", " 45 km ", "45.4" -> 45 (a number above 100 is
 * clamped to 100). Empty, 0, negative or anything that is not a number -> null.
 */
export function parseReachKm(input: string): number | null {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(?:km)?\s*$/i.exec(input);
  if (!m) return null;
  const n = Math.round(Number(m[1]));
  return n < MIN_REACH_KM ? null : clampReach(n);
}

/** What was saved on the device, or null when it is missing or not a valid distance. */
export function parseSavedReach(raw: string | null | undefined): number | null {
  return raw == null ? null : parseReachKm(raw);
}

/**
 * The distances to offer: 5 / 10 / 25, the saved custom one and the one in use (when they are not already
 * there), smallest first. `on` marks the one in use.
 */
export function reachChoices(radius: number, saved: number | null): { km: number; on: boolean }[] {
  const all = new Set<number>(REACH_PRESETS);
  if (saved !== null) all.add(saved);
  all.add(radius);
  return [...all].sort((a, b) => a - b).map((km) => ({ km, on: km === radius }));
}

/** The "My people" call never reaches past its server limit. */
export function peopleReach(radius: number): number {
  return Math.min(radius, PEOPLE_MAX_KM);
}

/** How many of these were posted on the same calendar day as `now`. */
export function postedToday(list: { created_at: string }[], now: number): number {
  const day = new Date(now).toDateString();
  return list.filter((j) => new Date(j.created_at).toDateString() === day).length;
}
