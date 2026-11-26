/** Plain-words helpers for the Promote screens. Pure, so they are unit-tested. */
import { PROMOTE_DEFAULTS, estimateTopShows, isBusyArea, isPromoteBudget } from '@taskdrop/rules';

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
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function clock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
}

const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();

/** "today at 4:30 pm", "tomorrow at 9:00 am", or "26 Nov at 9:00 am". Empty when there is no time. */
export function whenText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const diff = Math.round((startOfDay(d) - startOfDay(new Date(now))) / 86400000);
  const day = diff === 0 ? 'today' : diff === 1 ? 'tomorrow' : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${day} at ${clock(d)}`;
}

/** Just the clock, for "held until 4:30 pm". */
export function clockText(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isFinite(d.getTime()) ? clock(d) : '';
}

/** "6 pm" or "6:30 pm". */
function hourClock(d: Date): string {
  const h = d.getHours();
  const m = d.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}`;
}

/** "today 6 pm", "tomorrow 6 pm", "Fri 6 pm", "next Tue 9 am", or "2 Dec 9 am". Empty when there is no time. */
export function endText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const diff = Math.round((startOfDay(d) - startOfDay(new Date(now))) / 86400000);
  const wd = WEEKDAYS[d.getDay()]!;
  const day =
    diff === 0
      ? 'today'
      : diff === 1
        ? 'tomorrow'
        : Math.abs(diff) <= 6
          ? wd
          : diff >= 7 && diff <= 13
            ? `next ${wd}`
            : `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `${day} ${hourClock(d)}`;
}

/** When a campaign bought now would end: the days from now, as an ISO time. */
export const campaignEndIso = (days: number, now: number = Date.now()): string => new Date(now + days * 86400000).toISOString();

export const SURFACE_LABELS: Record<string, string> = {
  list: 'Find work',
  home: 'Home',
  map: 'Map',
  search: 'Search',
  alert: 'Alert',
  detail: 'Task page',
};

/** Service owners are shown where hirers look, so the first label differs. */
export const SERVICE_SURFACE_LABELS: Record<string, string> = { ...SURFACE_LABELS, list: 'Helpers' };

export type SurfaceBar = { key: string; label: string; count: number; pct: number };

/** One bar per place with a non-zero count, biggest first; pct is the place's share of all the shown places. */
export function surfaceBars(
  bySurface: Partial<Record<string, number>> | null | undefined,
  service = false,
): SurfaceBar[] {
  const labels = service ? SERVICE_SURFACE_LABELS : SURFACE_LABELS;
  const rows = Object.keys(labels)
    .map((key) => ({ key, label: labels[key]!, count: Math.max(0, Number(bySurface?.[key] ?? 0)) }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count);
  const total = Math.max(1, rows.reduce((n, r) => n + r.count, 0));
  return rows.map((r) => ({ ...r, pct: Math.max(1, Math.round((r.count / total) * 100)) }));
}

export const daysLabel = (n: number): string => `${n} ${n === 1 ? 'day' : 'days'}`;

/** Money in paise as rupees: whole rupees stay whole, anything else shows two places ("₹240", "₹0.53"). */
export function moneyText(minor: number): string {
  const rupees = (Number.isFinite(minor) ? minor : 0) / 100;
  return '₹' + rupees.toLocaleString('en-IN', Number.isInteger(rupees) ? { maximumFractionDigits: 0 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** What is paid upfront: the daily budget times the days, in paise. The server refuses any other amount. */
export const campaignTotalMinor = (dayMinor: number, days: number): number => dayMinor * days;

/** The quick amounts offered under the big number, in whole rupees. "Other" opens a box for the rest. */
export const BUDGET_PRESETS_RUPEES: readonly number[] = PROMOTE_DEFAULTS.BUDGET_PRESETS_MINOR.map((m) => m / 100);
/** What is picked before the person chooses. */
export const DEFAULT_BUDGET_RUPEES = PROMOTE_DEFAULTS.DEFAULT_DAY_MINOR / 100;

export type Limits = { minRupees: number; maxRupees: number };

/** The limits in whole rupees, from the quote or the shared defaults. */
export function limitsFrom(minDayMinor?: number | null, maxDayMinor?: number | null): Limits {
  return {
    minRupees: Math.ceil((minDayMinor ?? PROMOTE_DEFAULTS.MIN_DAY_MINOR) / 100),
    maxRupees: Math.floor((maxDayMinor ?? PROMOTE_DEFAULTS.MAX_DAY_MINOR) / 100),
  };
}

/** A budget typed, as whole rupees within the limits, or the reason it is not. Empty text is neither. */
export function parseBudget(text: string, limits: Limits): { rupees: number | null; error: string | null } {
  const clean = text.replace(/[₹,\s]/g, '');
  if (!clean) return { rupees: null, error: null };
  if (!/^\d+$/.test(clean)) return { rupees: null, error: 'Use whole rupees, like 80.' };
  const n = Number(clean);
  if (n < limits.minRupees) return { rupees: null, error: `The smallest daily budget is ${moneyText(limits.minRupees * 100)}.` };
  if (n > limits.maxRupees) return { rupees: null, error: `The biggest daily budget is ${moneyText(limits.maxRupees * 100)}.` };
  if (!isPromoteBudget(n * 100, limits.minRupees * 100, limits.maxRupees * 100)) {
    return { rupees: null, error: 'Use whole rupees, like 80.' };
  }
  return { rupees: n, error: null };
}

/** An amount kept inside the limits, for a starting value. */
export const clampBudget = (rupees: number, limits: Limits): number => Math.min(limits.maxRupees, Math.max(limits.minRupees, rupees));

/** A bigger amount to suggest in a busy area: the next quick amount up, or double, kept under the limit. Null when there is no room. */
export function raisedBudget(rupees: number, limits: Limits): number | null {
  const next = BUDGET_PRESETS_RUPEES.find((p) => p > rupees) ?? rupees * 2;
  const out = Math.min(next, limits.maxRupees);
  return out > rupees ? out : null;
}

/** "90 to 140 top shows a day". */
export function estimateText(dayMinor: number, areaPriceMinor: number | null | undefined): string {
  const { low, high } = estimateTopShows(dayMinor, areaPriceMinor);
  return low === high ? `About ${high} top shows a day` : `${low} to ${high} top shows a day`;
}

const othersAre = (n: number): string => (n === 1 ? '1 other is' : `${n} others are`);

/** The warning for a busy area (isBusyArea). Null when the area is not busy. */
export function busyNote(others: number, areaKm: number, areaPriceMinor: number | null | undefined): { title: string; body: string } | null {
  if (!(others > 0) || !isBusyArea(others, areaPriceMinor)) return null;
  const price = areaPriceMinor && areaPriceMinor > 0 ? `a top show costs about ${moneyText(areaPriceMinor)} here` : 'a top show can cost more here';
  return { title: 'Busy here right now.', body: `${othersAre(others)} promoting within ${areaKm} km, so ${price}.` };
}

/** The small line under the estimate: what a bigger budget would buy when busy, else who else is promoting. */
export function estimateNote(args: {
  others: number;
  areaKm: number;
  areaPriceMinor: number | null | undefined;
  remote: boolean;
  service: boolean;
  raisedRupees: number | null;
}): string {
  const { others, areaKm, areaPriceMinor, remote, service, raisedRupees } = args;
  if (remote) return service ? 'Shown to customers anywhere.' : 'Shown to workers anywhere.';
  if (others > 0 && isBusyArea(others, areaPriceMinor)) {
    if (raisedRupees === null) return '';
    const { low, high } = estimateTopShows(raisedRupees * 100, areaPriceMinor);
    return `${moneyText(raisedRupees * 100)} a day would get about ${low} to ${high}.`;
  }
  const price = areaPriceMinor && areaPriceMinor > 0 ? areaPriceMinor : PROMOTE_DEFAULTS.PRICE_GUESS_MINOR;
  const who = others > 0 ? `${others === 1 ? '1 other' : `${others} others`} promoting within ${areaKm} km` : `No one else is promoting within ${areaKm} km right now`;
  return `${who} · usual price here ${moneyText(price)} per top show`;
}

/** Under the Promote button. */
export function payNote(totalMinor: number, days: number): string {
  return days === 1
    ? `You pay ${moneyText(totalMinor)} now. It runs for 1 day and can't be stopped or refunded.`
    : `You pay ${moneyText(totalMinor)} now. It runs all ${days} days and can't be stopped or refunded.`;
}

