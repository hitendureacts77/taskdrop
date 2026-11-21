/**
 * The Find work filters (plan D23, then D27 / task 1.17): one set shared by the map and the list.
 * Where (your place or one you pick), how far, Nearby or Remote, a price range, how the poster hires
 * (Auto-hire, Open to counter offers), due in 24 hours, and the order. No category (owner, 11 Nov).
 * Plain functions, no React Native, so the node test runner can load them.
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
  /** The lowest price to show, in rupees; 0 = no floor. */
  minPay: number;
  /** The highest price to show, in rupees; 0 = no ceiling. */
  maxPay: number;
  work: WorkType;
  /** Only jobs whose poster turned on Auto-hire. */
  auto: boolean;
  /** Only jobs whose poster picks from offers (you can send your own price). */
  offers: boolean;
  /** Only jobs marked urgent or due within a day. */
  dueSoon: boolean;
  sort: JobSort;
};

export const DEFAULT_FILTERS: MapFilters = { km: 10, minPay: 0, maxPay: 0, work: 'all', auto: false, offers: false, dueSoon: false, sort: 'pay' };

/** The one-tap distances in the Filters sheet; the slider reaches every whole km between. */
export const KM_STEPS = [2, 5, 10, 25, 50, 100];
/** The biggest price a box takes, in rupees (₹10 lakh). */
export const MAX_PRICE = 1_000_000;
/** The one-tap price ranges, in rupees (0 = open end). */
export const PRICE_PRESETS: { min: number; max: number }[] = [
  { min: 0, max: 0 },
  { min: 0, max: 300 },
  { min: 300, max: 1000 },
  { min: 1000, max: 5000 },
  { min: 5000, max: 0 },
];
/** Where one one-tap range ends and the next begins (₹300, ₹1,000, ₹5,000). */
const RANGE_EDGES = new Set(PRICE_PRESETS.filter((p) => p.min > 0).map((p) => p.min));
/** Is the price range one of the one-tap ranges (not typed)? */
const isPreset = (f: Pick<MapFilters, 'minPay' | 'maxPay'>) => PRICE_PRESETS.some((p) => p.min === f.minPay && p.max === f.maxPay);

/** The next one-tap distance up from `km`, also from a typed one like 7 km (S5-20); past the last it starts again. */
export const nextKmStep = (km: number) => KM_STEPS.find((k) => k > km) ?? KM_STEPS[0]!;

export const WORK_LABELS: Record<WorkType, string> = { all: 'All', local: 'Nearby', remote: 'Remote' };
export const SORT_LABELS: Record<JobSort, string> = { pay: 'Best pay', near: 'Nearest', new: 'Newest' };
export const DUE_SOON_MS = 24 * 3600 * 1000;

/** Where the filters are stored on this device. */
export const FILTERS_KEY = 'taskdrop.map.filters';

/** "₹1,200": Indian grouping. */
export const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');

/** "Any price", "Under ₹300", "₹1,000+", "₹300–₹1,000". */
export function priceLabel(f: Pick<MapFilters, 'minPay' | 'maxPay'>): string {
  if (f.minPay > 0 && f.maxPay > 0) return `${inr(f.minPay)}–${inr(f.maxPay)}`;
  if (f.minPay > 0) return `${inr(f.minPay)}+`;
  if (f.maxPay > 0) return `Under ${inr(f.maxPay)}`;
  return 'Any price';
}

const price = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(MAX_PRICE, Math.max(0, Math.round(v))) : 0);

/** A price range made safe: whole rupees, a ceiling under the floor swaps the two. */
export function cleanPrice(minPay: number, maxPay: number): { minPay: number; maxPay: number } {
  const lo = price(minPay);
  const hi = price(maxPay);
  return hi > 0 && hi < lo ? { minPay: hi, maxPay: lo } : { minPay: lo, maxPay: hi };
}

