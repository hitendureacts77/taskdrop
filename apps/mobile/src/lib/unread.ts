/**
 * The bell's number and the Messages dot, counted from the same rows the Notifications screen lists (W3-12).
 * The bell used to ask the server for its own count over every unread alert, while the screen listed only the
 * newest 80, so the bell said 31 and the list 15. Now both read the same window and use the same side rule.
 *
 * Pure, so it runs in Node tests.
 */

/** How many of the newest alerts the screen lists and the bell counts (the server's most per read). */
export const UNREAD_WINDOW = 200;

export type Side = 'poster' | 'worker';
export type AlertSide = Side | 'both';

type Row = { id: string; kind: string; read_at: string | null };

/** Whether an alert shows on this side: its own side's, and those that belong to both (no side known = both). */
export function onSide(id: string, sides: ReadonlyMap<string, AlertSide>, side: Side): boolean {
  const s = sides.get(id) ?? 'both';
  return s === 'both' || s === side;
}

/** Unread alerts on this side, and how many of them are messages (the Messages icon's dot). */
export function unreadSummary(rows: readonly Row[], sides: ReadonlyMap<string, AlertSide>, side: Side): { total: number; messages: number } {
  let total = 0;
  let messages = 0;
  for (const r of rows) {
    if (r.read_at || !onSide(r.id, sides, side)) continue;
    total += 1;
    if (r.kind === 'message') messages += 1;
  }
  return { total, messages };
}