/** The "Pay ₹240 and start?" box. */
export function confirmCopy(totalMinor: number, days: number, endIso: string, now: number = Date.now()): { title: string; message: string; confirm: string } {
  const run = days === 1 ? 'for 1 day' : `for all ${days} days`;
  const until = endText(endIso, now);
  return {
    title: `Pay ${moneyText(totalMinor)} and start?`,
    message: `It runs ${run}${until ? `, until ${until}` : ''}. Once it starts you can't stop it or get the money back.`,
    confirm: `Pay ${moneyText(totalMinor)}`,
  };
}

/** The footer of a live promotion. */
export function runsUntilText(iso: string | null | undefined, now: number = Date.now()): string {
  const until = endText(iso, now);
  return until ? `Runs until ${until}. A paid promotion can't be stopped.` : "A paid promotion can't be stopped.";
}

/** A refusal or failure, in a box: a bold start and what to do next. */
export type PromoteProblem = { title: string; body: string };

/** The server's refusals to start a promotion, in plain words. Null when it is some other failure. */
export function refusalProblem(message: string, limits: Limits, service = false): PromoteProblem | null {
  const thing = service ? 'service' : 'task';
  if (/budget is not offered/i.test(message)) {
    return { title: 'That budget is not offered.', body: `Pick an amount from ${moneyText(limits.minRupees * 100)} to ${moneyText(limits.maxRupees * 100)} a day.` };
  }
  if (/length is not offered/i.test(message)) {
    return { title: 'That length is not offered.', body: 'Pick 1, 3 or 7 days.' };
  }
  if (/only an open post/i.test(message)) {
    return { title: `This ${thing} is no longer open.`, body: `Only open ${thing}s can be promoted. Reopen it or post a new one.` };
  }
  if (/already has a campaign running/i.test(message)) {
    return { title: 'Already promoted.', body: "This post has a promotion running. Open it to see how it's doing." };
  }
  return null;
}

