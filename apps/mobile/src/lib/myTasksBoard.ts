/**
 * My tasks / My work the Upwork way (D31 v11, boards MyTasks, MyWork and WebMyTasks): the words for the
 * "Needs you now" card, the 5-step tracks and the "Next step" box, built only from states the lists already
 * load. Pure, tested in Node (myTasksBoard.test.ts); the look lives in components/myTasks.
 *
 * Nothing here decides money: amounts arrive already worked out (packages/rules previews) and formatted.
 */

/** The fields of a posted task these words read. */
export type BoardTask = {
  id: string;
  status: string;
  title: string;
  due_at?: string | null;
  funded_at?: string | null;
  auto_complete_at?: string | null;
  started_at?: string | null;
  completed_at?: string | null;
  wallet_refunded_at?: string | null;
};

export type Tone = 'accent' | 'gold' | 'signal' | 'blue' | 'neutral';

/** Status pill of a posted task (shared with Home's sections and the task page). */
export function statusBadge(task: Pick<BoardTask, 'status' | 'funded_at'>): { label: string; tone: Tone } {
  switch (task.status) {
    case 'OPEN':
      return { label: 'Open', tone: 'accent' };
    case 'LOCKED':
      return task.funded_at ? { label: 'Worker to start', tone: 'accent' } : { label: 'Waiting for payment', tone: 'signal' };
    case 'TASK_STARTED':
      return { label: 'In progress', tone: 'gold' };
    case 'OVERDUE':
      return { label: 'Overdue', tone: 'signal' };
    case 'WORK_DONE':
      return { label: 'Review work', tone: 'gold' };
    case 'REVISION_REQUESTED':
      return { label: 'Revision asked', tone: 'gold' };
    case 'COMPLETED':
    case 'AUTO_COMPLETED':
      return { label: 'Completed', tone: 'blue' };
    case 'DISPUTED':
      return { label: 'Problem reported', tone: 'signal' };
    default:
      return { label: 'Cancelled', tone: 'neutral' };
  }
}

/** The poster's tabs: Open, In progress, Completed, Closed. */
export function posterTabOf(status: string): number {
  switch (status) {
    case 'OPEN':
      return 0;
    case 'LOCKED':
    case 'TASK_STARTED':
    case 'OVERDUE':
    case 'WORK_DONE':
    case 'REVISION_REQUESTED':
    case 'DISPUTED':
      return 1;
    case 'COMPLETED':
    case 'AUTO_COMPLETED':
      return 2;
    default:
      return 3;
  }
}

/** Someone was picked for it: the card shows who, the money and a next step. */
export function isHired(status: string): boolean {
  return posterTabOf(status) === 1 || posterTabOf(status) === 2;
}

export const POSTER_STAGES = ['Posted', 'Offers', 'Hired', 'Working', 'Done'] as const;

/** How far along the 5-step track a task is (1-5); 0 for closed tasks, which show no track. */
export function posterStage(status: string, offers: number): number {
  switch (status) {
    case 'OPEN':
      return offers > 0 ? 2 : 1;
    case 'LOCKED':
      return 3;
    case 'TASK_STARTED':
    case 'OVERDUE':
    case 'WORK_DONE':
    case 'REVISION_REQUESTED':
    case 'DISPUTED':
      return 4;
    case 'COMPLETED':
    case 'AUTO_COMPLETED':
      return 5;
    default:
      return 0;
  }
}

/** An open post whose date is behind us: said calmly, in gold. */
export function openDatePassed(task: Pick<BoardTask, 'status' | 'due_at'>, now: number): boolean {
  return task.status === 'OPEN' && !!task.due_at && new Date(task.due_at).getTime() < now;
}

/** Top line of an open post card: "GETTING OFFERS" once someone has offered, "WAITING FOR OFFERS" before. */
export function postLine(offers: number): string {
  return offers > 0 ? 'GETTING OFFERS' : 'WAITING FOR OFFERS';
}

// ------------------------------------------------------------------ dates ---

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "5:25 pm", "1 pm". */
export function clock(d: Date): string {
  const h = d.getHours() % 12 || 12;
  const m = d.getMinutes();
  return `${h}${m ? ':' + String(m).padStart(2, '0') : ''} ${d.getHours() < 12 ? 'am' : 'pm'}`;
}

