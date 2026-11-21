/**
 * What "Close task" says before the poster confirms (W2-3). Once the worker has started (TASK_STARTED or
 * OVERDUE, the same statuses cancel_task fines on the server), closing costs the poster a fine that goes to
 * the worker, so "everything comes back" would be wrong. Pure, tested in Node (closeTaskText.test.ts).
 */

const STARTED = ['TASK_STARTED', 'OVERDUE'];

export type CloseTaskInput = {
  title: string;
  status: string;
  funded: boolean;
  /** The fine in paise (postStartCancelFine of the locked price); used only once work has started. */
  fineMinor: number;
  /** The fine as a whole percent, for the words ("5%"). */
  finePct: number;
  /** "₹47.50": how money is written on screen. */
  money: (minor: number) => string;
};

/**
 * One honest sentence for the hire dialog and the pay screen (W3-6): what cancelling costs, in rupees, before
 * it can happen. The fine applies only once the worker has started (the server fines on TASK_STARTED and
 * OVERDUE); before that everything comes back. `fineMinor` is the fine on the offer price, in paise.
 */
export function hireFineNote(x: { fineMinor: number; finePct: number; money: (minor: number) => string }): string {
  if (x.fineMinor <= 0) return 'If the task is cancelled before the worker starts, all of it comes back.';
  return `If the task is cancelled before the worker starts, all of it comes back. Once they have started, cancelling costs a ${x.finePct}% fine (${x.money(x.fineMinor)} on this offer) that goes to the worker; the rest still comes back.`;
}

export function closeTaskText(x: CloseTaskInput): { sub: string; message: string } {
  if (!x.funded) {
    return {
      sub: 'Take it down; no more offers',
      message: `“${x.title}” will be taken down and workers can no longer send offers for it. This can’t be undone.`,
    };
  }
  if (STARTED.includes(x.status) && x.fineMinor > 0) {
    const fine = x.money(x.fineMinor);
    return {
      sub: `The worker has started: a ${x.finePct}% fine (${fine}) goes to them`,
      message: `“${x.title}” will be cancelled and the worker taken off it. The worker has already started, so ${fine} (${x.finePct}% of the price) goes to them as a cancellation fine; the rest of what you paid, service fee included, goes back to your wallet. This can’t be undone.`,
    };
  }
  return {
    sub: 'Everything you paid comes back, fee included',
    message: `“${x.title}” will be cancelled and the worker taken off it. Everything you paid, service fee included, goes back to your wallet. This can’t be undone.`,
  };
}
