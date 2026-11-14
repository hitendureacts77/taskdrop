/**
 * Small wording rules for task screens, kept pure so they can be tested in Node
 * (taskStatusText.test.ts). They only decide the words and dates, never the look.
 */

/** The date a task should be done by: the poster's target date, else created + time limit. */
export function completeByDate(task: { due_at?: string | null; created_at: string; time_limit_minutes: number }): Date {
  if (task.due_at) return new Date(task.due_at);
  return new Date(new Date(task.created_at).getTime() + task.time_limit_minutes * 60_000);
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

/** Top line of a card whose date has passed. "No one picked it" only fits an open task with no offers. */
export function datePassedLine(status: string, offers: number): string {
  if (status === 'OPEN' && offers === 0) return 'THE DATE HAS PASSED · NO ONE PICKED IT';
  return 'THE DATE HAS PASSED';
}

/** Share of decided offers that were won. Offers still waiting are not counted as lost. */
export function successPercent(placed: number, won: number, pending: number): string {
  const decided = placed - pending;
  if (decided <= 0) return '–';
  return `${Math.round((Math.min(won, decided) / decided) * 100)}%`;
}