/** What was saved on the device, made safe; anything missing or odd falls back to the default. Older saves (no range, no hire type) still load. */
export function parseSavedFilters(raw: string | null | undefined): MapFilters {
  if (!raw) return DEFAULT_FILTERS;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof MapFilters, unknown>>;
    if (!v || typeof v !== 'object') return DEFAULT_FILTERS;
    const km = typeof v.km === 'number' && Number.isFinite(v.km) ? Math.min(100, Math.max(1, Math.round(v.km))) : DEFAULT_FILTERS.km;
    const work = v.work === 'local' || v.work === 'remote' || v.work === 'all' ? v.work : DEFAULT_FILTERS.work;
    const sort = v.sort === 'near' || v.sort === 'new' || v.sort === 'pay' ? v.sort : DEFAULT_FILTERS.sort;
    return { km, ...cleanPrice(price(v.minPay), price(v.maxPay)), work, auto: v.auto === true, offers: v.offers === true, dueSoon: v.dueSoon === true, sort };
  } catch {
    return DEFAULT_FILTERS;
  }
}

/** Is a price range set? */
export const hasPrice = (f: MapFilters) => f.minPay > 0 || f.maxPay > 0;

/** How many filters differ from the default (the badge on the Filters button). Distance always counts as chosen, so it is left out. */
export function changedFilters(f: MapFilters): number {
  return (hasPrice(f) ? 1 : 0) + (f.work !== 'all' ? 1 : 0) + (f.auto ? 1 : 0) + (f.offers ? 1 : 0) + (f.dueSoon ? 1 : 0) + (f.sort !== 'pay' ? 1 : 0);
}

/** Does anything hide jobs? (The order never does.) */
export const narrowsJobs = (f: MapFilters) => hasPrice(f) || f.work !== 'all' || f.auto || f.offers || f.dueSoon;

/** Every filter that hides jobs back to "all", keeping the distance and the order. */
export const clearJobFilters = (f: MapFilters): MapFilters => ({ ...f, minPay: 0, maxPay: 0, work: 'all', auto: false, offers: false, dueSoon: false });

export type FilterableJob = {
  id: string;
  loc_lat: number | null;
  loc_lng: number | null;
  benchmark_minor: number;
  created_at: string;
  assignment_mode?: string | null;
  due_at?: string | null;
  flag?: string | null;
};

/**
 * The filters that do not care where a job is: price range, how they hire, due in 24 hours.
 * Auto-hire and Open to counter offers both on (or both off) means both kinds.
 */
export function matchesJob(j: FilterableJob, f: MapFilters, now: number = Date.now()): boolean {
  const rupees = j.benchmark_minor / 100;
  if (f.minPay > 0 && rupees < f.minPay) return false;
  if (f.maxPay > 0 && rupees > f.maxPay) return false;
  // A price on the edge of two one-tap ranges belongs to the upper one, so each job sits in exactly one
  // range and the ranges add up to "Any price" (B179: a ₹300 job was in "Under ₹300" and "₹300–₹1,000").
  // Only for those one-tap ranges: a typed top price keeps a job priced exactly at it (S5-21).
  if (f.maxPay > 0 && rupees === f.maxPay && RANGE_EDGES.has(f.maxPay) && isPreset(f)) return false;
  if (f.auto !== f.offers) {
    const auto = j.assignment_mode === 'auto';
    if (f.auto ? !auto : auto) return false;
  }
  if (f.dueSoon) {
    const due = j.due_at ? Date.parse(j.due_at) : NaN;
    if (j.flag !== 'urgent' && !(Number.isFinite(due) && due <= now + DUE_SOON_MS)) return false;
  }
  return true;
}

function sortJobs<T extends FilterableJob>(jobs: T[], at: { lat: number; lng: number } | null, sort: JobSort): T[] {
  const dist = (j: T) => (at && j.loc_lat != null && j.loc_lng != null ? distanceKm(at, { lat: j.loc_lat, lng: j.loc_lng }) : Infinity);
  const out = [...jobs];
  if (sort === 'near') out.sort((a, b) => dist(a) - dist(b) || b.benchmark_minor - a.benchmark_minor);
  else if (sort === 'new') out.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  else out.sort((a, b) => b.benchmark_minor - a.benchmark_minor);
  return out;
}

/**
 * The jobs the map's list shows: the ones with a pin inside `km` of the place (never of wherever the map was
 * dragged to), plus the remote ones, each kind only when Nearby / Remote allows it; then the price range,
 * the hire type, due in 24 hours, and the order. A remote job has no distance, so "Nearest" puts it last.
 */
