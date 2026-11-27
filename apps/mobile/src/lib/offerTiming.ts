/**
 * When a worker says they can finish, on an offer or counteroffer (plan 1.19 J, owner note 26 Nov).
 *
 * - A task with no fixed date: "By a date" (stored in bids.proposed_due_at) or "In hours"
 *   (bids.time_limit_minutes, counted from when the work starts, plus an "Estimated time" line).
 * - A task with a date: "That works" (nothing changes) or "Ask for more time": a later date in
 *   bids.proposed_due_at and an optional reason line in the message.
 *
 * Accepting an offer with a date moves the task's date to it (migration 216, private.bid_due_on_accept).
 * Prices and fees never change here.
 */

export type TimingMode = 'date' | 'hours' | 'keep' | 'more';

export type OfferTiming = {
  mode: TimingMode;
  /** The finish date for 'date' and 'more'. */
  finishBy: Date | null;
  /** Whole hours for 'hours'. */
  hours: number;
  /** Why more time is needed, for 'more' (optional). */
  reason: string;
};

/** The steps of the "In hours" stepper: 1 hour up to 7 days. */
export const HOUR_STEPS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 24, 48, 72, 96, 120, 144, 168] as const;

export const REASON_MAX = 200;

export const HOURS_LINE = /^Estimated time: ([\d.]+) hours?$/m;
export const REASON_LINE = /^Why more time: (.+)$/m;

export function initialTiming(noDate: boolean): OfferTiming {
  return { mode: noDate ? 'date' : 'keep', finishBy: null, hours: 3, reason: '' };
}

/** "3 hours", "1 hour", "2 days", "1 day". */
export function hoursText(h: number): string {
  if (h >= 24 && h % 24 === 0) {
    const d = h / 24;
    return `${d} day${d === 1 ? '' : 's'}`;
  }
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** The next step up (dir 1) or down (dir -1) of the stepper, staying inside 1 hour to 7 days. */
export function stepHours(h: number, dir: 1 | -1): number {
  const i = HOUR_STEPS.findIndex((s) => s >= h);
  const at = i < 0 ? HOUR_STEPS.length - 1 : i;
  // A value between two steps (an older offer) moves to the step it sits under or over.
  const exact = HOUR_STEPS[at] === h;
  const next = dir === 1 ? (exact ? at + 1 : at) : at - 1;
  return HOUR_STEPS[Math.max(0, Math.min(HOUR_STEPS.length - 1, next))];
}

/** Whole hours back inside the stepper's range. */
export function clampHours(h: number): number {
  if (!Number.isFinite(h) || h <= 0) return 3;
  return Math.max(HOUR_STEPS[0], Math.min(HOUR_STEPS[HOUR_STEPS.length - 1], Math.round(h)));
}

/**
 * What the chosen timing sends with the offer, or a plain-words problem.
 * `taskDueAt` is the customer's date (null on a no-date task).
 */
export function timingFields(
  timing: OfferTiming,
  taskDueAt: string | null,
  now: number,
): { proposedDueAt: string | null; timeLimitMinutes: number | null; lines: string[] } | { error: string } {
  if (timing.mode === 'date') {
    if (timing.finishBy && timing.finishBy.getTime() < now - 5 * 60_000) return { error: 'Pick a finish time from now on' };
    return { proposedDueAt: timing.finishBy ? timing.finishBy.toISOString() : null, timeLimitMinutes: null, lines: [] };
  }
  if (timing.mode === 'hours') {
    const h = clampHours(timing.hours);
    return { proposedDueAt: null, timeLimitMinutes: h * 60, lines: [`Estimated time: ${h} hour${h === 1 ? '' : 's'}`] };
  }
  if (timing.mode === 'more') {
    if (!timing.finishBy) return { error: 'Pick the date you can finish by' };
    const due = taskDueAt ? Date.parse(taskDueAt) : NaN;
    if (Number.isFinite(due) && timing.finishBy.getTime() <= due) return { error: 'Pick a date after the customer’s date' };
    if (timing.finishBy.getTime() < now - 5 * 60_000) return { error: 'Pick a finish time from now on' };
    const reason = timing.reason.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
    return { proposedDueAt: timing.finishBy.toISOString(), timeLimitMinutes: null, lines: reason ? [`Why more time: ${reason}`] : [] };
  }
  return { proposedDueAt: null, timeLimitMinutes: null, lines: [] };
}

/** The timing an earlier offer carries, to open it for editing. */
export function timingFromOffer(
  offer: { proposed_due_at?: string | null; message?: string | null; time_limit_minutes?: number | null },
  noDate: boolean,
): OfferTiming {
  const base = initialTiming(noDate);
  const text = offer.message ?? '';
  const reason = REASON_LINE.exec(text)?.[1] ?? '';
  const hours = Number(HOURS_LINE.exec(text)?.[1]);
  if (offer.proposed_due_at) {
    return { ...base, mode: noDate ? 'date' : 'more', finishBy: new Date(offer.proposed_due_at), reason };
  }
  if (noDate && Number.isFinite(hours) && hours > 0) return { ...base, mode: 'hours', hours: clampHours(hours) };
  return base;
}

/** The message with the timing lines taken out (they show on their own). */
export function messageWithoutTiming(message: string | null | undefined): string {
  return (message ?? '').replace(HOURS_LINE, '').replace(REASON_LINE, '').replace(/\n{2,}/g, '\n').trim();
}

export type OfferTimingLine =
  | { kind: 'by'; text: string }
  | { kind: 'hours'; text: string }
  | { kind: 'more'; text: string; yours: string; reason: string | null }
  | null;

/**
 * What the customer reads about an offer's timing: "Can finish by …", "Can finish in 3 hours",
 * or "Asks for more time: …" with their own date and the reason.
 */
export function offerTimingLine(
  offer: { proposed_due_at?: string | null; message?: string | null },
  taskDueAt: string | null | undefined,
  fmt: (d: Date) => string,
): OfferTimingLine {
  const text = offer.message ?? '';
  if (offer.proposed_due_at) {
    const at = Date.parse(offer.proposed_due_at);
    const due = taskDueAt ? Date.parse(taskDueAt) : NaN;
    if (Number.isFinite(due) && at > due) {
      return {
        kind: 'more',
        text: `Asks for more time: ${fmt(new Date(at))}`,
        yours: `Your date: ${fmt(new Date(due))}`,
        reason: REASON_LINE.exec(text)?.[1]?.trim() || null,
      };
    }
    return { kind: 'by', text: `Can finish by ${fmt(new Date(at))}` };
  }
  const hours = Number(HOURS_LINE.exec(text)?.[1]);
  if (!taskDueAt && Number.isFinite(hours) && hours > 0) return { kind: 'hours', text: `Can finish in ${hoursText(hours)}` };
  return null;
}
