/**
 * Small wording rules for task screens, kept pure so they can be tested in Node
 * (taskStatusText.test.ts). They only decide the words and dates, never the look.
 */

/**
 * The date a task should be done by: the poster's target date, or null when they set none. Never created +
 * time limit (B153 / W2-6: that showed a date days in the past on Compare while the task page showed none).
 */
export function completeByDate(task: { due_at?: string | null; created_at: string; time_limit_minutes: number }): Date | null {
  return task.due_at ? new Date(task.due_at) : null;
}

/** A count for a summary tile: a dash while the list is still loading (W2-18), never a 0 that is not true yet. */
export function countOrDash(n: number, loading: boolean): string {
  return loading ? '–' : String(n);
}

/** The "Your payment" line on the poster's task page. `amount` is already formatted. */
export function paymentLine(
  task: { status: string; funded_at?: string | null },
  hasAssignment: boolean,
  amount: string,
): string {
  if (task.status === 'COMPLETED' || task.status === 'AUTO_COMPLETED') return `${amount} paid`;
  if (task.status === 'CANCELLED' && task.funded_at) return `${amount} refunded`;
  if (task.funded_at) return `${amount} held`;
  return hasAssignment ? `${amount} due` : 'Paid when you accept an offer';
}

/** The second header chip (how the helper is chosen) only matters while the task is still open. */
export function showAssignmentChip(status: string): boolean {
  return status === 'OPEN';
}

/**
 * Top line of a card whose date has passed. "No one picked it" only fits an open task with no offers. Short, so
 * it fits a card in the two- and three-column layouts (B165: it was cut to "THE DATE HAS P...").
 */
export function datePassedLine(status: string, offers: number): string {
  // An open post switches to no fixed date when its date passes (plan 1.19 J).
  if (status === 'OPEN') return offers > 0 ? `NO FIXED DATE · ${offers} ${offers === 1 ? 'OFFER' : 'OFFERS'}` : 'NO FIXED DATE';
  return 'DATE PASSED';
}

/** Share of decided offers that were won. Offers still waiting are not counted as lost. */
export function successPercent(placed: number, won: number, pending: number): string {
  const decided = placed - pending;
  if (decided <= 0) return '–';
  return `${Math.round((Math.min(won, decided) / decided) * 100)}%`;
}
