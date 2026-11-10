/**
 * The Explore map's filters (plan D23, owner video 9 Nov): where (your place or one you pick), how far,
 * pay, in person or from home, and the order. Plain functions, no React Native, so the node test runner
 * can load them.
 */

/** Straight-line km (haversine), as in mapReach; kept here so this file loads on its own in the node tests. */
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 12742 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type WorkType = 'all' | 'local' | 'remote';
export type JobSort = 'pay' | 'near' | 'new';

export type MapFilters = {
  /** How far from the place, in whole km (1 to 100). */
  km: number;
  /** The lowest offer to show, in rupees; 0 shows every offer. */
  minPay: number;
  work: WorkType;
  sort: JobSort;
};

export const DEFAULT_FILTERS: MapFilters = { km: 10, minPay: 0, work: 'all', sort: 'pay' };

/** The one-tap distances in the Filters sheet; the slider reaches every whole km between. */
export const KM_STEPS = [2, 5, 10, 25, 50, 100];
/** The one-tap pay floors, in rupees. */
export const PAY_STEPS = [0, 500, 1000, 2000];

export const WORK_LABELS: Record<WorkType, string> = { all: 'All', local: 'In person', remote: 'From home' };
export const SORT_LABELS: Record<JobSort, string> = { pay: 'Best pay', near: 'Nearest', new: 'Newest' };

/** Where the filters are stored on this device. */
export const FILTERS_KEY = 'taskdrop.map.filters';

/** What was saved on the device, made safe; anything missing or odd falls back to the default. */
export function parseSavedFilters(raw: string | null | undefined): MapFilters {
  if (!raw) return DEFAULT_FILTERS;
  try {
    const v = JSON.parse(raw) as Partial<MapFilters>;
    const km = typeof v.km === 'number' && Number.isFinite(v.km) ? Math.min(100, Math.max(1, Math.round(v.km))) : DEFAULT_FILTERS.km;
    const minPay = typeof v.minPay === 'number' && PAY_STEPS.includes(v.minPay) ? v.minPay : DEFAULT_FILTERS.minPay;
    const work = v.work === 'local' || v.work === 'remote' || v.work === 'all' ? v.work : DEFAULT_FILTERS.work;
    const sort = v.sort === 'near' || v.sort === 'new' || v.sort === 'pay' ? v.sort : DEFAULT_FILTERS.sort;
    return { km, minPay, work, sort };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** How many filters differ from the default (the badge on the Filters button). Distance always counts as chosen, so it is left out. */
export function changedFilters(f: MapFilters): number {
  return (f.minPay !== DEFAULT_FILTERS.minPay ? 1 : 0) + (f.work !== DEFAULT_FILTERS.work ? 1 : 0) + (f.sort !== DEFAULT_FILTERS.sort ? 1 : 0);
}

export type FilterableJob = {
  id: string;
  loc_lat: number | null;
  loc_lng: number | null;
  benchmark_minor: number;
  created_at: string;
};

/**
 * The jobs the list shows: the ones with a pin inside `km` of the place (never of wherever the map was
 * dragged to), plus the from-home ones, each kind only when the work type allows it; then the pay floor
 * and the order. A from-home job has no distance, so "Nearest" puts it after the pinned ones.
 */
export function filterJobs<T extends FilterableJob>(pinned: T[], remote: T[], at: { lat: number; lng: number } | null, f: MapFilters): T[] {
  const near = f.work === 'remote' || !at ? [] : pinned.filter((j) => j.loc_lat != null && j.loc_lng != null && distanceKm(at, { lat: j.loc_lat, lng: j.loc_lng }) <= f.km);
  const home = f.work === 'local' ? [] : remote.filter((j) => j.loc_lat == null);
  const floor = f.minPay * 100;
  const all = [...near, ...home].filter((j) => j.benchmark_minor >= floor);
  const dist = (j: T) => (at && j.loc_lat != null && j.loc_lng != null ? distanceKm(at, { lat: j.loc_lat, lng: j.loc_lng }) : Infinity);
  const sorted = [...all];
  if (f.sort === 'near') sorted.sort((a, b) => dist(a) - dist(b) || b.benchmark_minor - a.benchmark_minor);
  else if (f.sort === 'new') sorted.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  else sorted.sort((a, b) => b.benchmark_minor - a.benchmark_minor);
  return sorted;
}

/** "4 jobs within 10 km · 3 from home": the one line under the best offer. */
export function jobsSummary(nearCount: number, homeCount: number, km: number, work: WorkType): string {
  const n = (c: number) => `${c} ${c === 1 ? 'job' : 'jobs'}`;
  if (work === 'remote') return `${n(homeCount)} you can do from home`;
  if (work === 'local') return `${n(nearCount)} within ${km} km`;
  return homeCount > 0 ? `${n(nearCount)} within ${km} km · ${homeCount} from home` : `${n(nearCount)} within ${km} km`;
}
