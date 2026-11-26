/**
 * The "Give your task one more go?" sheet shown before the final delete confirm (task 1.19 row A).
 * Pure and tested in Node (keepTask.test.ts): which keep-it options apply to a task, and the words.
 * The caller works out the top-up preview with lib/topUp, so this file has no runtime imports.
 */

export type KeepTaskOptionId = 'topup' | 'share' | 'similar' | 'message';
export type KeepTaskOption = { id: KeepTaskOptionId; label: string; sub: string };

export function keepTaskBody(status: string): string {
  return status === 'OPEN'
    ? 'Workers may not have seen it yet. A small push often helps.'
    : 'Your worker is lined up. A quick message often sorts out a change of plan.';
}

export function keepTaskOptions(
  task: { status: string },
  hasWorker: boolean,
  money: (minor: number) => string,
  /** What workers would see after the next top-up step (lib/topUp), or null when the task cannot be topped up. */
  topUpToMinor: number | null,
): KeepTaskOption[] {
  const open = task.status === 'OPEN';
  const out: KeepTaskOption[] = [];
  if (open && topUpToMinor != null) {
    out.push({
      id: 'topup',
      label: 'Top up the offer',
      sub: `Workers see ${money(topUpToMinor)}. You pay only when you accept an offer.`,
    });
  }
  if (open) {
    out.push({ id: 'share', label: 'Share the task', sub: 'WhatsApp, Telegram or a link' });
    out.push({ id: 'similar', label: 'Post again with changes', sub: 'A new date, price or details' });
  }
  if (hasWorker) out.push({ id: 'message', label: 'Message the worker', sub: 'Sort out a change of plan together' });
  return out;
}
