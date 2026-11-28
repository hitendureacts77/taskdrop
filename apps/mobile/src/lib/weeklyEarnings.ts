/**
 * "Show my earnings by week" (Ideas board): the money sent to a helper, week by week, for the small chart on
 * the Earn side of the Wallet. Read-only: it only adds up the `released` rows the server already sends in
 * `my_money_ledger` (each row is the caller's own). Weeks run Monday to Sunday in local time, as on Streaks.
 * Plain functions, no React Native, so the node test runner can load them.
 */

export type LedgerLike = { kind: string; amount_minor: number; created_at: string };

export type WeekTotal = {
  /** Local midnight of the week's Monday, as epoch ms. */
  start: number;
  /** "24 Nov": the Monday the week starts on. */
  label: string;
  minor: number;
};

const DAY = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local midnight of the Monday on or before `ms`. */
export function weekStart(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  const back = (d.getDay() + 6) % 7; // Monday = 0
  d.setDate(d.getDate() - back);
  return d.getTime();
}

/**
 * The last `weeks` weeks, oldest first, ending with this week, each with what was released to the helper in it.
 * Only `released` rows count: a hold is not earned yet, and a refund or fine is not the helper's money.
 */
export function weeklyEarnings(rows: LedgerLike[], now: number = Date.now(), weeks = 8): WeekTotal[] {
  const n = Math.max(1, Math.min(52, Math.floor(weeks)));
  const thisWeek = weekStart(now);
  const out: WeekTotal[] = [];
  for (let i = n - 1; i >= 0; i--) {
    // Step back by days, then snap to Monday again, so a clock change inside the range cannot shift a week.
    const start = weekStart(thisWeek - i * 7 * DAY + DAY / 2);
    const d = new Date(start);
    out.push({ start, label: `${d.getDate()} ${MONTHS[d.getMonth()]}`, minor: 0 });
  }
  const first = out[0]!.start;
  for (const r of rows) {
    if (r.kind !== 'released') continue;
    const at = Date.parse(r.created_at);
    const amount = Number(r.amount_minor);
    if (!Number.isFinite(at) || !Number.isFinite(amount) || amount <= 0 || at < first || at > now) continue;
    const ws = weekStart(at);
    const w = out.find((x) => x.start === ws);
    if (w) w.minor += amount;
  }
  return out;
}

/**
 * When the ledger read came back full (it is capped), the oldest weeks may be missing rows. Keep only the weeks
 * after the one holding the oldest row, so no bar ever shows less than was really earned. Always keeps this week.
 */
export function trimToCovered(weeks: WeekTotal[], rows: LedgerLike[], full: boolean): WeekTotal[] {
  if (!full || rows.length === 0) return weeks;
  const oldest = Math.min(...rows.map((r) => Date.parse(r.created_at)).filter(Number.isFinite));
  if (!Number.isFinite(oldest)) return weeks;
  const from = weekStart(oldest);
  const kept = weeks.filter((w) => w.start > from);
  return kept.length ? kept : weeks.slice(-1);
}

/** True when there is anything to draw: an empty chart is noise. */
export function hasEarnings(weeks: WeekTotal[]): boolean {
  return weeks.some((w) => w.minor > 0);
}
