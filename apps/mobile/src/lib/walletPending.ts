/**
 * Withdrawals that are asked for but not paid yet. The wallet list is filtered by period; a request
 * that has been waiting longer than the period used to vanish from Withdrawals ("Nothing of this
 * kind"). These are listed whatever the period. Pure, tested in Node (walletPending.test.ts).
 *
 * The wallet feed carries no status field; the server words a withdrawal that is neither paid, failed,
 * cancelled nor on its way as "Withdrawal requested" / "Withdrawal request via UPI"
 * (supabase/functions/api/reads.ts, listWalletActivity).
 */

type Row = { kind: string; title: string };

export const PENDING_WITHDRAWAL_NOTE = 'Waiting: payouts are paused for now';

export function isPendingWithdrawal(row: Row): boolean {
  return row.kind === 'payout' && /^Withdrawal request/i.test(row.title);
}

/** The Withdrawals tab: everything in the period, plus pending requests from before it. Newest first. */
export function withdrawalRows<T extends Row & { at: string }>(all: T[], inPeriod: T[]): T[] {
  const seen = new Set(inPeriod.filter((r) => r.kind === 'payout').map((r) => r));
  const rows = inPeriod.filter((r) => r.kind === 'payout');
  for (const r of all) if (isPendingWithdrawal(r) && !seen.has(r)) rows.push(r);
  return rows.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}
