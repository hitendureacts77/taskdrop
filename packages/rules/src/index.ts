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

/** Fees & penalties, expressed as fractions (0.20 === 20%). */
export const FEES = {
  /** Flat commission taken from the worker on every completed order. */
  WORKER_COMMISSION_PCT: 0.2,
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

/** What the worker nets on a completed order: locked amount − 20% commission. */
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
