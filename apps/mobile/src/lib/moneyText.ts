import type { MoneyLedgerRow, PayeeStatus, TaskHoldStatus } from '../data/api';

/**
 * Plain words for Plan B money (pay per task). No React Native imports, so this can be tested from Node.
 */

/** The line for one row of the money record. */
export function ledgerLabel(row: Pick<MoneyLedgerRow, 'kind' | 'task_title'>): string {
  const task = row.task_title?.trim() || 'your task';
  switch (row.kind) {
    case 'paid':
      return `Paid for ${task}`;
    case 'on_hold':
      return 'Held for you';
    case 'released':
      return 'Sent to your bank or UPI';
    case 'fine_paid':
      return 'For your time (cancelled after start)';
    case 'refunded':
      return 'Refunded to your card or UPI';
    case 'hold_cancelled':
      return 'Hold ended';
    default:
      return 'Money update';
  }
}

/** Whether a row adds to what the person has received (earning side) rather than what they paid. */
export function ledgerIncoming(kind: MoneyLedgerRow['kind']): boolean {
  return kind === 'released' || kind === 'fine_paid' || kind === 'refunded';
}

/** One status line for a task's hold, or null when nothing needs saying. */
export function holdLine(status: TaskHoldStatus, stuck: boolean, mine: 'poster' | 'worker'): string {
  if (stuck) return 'Taking longer than usual. Our team is on it.';
  switch (status) {
    case 'awaiting_payment':
      return 'Waiting for payment';
    case 'held':
      return 'Paid and held by Razorpay';
    case 'release_asked':
      return mine === 'worker' ? 'Being sent to your bank or UPI' : 'Releasing to the worker';
    case 'released':
      return mine === 'worker' ? 'Sent to your bank or UPI' : "Sent to the worker's bank or UPI";
    case 'refund_asked':
    case 'split_asked':
      return 'Refund on its way';
    case 'split':
      return 'Refunded, with a fee kept for the worker';
    case 'refunded':
      return 'Refunded';
    case 'expired':
      return 'Hire expired: not paid in time';
    default:
      return '';
  }
}

/** The worker's "Get paid" card, by payee state. Null when they are set up (nothing to show). */
export function payeeCard(
  payee: { status: PayeeStatus; note: string | null } | null,
): { title: string; body: string; action: string | null } | null {
  if (!payee) {
    return {
      title: 'Get paid',
      body: 'Add your bank or UPI once. Posters can hire you after that.',
      action: 'Set up',
    };
  }
  switch (payee.status) {
    case 'active':
      return null;
    case 'pending':
      return { title: 'Being checked by Razorpay', body: 'This can take a little while. You can be hired once it is done.', action: null };
    case 'rejected':
      return {
        title: 'Razorpay could not accept your details',
        body: payee.note?.trim() || 'Check the details and try again.',
        action: 'Try again',
      };
    default:
      return {
        title: 'Payouts are paused for your account',
        body: payee.note?.trim() || 'Our team is looking at it.',
        action: null,
      };
  }
}

/** A refusal when hiring, in words for the poster. Other messages pass through unchanged. */
export function hireRefusal(message: string): string {
  return /not set up payments/i.test(message) ? 'Can be hired once they add their bank or UPI.' : message;
}