export function filterJobs<T extends FilterableJob>(pinned: T[], remote: T[], at: { lat: number; lng: number } | null, f: MapFilters, now: number = Date.now()): T[] {
  const near = f.work === 'remote' || !at ? [] : pinned.filter((j) => j.loc_lat != null && j.loc_lng != null && distanceKm(at, { lat: j.loc_lat, lng: j.loc_lng }) <= f.km);
  const home = f.work === 'local' ? [] : remote.filter((j) => j.loc_lat == null);
  return sortJobs([...near, ...home].filter((j) => matchesJob(j, f, now)), at, f.sort);
}

/**
 * The Find work list: one mixed list of jobs. With a place it shows the same jobs as the map; with no place
 * yet a pinned job cannot be measured, so "All" lists every job without a distance, and "Nearby" lists none
 * (S5-6: it showed every pinned job in the country; the list asks for an area instead).
 */
export function filterList<T extends FilterableJob>(rows: T[], at: { lat: number; lng: number } | null, f: MapFilters, now: number = Date.now()): T[] {
  const pinned = rows.filter((j) => j.loc_lat != null && j.loc_lng != null);
  const remote = rows.filter((j) => j.loc_lat == null);
  if (at) return filterJobs(pinned, remote, at, f, now);
  const near = f.work === 'all' ? pinned : [];
  const home = f.work === 'local' ? [] : remote;
  return sortJobs([...near, ...home].filter((j) => matchesJob(j, f, now)), null, f.sort);
}

/** The filters one tap could loosen when nothing (or little) matches: each says what it drops, with the filters it would leave. */
export function dropOptions(f: MapFilters): { key: string; label: string; next: MapFilters }[] {
  const out: { key: string; label: string; next: MapFilters }[] = [];
  if (f.auto) out.push({ key: 'auto', label: 'Drop Auto-hire', next: { ...f, auto: false } });
  if (f.offers) out.push({ key: 'offers', label: 'Drop Open to offers', next: { ...f, offers: false } });
  if (f.dueSoon) out.push({ key: 'due', label: 'Any due date', next: { ...f, dueSoon: false } });
  if (hasPrice(f)) out.push({ key: 'price', label: 'Any price', next: { ...f, minPay: 0, maxPay: 0 } });
  if (f.work !== 'all') out.push({ key: 'work', label: f.work === 'local' ? 'Add remote jobs' : 'Add nearby jobs', next: { ...f, work: 'all' } });
  const wider = KM_STEPS.find((k) => k > f.km);
  if (wider && f.work !== 'remote') out.push({ key: 'km', label: `Widen to ${wider} km`, next: { ...f, km: wider } });
  return out;
}

/**
 * The pill over the map. The map draws every pin in view, also past the reach, so its count can be larger
 * than the panel's "within 10 km": when it is, the pill says both, so "110 on the map" never sits beside
 * "Jobs · 84" unexplained (W2-17).
 */
export function mapPillText(onMap: number, inReach: number, km: number, words: { one: string; many: string }): string {
  if (onMap === 0) return `No ${words.many} on this part of the map`;
  const noun = onMap === 1 ? words.one : words.many;
  if (onMap <= inReach) return `${onMap} ${noun} on the map`;
  return `${onMap} ${noun} on the map · ${inReach} within ${km} km`;
}

/** "4 jobs within 10 km · 3 remote": the one line under the best offer. */
/**
 * The one way every Find work count is said (card, list and map, B170). `capped` marks a count whose read came
 * back full, so the true total is unknown: it reads "200+", never the read's limit as if it were a count.
 */
export function jobsSummary(
  nearCount: number,
  homeCount: number,
  km: number,
  work: WorkType,
  capped: { near?: boolean; home?: boolean } = {},
): string {
  const num = (c: number, more?: boolean) => `${c}${more ? '+' : ''}`;
  const n = (c: number, more?: boolean) => `${num(c, more)} ${c === 1 && !more ? 'job' : 'jobs'}`;
  if (work === 'remote') return `${n(homeCount, capped.home)} you can do remotely`;
  if (work === 'local') return `${n(nearCount, capped.near)} within ${km} km`;
  return homeCount > 0
    ? `${n(nearCount, capped.near)} within ${km} km · ${num(homeCount, capped.home)} remote`
    : `${n(nearCount, capped.near)} within ${km} km`;
}
