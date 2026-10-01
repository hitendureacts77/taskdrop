import { formatINR } from '../components/ui';
import type { Theme } from '../theme';
import type { Task, Bid, Assignment } from '../data/api';
import type { NavParams, ScreenName } from '../providers/NavProvider';
import type { TaskCtx } from '../providers/AppStateProvider';

/**
 * What a task looks like in someone's own lists, and where tapping it goes.
 *
 * Lifted out of OrdersScreen so the My Tasks / My Work screens label and route
 * a task exactly the way the orders list always has. Status decides the label,
 * tone, tab and action; the server re-checks every action anyway.
 */

/** Tone keys shared with `useApp().myBids` so both sources render identically. */
export type Tone = 'accent' | 'gold' | 'signal' | 'blue' | 'violet' | 'neutral';
export type Act = 'compare' | 'quotes' | 'confirm' | 'review' | 'active' | 'start' | 'pay' | null;

export type ViewRow = {
  taskId?: string;
  bucket?: number;
  state: string;
  tone: Tone;
  title: string;
  priceLabel: string;
  priceMinor: number;
  meta: string;
  act: Act;
  escrowLabel?: string;
  escrowMinor?: number;
  /** Whether withdrawing is still possible — the server checks this too. */
  cancellable?: boolean;
  who?: string;
  payMeta?: string;
};

export function toneDot(tone: Tone, colors: Theme['colors']): string {
  switch (tone) {
    case 'gold':
      return colors.gold;
    case 'signal':
      return colors.signal;
    case 'blue':
      return colors.blue;
    case 'violet':
      return colors.purple;
    case 'accent':
      return colors.accent;
    default:
      return colors.muted;
  }
}

export function toneInk(tone: Tone, colors: Theme['colors']): string {
  switch (tone) {
    case 'gold':
      return colors.gold;
    case 'signal':
      return colors.signalDeep;
    case 'blue':
      return colors.blue;
    case 'violet':
      return colors.purple;
    case 'accent':
      return colors.accentDeep;
    default:
      return colors.muted;
  }
}

/** Bucket-index rule from the design: an explicit bucket wins, otherwise the
 * status text is classified per-mode. Mirrors `_design_source.jsx` lines 162-174. */
export function bucketOf(row: { bucket?: number; state: string }, worker: boolean): number {
  if (typeof row.bucket === 'number') return row.bucket;
  const s = row.state;
  if (worker) {
    if (/LISTING|QUOTES ON MY SERVICE/.test(s)) return 0;
    if (/ACCEPTED|ACTIVE|WORK DONE/.test(s)) return 1;
    if (/PENDING/.test(s)) return 2;
    return 3;
  }
  if (/OPEN|PENDING/.test(s)) return 0;
  if (/ACTIVE/.test(s)) return 1;
  return 2;
}

/** A task the signed-in user posted. Status decides label, tone, tab and tap. */
export function posterRow(task: Task, quoteCount = 0): ViewRow {
  const priceMinor = task.locked_minor ?? task.benchmark_minor;
  const base = {
    taskId: task.id,
    title: task.title,
    priceLabel: formatINR(priceMinor),
    priceMinor,
    // Once work is submitted it is a dispute, not a cancellation.
    cancellable: ['OPEN', 'LOCKED', 'TASK_STARTED', 'OVERDUE'].includes(task.status),
  };
  switch (task.status) {
    case 'OPEN':
      return {
        ...base,
        bucket: 0,
        state: quoteCount > 0 ? 'OPEN · ' + quoteCount + (quoteCount === 1 ? ' OFFER' : ' OFFERS') : 'OPEN',
        tone: 'blue',
        meta: quoteCount > 0 ? 'Tap to compare and choose one' : 'Waiting for offers',
        act: 'compare',
      };
    case 'LOCKED':
      // "Escrow funded" used to be printed here unconditionally, which was a
      // claim the data did not support: a locked task with funded_at null has
      // had nothing collected, and the worker cannot start until it does.
      return task.funded_at
        ? { ...base, bucket: 0, state: 'PAID · WORKER STARTS NEXT', tone: 'accent', meta: 'Paid · worker starts next', act: null }
        : { ...base, bucket: 0, state: 'WAITING FOR YOUR PAYMENT', tone: 'signal', meta: 'Pay so the worker can start', act: 'pay' };
    case 'TASK_STARTED':
      return { ...base, bucket: 1, state: 'ACTIVE · TIMER RUNNING', tone: 'gold', meta: 'Work is underway', act: 'active' };
    case 'OVERDUE':
      return { ...base, bucket: 1, state: 'OVERDUE', tone: 'signal', meta: 'Past the agreed time', act: 'active' };
    case 'WORK_DONE':
    case 'REVISION_REQUESTED':
      return { ...base, bucket: 1, state: 'MARKED DONE · REVIEW THE PROOF', tone: 'gold', meta: 'Tap to see the proof and release', act: 'active' };
    case 'COMPLETED':
    case 'AUTO_COMPLETED':
      return { ...base, bucket: 2, state: 'DONE · PAID', tone: 'accent', meta: 'Tap to review the worker', act: 'review' };
    default:
      return { ...base, bucket: 2, state: String(task.status), tone: 'neutral', meta: '', act: null };
  }
}