/** "Tue 25 Nov, 5:25 pm": a deadline someone has to act by. */
export function deadline(iso: string): string {
  const d = new Date(iso);
  return `${DAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}, ${clock(d)}`;
}

/** "12 Nov". */
export function dayMonth(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "today 1 pm", "tomorrow 9:30 am", "22 Nov": when a job is due. */
export function dueShort(iso: string, now: number): string {
  const d = new Date(iso);
  const today = new Date(now);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(d, today)) return `today ${clock(d)}`;
  if (sameDay(d, tomorrow)) return `tomorrow ${clock(d)}`;
  return dayMonth(iso);
}

/** "in 2 days", "in 5 h", "in 20 min" or "passed": the DUE cell of a post. */
export function dueIn(iso: string | null | undefined, now: number): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return null;
  if (ms <= 0) return 'passed';
  const h = Math.floor(ms / 3_600_000);
  if (h < 1) return `in ${Math.max(1, Math.floor(ms / 60_000))} min`;
  if (h < 48) return `in ${h} h`;
  const d = Math.floor(h / 24);
  return `in ${d} days`;
}

/** "01:24:10" since a start time. */
export function elapsed(sinceIso: string, now: number): string {
  const s = Math.max(0, Math.floor((now - new Date(sinceIso).getTime()) / 1000));
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
}

/** "Ravi" from "Ravi Kumar"; "@ravi_k" stays as it is. */
export function firstName(name: string | null | undefined): string | null {
  const n = (name ?? '').trim();
  if (!n) return null;
  return n.startsWith('@') ? n : (n.split(/\s+/)[0] ?? n);
}

// -------------------------------------------------------- needs you now -----

export type NeedKind = 'review' | 'pay' | 'choose' | 'repost' | 'start' | 'finish' | 'offers';

/**
 * One row of "Needs you now": `lead` is the bold part ("Review Ravi's work"), `rest` the task's title, `hint`
 * the small line under it (a deadline in gold, a warning in coral), `action` the live button it stands for.
 */
export type Need = {
  key: string;
  kind: NeedKind;
  taskId?: string;
  lead: string;
  rest?: string;
  hint: string;
  tone: 'accent' | 'gold' | 'signal';
  action: string;
  /** The filled button (the one thing to do); the others are outlined. */
  primary: boolean;
};

/**
 * The poster's list, most pressing first: work to review (it releases by itself), payments that hold a hired
 * worker back, offers to choose from, and posts whose date passed with no offers. Only these live states.
 */
export function posterNeeds(
  tasks: BoardTask[],
  x: {
    offersOf: (id: string) => number;
    /** The hired person's name once the app has it, else null. */
    nameOf: (id: string) => string | null;
    /** "₹463.50": what paying would cost (offer + service fee). */
    payText: (task: BoardTask) => string;
    now: number;
  },
): Need[] {
  const review: Need[] = [];
  const pay: Need[] = [];
  const choose: Need[] = [];
  const repost: Need[] = [];
  for (const task of tasks) {
    const who = firstName(x.nameOf(task.id));
    if (task.status === 'WORK_DONE') {
      review.push({
        key: 'review-' + task.id,
        kind: 'review',
        taskId: task.id,
        lead: who ? `Review ${who}’s work` : 'Review the work',
        rest: task.title,
        hint: task.auto_complete_at ? `Auto-releases ${deadline(task.auto_complete_at)}` : 'Approve it, or ask for changes',
        tone: 'gold',
        action: 'Review the work',
        primary: true,
      });
    } else if (task.status === 'LOCKED' && !task.funded_at) {
      pay.push({
        key: 'pay-' + task.id,
        kind: 'pay',
        taskId: task.id,
        lead: `Pay ${x.payText(task)} so ${who ?? 'the worker'} can start`,
        rest: task.title,
        hint: 'Contacts are shared once work starts',
        tone: 'signal',
        action: 'Pay to start',
        primary: true,
      });
    } else if (task.status === 'OPEN') {
      const n = x.offersOf(task.id);
      const passed = openDatePassed(task, x.now);
      if (n > 0) {
        choose.push({
          key: 'choose-' + task.id,
          kind: 'choose',
          taskId: task.id,
          lead: `${n} ${n === 1 ? 'offer' : 'offers'} to choose from`,
          rest: task.title,
          hint: passed ? 'Date passed · choose an offer, or post it again' : 'Compare and pick one',
          tone: 'accent',
          action: 'Choose an offer',
          primary: true,
        });
      } else if (passed) {
        repost.push({
          key: 'repost-' + task.id,
          kind: 'repost',
          taskId: task.id,
          lead: 'No offers before the date',
          rest: task.title,
          hint: 'Post it again with a new date, or close it',
          tone: 'gold',
          action: 'Post again',
          primary: false,
        });
      }
    }
  }
  return [...review, ...pay, ...choose, ...repost];
}

