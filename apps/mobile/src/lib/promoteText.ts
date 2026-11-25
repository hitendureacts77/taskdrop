/** Plain-words helpers for the Promote screens. Pure, so they are unit-tested. */

/** "2 days 5 h left", "5 h 10 min left", "12 min left", or "Ended". */
export function timeLeftText(endsAt: string | null | undefined, now: number = Date.now()): string {
  if (!endsAt) return '';
  const ms = new Date(endsAt).getTime() - now;
  if (!Number.isFinite(ms) || ms <= 0) return 'Ended';
  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${days} ${days === 1 ? 'day' : 'days'}${hours ? ` ${hours} h` : ''} left`;
  if (hours > 0) return `${hours} h${mins % 60 ? ` ${mins % 60} min` : ''} left`;
  return `${Math.max(mins, 1)} min left`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

/** "today at 4:30 pm", "tomorrow at 9:00 am", or "26 Nov at 9:00 am". Empty when there is no time. */
export function whenText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const today = new Date(now);
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((startOf(d) - startOf(today)) / 86400000);
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${day} at ${clock(d)}`;
}

/** Just the clock, for "held until 4:30 pm". */
export function clockText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? clock(d) : '';
}

export const SURFACE_LABELS: Record<string, string> = {
  list: 'Find work',
  map: 'Map',
  home: 'Home',
  search: 'Search',
  alert: 'Alert',
  detail: 'Task page',
};

/** Service owners are shown where hirers look, so the first label differs. */
export const SERVICE_SURFACE_LABELS: Record<string, string> = { ...SURFACE_LABELS, list: 'Helpers list' };

export type SurfaceBar = { key: string; label: string; count: number; pct: number };

/** One bar per place with a non-zero count, widths relative to the largest (the largest is 100). */
export function surfaceBars(
  bySurface: Partial<Record<string, number>> | null | undefined,
  service = false,
): SurfaceBar[] {
  const labels = service ? SERVICE_SURFACE_LABELS : SURFACE_LABELS;
  const rows = Object.keys(labels)
    .map((key) => ({ key, label: labels[key]!, count: Math.max(0, Number(bySurface?.[key] ?? 0)) }))
    .filter((r) => r.count > 0);
  const max = Math.max(1, ...rows.map((r) => r.count));
  return rows.map((r) => ({ ...r, pct: Math.max(4, Math.round((r.count / max) * 100)) }));
}

/** The flat price: days x the day price, in paise. The server refuses any other amount. */
export const promotionPriceMinor = (days: number, dayPriceMinor: number): number => days * dayPriceMinor;

export const daysLabel = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;
