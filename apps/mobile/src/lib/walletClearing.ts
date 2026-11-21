/**
 * The plain line under the wallet balance about money that has been earned but is still clearing (W3-3).
 *
 * After a release the worker's share shows in "Earned ... added to your wallet" at once, yet it joins
 * Available only after the clearing period (7 days by default, set by the admin, packages/rules
 * TIMING.CLEARING_PERIOD_DAYS). Pure, tested in Node (walletClearing.test.ts).
 */

type Row = { kind: string; title: string; at: string };

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "23 Nov" */
export function shortDate(d: Date): string {
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/**
 * The earliest day a still-clearing "Earned" row joins Available, or null when no such row is known
 * (the feed holds only the latest rows). `days` is the clearing period.
 */
export function nextClearDate(rows: Row[], days: number, now: Date): Date | null {
  let best: Date | null = null;
  for (const r of rows) {
    if (r.kind !== 'clearing' || r.title !== 'Earned') continue;
    const at = new Date(r.at);
    if (Number.isNaN(at.getTime())) continue;
    const clear = new Date(at);
    clear.setDate(clear.getDate() + days);
    if (clear.getTime() <= now.getTime()) continue;
    if (!best || clear.getTime() < best.getTime()) best = clear;
  }
  return best;
}

/** The line to show, or null when nothing is clearing. */
export function clearingLine(x: {
  clearingMinor: number;
  rows: Row[];
  days: number;
  now: Date;
  money: (minor: number) => string;
}): string | null {
  if (!(x.clearingMinor > 0)) return null;
  const when = nextClearDate(x.rows, x.days, x.now);
  const days = `${x.days} day${x.days === 1 ? '' : 's'}`;
  const base = `${x.money(x.clearingMinor)} you earned is still clearing`;
  return when
    ? `${base}. It joins Available from ${shortDate(when)}; earnings clear ${days} after the work is approved.`
    : `${base}. Earnings join Available ${days} after the customer approves the work.`;
}