/** The box for a payment that did not go through. Nothing is charged. */
export const PAYMENT_FAILED: PromoteProblem = {
  title: "Payment didn't go through.",
  body: 'Nothing was charged. Check your wallet balance or try another way to pay.',
};

/** "just now", "2 min ago", "3 h ago", "2 days ago". */
export function agoText(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '';
  const ms = now - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return '';
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  return `${days} ${days === 1 ? 'day' : 'days'} ago`;
}

/** "3 days 5 h", "5 h", or "12 min" between two times. Empty when either is missing or the order is wrong. */
export function spanText(fromIso: string | null | undefined, toIso: string | null | undefined): string {
  if (!fromIso || !toIso) return '';
  const mins = Math.floor((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000);
  if (!Number.isFinite(mins) || mins < 0) return '';
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  if (days > 0) return `${daysLabel(days)}${hours ? ` ${hours} h` : ''}`;
  if (hours > 0) return `${hours} h`;
  return `${Math.max(mins, 1)} min`;
}

/** The part of a result's numbers the card needs to choose its look. */
export type ResultsLike = {
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  spentMinor: number;
  topShows: number;
  saw: number;
  todaySpentMinor: number;
  todayBudgetMinor: number;
};

export type PromoState = 'waiting' | 'empty' | 'live' | 'paused' | 'ended';

/** Paused today = running, but what is left of today's budget buys no top show. */
export const isPausedToday = (r: ResultsLike, floorMinor: number = PROMOTE_DEFAULTS.FLOOR_MINOR): boolean =>
  r.status === 'active' && r.todayBudgetMinor - r.todaySpentMinor < floorMinor;

export function promoState(r: ResultsLike): PromoState {
  if (r.status === 'pending') return 'waiting';
  if (r.status !== 'active') return 'ended';
  if (isPausedToday(r)) return 'paused';
  if (r.topShows === 0 && r.saw === 0 && r.spentMinor === 0) return 'empty';
  return 'live';
}

/** What one offer cost, in paise. Null while there are no offers to divide by. */
export const costPerOfferMinor = (spentMinor: number, offers: number): number | null =>
  offers > 0 ? Math.round(spentMinor / offers) : null;

/** "A quiet day ... ran 5 h longer ...". Empty when it ended on time. */
export function ranLongerText(endsAt: string | null | undefined, lastEndAt: string | null | undefined): string {
  const span = spanText(endsAt, lastEndAt);
  return span && span !== '1 min' ? `A quiet day moved its leftover on, so it ran ${span} longer to use the whole budget.` : '';
}

/** "We also sent one alert to 18 workers nearby." Empty when nobody was alerted. */
export function alertedText(n: number): string {
  return n > 0 ? `We also sent one alert to ${n} ${n === 1 ? 'worker' : 'workers'} nearby.` : '';
}
