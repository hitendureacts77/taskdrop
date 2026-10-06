/**
 * TaskDrop business rules — the single source of truth for money & timing.
 *
 * These are DEFAULTS. At runtime the server reads the same keys from the
 * `settings` table (admin-configurable, tunable per city/pillar). Clients use
 * these constants for optimistic display only; the Edge Functions are always
 * authoritative for anything touching money.
 *
 * Every figure here is traceable to the v4 build plan, section 05 + "Locked-in
 * defaults".
 */

/** Fees & penalties, expressed as fractions (0.10 === 10%). */
export const FEES = {
  /**
   * Flat commission taken from the worker on every completed order. The live
   * value is the worker_commission_pct setting in Postgres, which the payout
   * functions read; keep the two the same.
   */
  WORKER_COMMISSION_PCT: 0.1,
  /** Service fee added on top of the locked value, paid by the poster at escrow. */
  POSTER_SERVICE_FEE_PCT: 0.03,
  /** Fine on the poster for cancelling AFTER the worker has started (normal, not overdue). */
  POST_START_CANCEL_PENALTY_PCT: 0.05,
} as const;

/** Timing windows. */
export const TIMING = {
  /** Poster's window to Accept or Request Revisions after Work Done; then auto-completes. */
  REVIEW_WINDOW_DAYS: 3,
  /** Cleared-funds hold after completion before earnings become withdrawable. */
  CLEARING_PERIOD_DAYS: 7,
} as const;

/** Media constraints. */
export const MEDIA = {
  /** Max length of a feed / task showcase video, in seconds. */
  MAX_VIDEO_SECONDS: 60,
} as const;

/** Featured / Premium listing price band (indicative, India), in INR. */
export const PROMOTION = {
  MIN_FEE_INR: 150,
  MAX_FEE_INR: 500,
} as const;

/** Task lifecycle states — the one-line spine plus every branch. */
export const TASK_STATUS = [
  'OPEN',
  'LOCKED',
  'TASK_STARTED',
  'OVERDUE',
  'WORK_DONE',
  'REVISION_REQUESTED',
  'COMPLETED',
  'AUTO_COMPLETED',
  'CANCELLED',
  'DISPUTED',
] as const;
export type TaskStatus = (typeof TASK_STATUS)[number];

/** Who initiated a cancellation, and why — drives the Admin Cancellation Monitor. */
export const CANCELLED_BY = ['poster', 'worker'] as const;
export type CancelledBy = (typeof CANCELLED_BY)[number];

export const CANCEL_REASON = ['normal', 'overdue'] as const;
export type CancelReason = (typeof CANCEL_REASON)[number];

/** Payout modes. Default is one-time after completion. */
export const PAYOUT_MODE = ['one_time', 'milestones'] as const;
export type PayoutMode = (typeof PAYOUT_MODE)[number];

/** Account roles. An account can hold poster+worker; admin is separate & RLS-gated. */
export const ROLES = ['admin', 'poster', 'worker'] as const;
export type Role = (typeof ROLES)[number];

/** Task visibility flags. */
export const TASK_FLAG = ['none', 'urgent', 'unique'] as const;
export type TaskFlag = (typeof TASK_FLAG)[number];

// ---------------------------------------------------------------------------
// Pure money math. Server-authoritative; clients may use for preview only.
// All amounts are in the smallest currency unit (paise/cents) to avoid floats.
// ---------------------------------------------------------------------------

/** What the poster pays into escrow at lock: locked amount + 3% service fee. */
export function posterEscrowCharge(lockedMinor: number): number {
  return Math.round(lockedMinor * (1 + FEES.POSTER_SERVICE_FEE_PCT));
}

/** What the worker nets on a completed order: locked amount minus the commission. */
export function workerNetPayout(lockedMinor: number): number {
  return Math.round(lockedMinor * (1 - FEES.WORKER_COMMISSION_PCT));
}