/** The fields of a worker's row (lib/taskRows ViewRow) these words read. */
export type BoardRow = { taskId?: string; state: string; title: string; act: string | null; meta: string };

/**
 * The worker's list: jobs paid and ready to start (first to start gets it), jobs under way that need finishing
 * with proof, and the offers still waiting for an answer (one row; it opens the Offers tab).
 */
export function workerNeeds(rows: BoardRow[], x: { dueOf: (taskId?: string) => string | null | undefined; pendingOffers: number; now: number }): Need[] {
  const out: Need[] = [];
  for (const row of rows) {
    if (row.act === 'start') {
      out.push({ key: 'start-' + row.taskId, kind: 'start', taskId: row.taskId, lead: 'Swipe to start', rest: row.title, hint: row.meta, tone: 'accent', action: 'Swipe to start', primary: true });
    }
  }
  for (const row of rows) {
    if (row.state === 'ACTIVE · TIMER RUNNING') {
      const due = x.dueOf(row.taskId);
      out.push({
        key: 'finish-' + row.taskId,
        kind: 'finish',
        taskId: row.taskId,
        lead: 'Finish and send proof',
        rest: row.title,
        hint: due ? (new Date(due).getTime() < x.now ? 'Past the agreed time' : `Due ${dueShort(due, x.now)}`) : 'Timer running',
        tone: 'gold',
        action: 'Finish and send proof',
        primary: true,
      });
    }
  }
  if (x.pendingOffers > 0) {
    out.push({
      key: 'offers',
      kind: 'offers',
      lead: `${x.pendingOffers} ${x.pendingOffers === 1 ? 'offer' : 'offers'} waiting for an answer`,
      hint: 'Opens the Offers tab',
      tone: 'accent',
      action: 'See offers',
      primary: false,
    });
  }
  return out;
}

// ------------------------------------------------------------- next step -----

export type NextStep = { tone: 'accent' | 'gold' | 'signal'; text: string };

/** The tinted "Next step" box of a hired card: one sentence, with the deadline when there is one. */
export function posterNextStep(task: BoardTask, x: { name: string | null; payText: string; now: number }): NextStep | null {
  const who = firstName(x.name);
  switch (task.status) {
    case 'LOCKED':
      return task.funded_at
        ? { tone: 'accent', text: `Paid. ${who ?? 'The worker'} starts next.` }
        : { tone: 'signal', text: `Pay ${x.payText} so ${who ?? 'the worker'} can start. Contacts are shared once work starts.` };
    case 'TASK_STARTED':
      return { tone: 'accent', text: `${who ?? 'The worker'} is working${task.due_at ? ` · due ${dueShort(task.due_at, x.now)}` : ''}` };
    case 'OVERDUE':
      return { tone: 'gold', text: `Past the agreed time. ${who ?? 'The worker'} is still on it.` };
    case 'WORK_DONE':
      return {
        tone: 'gold',
        text: task.auto_complete_at
          ? `${who ?? 'The worker'} sent the work. Approve, or ask for changes, by ${deadline(task.auto_complete_at)}. After that it is released automatically.`
          : `${who ?? 'The worker'} sent the work. Approve it, or ask for changes.`,
      };
    case 'REVISION_REQUESTED':
      return { tone: 'accent', text: `You asked for changes. ${who ?? 'The worker'} is fixing it.` };
    case 'DISPUTED':
      return { tone: 'signal', text: 'Problem reported. Money stays held until TaskDrop decides.' };
    default:
      return null;
  }
}