/** A quote this worker sent that hasn't been locked yet. */
export function workerBidRow(bid: Bid & { tasks: Task | null }): ViewRow {
  return {
    taskId: bid.task_id,
    bucket: 2,
    state: 'PENDING',
    tone: 'blue',
    title: bid.tasks?.title ?? 'Task',
    priceLabel: formatINR(bid.price_minor),
    priceMinor: bid.price_minor,
    meta: 'Offer sent · waiting for the customer',
    act: null,
  };
}

/** A task this worker was picked for. */
export function workerAssignmentRow(a: Assignment & { tasks: Task | null }): ViewRow {
  const task = a.tasks;
  const priceMinor = task?.locked_minor ?? a.escrow_minor;
  const base = {
    taskId: a.task_id,
    title: task?.title ?? 'Task',
    priceLabel: formatINR(priceMinor),
    priceMinor,
    escrowMinor: a.escrow_minor,
    cancellable:
      (a.status === 'assigned' || a.status === 'started') &&
      (task?.status === 'LOCKED' || task?.status === 'TASK_STARTED' || task?.status === 'OVERDUE'),
  };
  if (a.status === 'refunded')
    return { ...base, bucket: 3, state: 'NOT SELECTED', tone: 'neutral', meta: 'Another worker started first', act: null };
  if (a.status === 'released' || task?.status === 'COMPLETED' || task?.status === 'AUTO_COMPLETED')
    return { ...base, bucket: 3, state: 'DONE · PAID', tone: 'accent', meta: 'Earnings on the way', act: 'active' };
  if (task?.status === 'WORK_DONE' || task?.status === 'REVISION_REQUESTED')
    return { ...base, bucket: 1, state: 'WORK DONE · WAITING FOR CUSTOMER', tone: 'gold', meta: 'Customer confirms next', act: 'active' };
  if (task?.status === 'TASK_STARTED' || task?.status === 'OVERDUE' || a.status === 'started')
    return { ...base, bucket: 1, state: 'ACTIVE · TIMER RUNNING', tone: 'gold', meta: 'Task started · timer running', act: 'active' };
  // Sliding to start now fails server-side on an unfunded task, so say so here
  // rather than letting someone swipe into a refusal.
  if (!task?.funded_at)
    return { ...base, bucket: 1, state: 'WAITING ON PAYMENT', tone: 'gold', meta: 'The customer has not paid yet', act: null };
  return { ...base, bucket: 1, state: 'ACCEPTED · SWIPE TO START', tone: 'accent', meta: 'Paid · first to start gets the job', act: 'start' };
}

/** Statuses where the live tracker, not the overview, is what the poster needs. */
const TRACKED = ['TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED'];

/**
 * Open one of my posted tasks from a list. Work underway, or waiting on my
 * review, goes straight to the tracker -- that is the screen with the thing to
 * do on it. Everything else opens the task's overview.
 */
export function openPostedTask(
  task: Pick<Task, 'id' | 'status' | 'title' | 'locked_minor' | 'benchmark_minor'>,
  go: (s: ScreenName, p?: NavParams) => void,
): void {
  if (TRACKED.includes(task.status)) {
    return go('active', { taskId: task.id, title: task.title, priceMinor: task.locked_minor ?? task.benchmark_minor });
  }
  go('taskManage', { taskId: task.id });
}

/** Open a row: the same switch OrdersScreen always used. */
export function openRow(
  row: ViewRow,
  ctx: {
    go: (s: ScreenName, p?: NavParams) => void;
    flash: (m: string) => void;
    setOpenTask: (t: TaskCtx | null) => void;
    startedOf: (title: string) => boolean;
  },
): void {
  const { go, flash, setOpenTask, startedOf } = ctx;
  const task: TaskCtx = { title: row.title, price: row.priceLabel };
  const p = {
    title: row.title,
    priceMinor: row.priceMinor,
    taskId: row.taskId,
    escrowMinor: row.escrowMinor,
    payMeta: row.payMeta ?? row.priceLabel,
  };
  setOpenTask(task);
  switch (row.act) {
    case 'pay':
      return go('escrow', { ...p, priceMinor: row.priceMinor, escrowMinor: row.escrowMinor });
    case 'compare':
      return go('compare', p);
    case 'quotes':
      return go('myQuotes', p);
    case 'confirm':
      return go('confirm', p);
    case 'review':
      return go('review', p);
    case 'active':
      return go('active', p);
    case 'start':
      return startedOf(row.title) ? go('active', p) : go('swipe', p);
    default:
      return flash(`${row.title} · ${row.priceLabel}`);
  }
}