/** The platform's take on a completed order (worker commission + poster fee). */
export function platformRevenue(lockedMinor: number): number {
  return (
    Math.round(lockedMinor * FEES.WORKER_COMMISSION_PCT) +
    Math.round(lockedMinor * FEES.POSTER_SERVICE_FEE_PCT)
  );
}

/** Fine charged to the poster for cancelling after start (normal reason only). */
export function postStartCancelFine(lockedMinor: number): number {
  return Math.round(lockedMinor * FEES.POST_START_CANCEL_PENALTY_PCT);
}

/** When cleared funds become withdrawable, given a completion timestamp. */
export function clearAt(completedAt: Date): Date {
  const d = new Date(completedAt);
  d.setUTCDate(d.getUTCDate() + TIMING.CLEARING_PERIOD_DAYS);
  return d;
}

/** When an unreviewed Work Done auto-completes, given the delivery timestamp. */
export function autoCompleteAt(workDoneAt: Date): Date {
  const d = new Date(workDoneAt);
  d.setUTCDate(d.getUTCDate() + TIMING.REVIEW_WINDOW_DAYS);
  return d;
}

/**
 * Great-circle distance in kilometres between two points, or null when either
 * side hasn't shared a location. Callers must render the null case honestly
 * rather than guessing "nearby".
 */