/** The worker's track, left to right. */
export const WORKER_STAGES = ['Offer sent', 'Accepted', 'Paid', 'Working', 'Approved'] as const;

/** Steps reached on the worker's track (1-5); 0 for rows that show none (offers not picked). */
export function workerStage(state: string): number {
  if (state === 'PENDING') return 1;
  if (state === 'WAITING ON PAYMENT') return 2;
  if (state === 'ACCEPTED · SWIPE TO START') return 3;
  if (state === 'ACTIVE · TIMER RUNNING' || state === 'WORK DONE · WAITING FOR CUSTOMER') return 4;
  if (state === 'DONE · PAID') return 5;
  return 0;
}

/**
 * The worker's "Next step" box. `timer` means the box shows the running clock (the card ticks it) with the due
 * time after it.
 */
export function workerNextStep(
  row: BoardRow,
  task: { status?: string; due_at?: string | null; auto_complete_at?: string | null } | null,
  now: number,
): (NextStep & { timer?: boolean }) | null {
  switch (row.state) {
    case 'ACCEPTED · SWIPE TO START':
      return { tone: 'accent', text: 'Paid. The first helper to start gets the job.' };
    case 'WAITING ON PAYMENT':
      return { tone: 'signal', text: 'The customer has not paid yet. Don’t start until it says Paid.' };
    case 'ACTIVE · TIMER RUNNING':
      if (task?.status === 'OVERDUE') return { tone: 'signal', text: 'Past the agreed time. Finish and send proof.' };
      return { tone: 'gold', timer: true, text: task?.due_at ? ` · due ${dueShort(task.due_at, now)}` : '' };
    case 'WORK DONE · WAITING FOR CUSTOMER':
      if (task?.status === 'REVISION_REQUESTED') return { tone: 'gold', text: 'The customer asked for changes. Open the job to see them.' };
      return {
        tone: 'gold',
        text: task?.auto_complete_at
          ? `Sent. The customer has until ${deadline(task.auto_complete_at)} to approve, then it is released automatically.`
          : 'Sent. Waiting for the customer to approve.',
      };
    default:
      return null;
  }
}

/** The worker card's one button, standing for the row's live action; null when there is nothing to press. */
export function workerButton(state: string): { label: string; kind: 'swipe' | 'primary' | 'quiet' } | null {
  switch (state) {
    case 'ACCEPTED · SWIPE TO START':
      return { label: 'Swipe to start', kind: 'swipe' };
    case 'ACTIVE · TIMER RUNNING':
      return { label: 'Finish and send proof', kind: 'primary' };
    case 'WORK DONE · WAITING FOR CUSTOMER':
      return { label: 'Open job', kind: 'quiet' };
    case 'PENDING':
      return { label: 'Edit offer', kind: 'quiet' };
    default:
      return null;
  }
}

/** What a worker's row is called on screen ("PENDING" is an offer still out). */
export function workerStateLabel(state: string): string {
  return state === 'PENDING' ? 'OFFER SENT' : state;
}

/** The customer may be named to the worker only once the job has started (privacy rule). */
export function customerShown(task: { started_at?: string | null; status?: string } | null): boolean {
  if (!task) return false;
  if (task.started_at) return true;
  return ['TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED', 'COMPLETED', 'AUTO_COMPLETED'].includes(task.status ?? '');
}

// ---------------------------------------------------------------- closed -----

/**
 * The money line of a closed post. Nothing paid: nothing charged. Paid before the work started: all of it back.
 * Paid after: back less the cancel fine. Until the refund is recorded it is "being processed".
 */
export function closedLine(
  task: BoardTask & { funded_minor?: number | null },
  x: { money: (minor: number) => string; fineMinor: number; finePct: number },
): string {
  if (!task.funded_at) return `${x.money(0)} charged · closed before you paid`;
  if (!task.wallet_refunded_at) return 'Closed · your refund is being processed';
  const paid = task.funded_minor ?? 0;
  if (task.started_at && x.fineMinor > 0) return `${x.money(Math.max(0, paid - x.fineMinor))} refunded to you · less the ${x.finePct}% fine`;
  return `${x.money(paid)} refunded to you`;
}
