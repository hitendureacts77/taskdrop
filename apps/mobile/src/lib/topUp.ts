import { TOP_UP_PCTS } from '@taskdrop/rules';

/**
 * "Top up" on an open post (D31, migration 194). The server decides and prices the real change
 * (public.raise_task_topup); these helpers only say which steps to offer and what the new offer will
 * read, with the same sums: base = total / (1 + old%), new = base × (1 + new%), rounded to the rupee.
 */

/** The bigger top-up steps a post can still move to (none once it is at the top step). */
export function nextTopUpSteps(current: number | null | undefined): number[] {
  const now = current ?? 0;
  return TOP_UP_PCTS.filter((p) => p > now);
}

/** The new offer, in paise, after raising a post from `oldPct` to `newPct`. Never lower than today's. */
export function raisedPriceMinor(benchmarkMinor: number, oldPct: number | null | undefined, newPct: number): number {
  const base = benchmarkMinor / (1 + (oldPct ?? 0) / 100);
  const raised = Math.round((base * (1 + newPct / 100)) / 100) * 100;
  return Math.max(raised, benchmarkMinor);
}

/** A post can be topped up while it is an open request (not a service listing) below the top step. */
export function canTopUp(task: { status: string; kind?: string | null; topup_pct?: number | null }): boolean {
  return task.status === 'OPEN' && (task.kind ?? 'request') === 'request' && nextTopUpSteps(task.topup_pct).length > 0;
}