export function distanceKm(
  a: { lat: number | null; lng: number | null },
  b: { lat: number | null; lng: number | null },
): number | null {
  if (a.lat == null || a.lng == null || b.lat == null || b.lng == null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** "800 m" / "4.2 km" / "12 km" — how far, phrased the way people say it. */
export function formatDistance(km: number | null): string | null {
  if (km == null || !Number.isFinite(km)) return null;
  if (km < 1) return Math.max(50, Math.round((km * 1000) / 50) * 50) + ' m';
  if (km < 10) return km.toFixed(1) + ' km';
  return Math.round(km) + ' km';
}

// ---------------------------------------------------------------------------
// Deadline phrasing. The poster is choosing "how long do I give this", so the
// UI has to say that back to them rather than only showing a date.
// ---------------------------------------------------------------------------

/** "in about 6 hours" — how far away a deadline is, in words. */
export function describeLeadTime(target: Date, now: Date = new Date()): string {
  const ms = target.getTime() - now.getTime();
  if (ms <= 0) return 'That time has already passed';
  const mins = Math.round(ms / 60000);
  if (mins < 60) return `in about ${mins} minute${mins === 1 ? '' : 's'}`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `in about ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.round(hours / 24);
  if (days < 14) return `in about ${days} day${days === 1 ? '' : 's'}`;
  return `in about ${Math.round(days / 7)} weeks`;
}

/**
 * The deadlines people actually reach for, relative to now. "This evening" is
 * dropped once the evening has gone, so a preset is never already in the past.
 */
export function quickDeadlines(now: Date = new Date()): { label: string; at: Date }[] {
  const out: { label: string; at: Date }[] = [];

  const in3h = new Date(now.getTime() + 3 * 3600 * 1000);
  in3h.setMinutes(Math.round(in3h.getMinutes() / 5) * 5, 0, 0);
  out.push({ label: 'In 3 hours', at: in3h });

  const evening = new Date(now);
  evening.setHours(19, 0, 0, 0);
  if (evening.getTime() > now.getTime()) out.push({ label: 'This evening', at: evening });

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);
  out.push({ label: 'Tomorrow 9 AM', at: tomorrow });

  // Saturday morning; if it is already the weekend, the next one.
  const weekend = new Date(now);
  const untilSat = (6 - weekend.getDay() + 7) % 7 || 7;
  weekend.setDate(weekend.getDate() + untilSat);
  weekend.setHours(10, 0, 0, 0);
  out.push({ label: 'This weekend', at: weekend });

  return out;
}

// --------------------------------------------------------------- addresses ---

/**
 * The parts of an address only the person standing there can tell you.
 *
 * A pin gets a worker to the building. It does not get them to the door, and
 * reverse geocoding never will — no map knows which floor you are on or that
 * the entrance is round the back. So the map answers "where", and this answers
 * "which one", and a task needs both.
 */
export type AddressDetails = {
  /** Flat, house or block number. The one part that is not optional. */
  line1: string;
  /** Building, apartment or street, usually pre-filled from the pin. */
  line2?: string;
  landmark?: string;
  /** Anything a stranger needs in order not to phone you. */
  directions?: string;
  tag?: AddressTag;
  /** The name given when the tag is "other". */
  tagName?: string;
};

export type AddressTag = 'home' | 'work' | 'other';

const clean = (s?: string): string => (s ?? '').trim().replace(/\s+/g, ' ');

/** For comparison only: case, punctuation and spacing all stop mattering. */
const key = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * One readable line from the pieces, ordered the way someone says it out loud:
 * the door, then the building, then the landmark that saves the phone call,
 * then whatever of the area the map knew that has not already been said.
 *
 * The dedupe is the reason this is not a join(). Reverse geocoding routinely
 * returns the building name the user has just typed — often in different case,
 * or as part of a longer segment — and an address that says "Casa Rouge" twice
 * reads like a bug. Segments are compared loosely enough to catch that, and one
 * that merely *contains* an earlier one is dropped too.
 */
export function formatAddress(details: AddressDetails, area?: string): string {
  const lead = [clean(details.line1), clean(details.line2), clean(details.landmark)].filter(Boolean);

  const out: string[] = [];
  const seen: string[] = [];

  const add = (part: string) => {
    const k = key(part);
    if (!k) return;
    // A bare map coordinate ("12.9716") is where the pin was before the place
    // name arrived. It is not an address line.
    if (/^-?\d{1,3}\.\d{2,}$/.test(part.trim())) return;
    // Already said, or said as part of something longer we already have.
    if (seen.some((s) => s === k || s.includes(k) || k.includes(s))) return;
    seen.push(k);
    out.push(part);
  };

  lead.forEach(add);
  // The area arrives as one string; split it so a single repeated segment can
  // be dropped without losing the rest of the city and postcode.
  clean(area)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .forEach(add);

  return out.join(', ');
}

/** How a saved address is labelled in a list. */
export function addressTagLabel(details?: AddressDetails): string | null {
  if (!details?.tag) return null;
  if (details.tag === 'other') return clean(details.tagName) || 'Other';
  return details.tag === 'home' ? 'Home' : 'Work';
}

// --------------------------------------------------------------------- age ---

/**
 * The youngest anyone may be to hold an account. The server enforces the same
 * number in public.record_birth_date (supabase/migrations/…_082_age_gate.sql);
 * change both together. Never show this number on the sign-up screen: a
 * neutral question ("When were you born?") is what keeps the answer honest.
 *
 * 18, not COPPA's 13: TaskDrop takes payments, pays people out and sends them
 * to in-person jobs, minors cannot make binding contracts in India, and the
 * DPDP Act needs verifiable parental consent for anyone under 18.
 */
export const MIN_SIGNUP_AGE = 18;

/**
 * A calendar date of birth from day / month / year as typed, or null when it is
 * not a real date (31 February), is in the future, or is implausibly old.
 * Returned at midnight UTC so it means the same day everywhere.
 */
export function parseBirthDate(day: string, month: string, year: string, today: Date = new Date()): Date | null {
  const d = Number(day);
  const m = Number(month);
  const y = Number(year);
  if (!Number.isInteger(d) || !Number.isInteger(m) || !Number.isInteger(y)) return null;
  if (year.trim().length !== 4 || y < 1900) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return date.getTime() > todayUtc ? null : date;
}

/** Whole years old on `today`, birthdays counted on the day itself. */
export function ageOn(birth: Date, today: Date = new Date()): number {
  const y = today.getFullYear();
  const m = today.getMonth();
  const d = today.getDate();
  let age = y - birth.getUTCFullYear();
  if (m < birth.getUTCMonth() || (m === birth.getUTCMonth() && d < birth.getUTCDate())) age -= 1;
  return age;
}

/** "2011-04-09": how a birth date travels to the server. */
export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
