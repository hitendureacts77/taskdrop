/**
 * Plan a big day (D19, "TaskDrop Together"). One date in, a whole plan out: a built-in list of tasks for
 * the event, each placed relative to the chosen date. Pure, no storage and no React, so the lists, the
 * date maths and the saved-plan rules are unit-tested (bigDays.test.ts). The thin storage wrapper is
 * lib/bigDayStore.ts. The app never suggests prices, so nothing here has an amount: every task is posted
 * through the normal writer and the person sets its price there.
 */

export type BigDayKind = 'person' | 'online';

export type EventKey = 'moving' | 'birthday' | 'baby' | 'wedding' | 'festival' | 'parents' | 'exam' | 'shop';

/** A line of the built-in list. `offset` is days from the event day; null means any day. */
type TemplateLine = { title: string; offset: number | null; kind: BigDayKind };

type EventDef = {
  key: EventKey;
  /** The chip. */
  label: string;
  /** What the date row calls the day. */
  dayLabel: string;
  lines: TemplateLine[];
};

export const EVENTS: readonly EventDef[] = [
  {
    key: 'moving',
    label: 'Moving house',
    dayLabel: 'Moving day',
    lines: [
      { title: 'Move my internet connection', offset: -5, kind: 'online' },
      { title: 'Deep clean the new flat', offset: -2, kind: 'person' },
      { title: 'Packing help, 2 people', offset: -1, kind: 'person' },
      { title: 'Fit fans and the geyser', offset: 0, kind: 'person' },
      { title: 'Deep clean the old flat', offset: 1, kind: 'person' },
      { title: 'Help changing my address', offset: null, kind: 'online' },
    ],
  },
  {
    key: 'birthday',
    label: 'Birthday party',
    dayLabel: 'Party day',
    lines: [
      { title: 'Design and send birthday e-invites', offset: -10, kind: 'online' },
      { title: 'Make a photo slideshow or video', offset: -3, kind: 'online' },
      { title: 'Order a cake from a home baker', offset: -2, kind: 'person' },
      { title: 'Balloon and room decoration', offset: 0, kind: 'person' },
      { title: 'Help with snacks and serving guests', offset: 0, kind: 'person' },
      { title: 'Clear up after the party', offset: 1, kind: 'person' },
    ],
  },
  {
    key: 'baby',
    label: 'New baby',
    dayLabel: 'Due date',
    lines: [
      { title: 'Compare baby products and shortlist the best', offset: -21, kind: 'online' },
      { title: 'Assemble the cot and baby furniture', offset: -10, kind: 'person' },
      { title: 'Baby-proof sockets, balcony and corners', offset: -7, kind: 'person' },
      { title: 'Deep clean the house before the baby comes', offset: -5, kind: 'person' },
      { title: 'Wash and sterilise baby clothes and bottles', offset: -3, kind: 'person' },
      { title: 'Home-cooked meals for the first week', offset: 2, kind: 'person' },
      { title: 'Find a helper for a few hours a day', offset: null, kind: 'person' },
    ],
  },
  {
    key: 'wedding',
    label: 'Wedding at home',
    dayLabel: 'Wedding day',
    lines: [
      { title: 'Design and send e-invitations', offset: -30, kind: 'online' },
      { title: 'Make a photo slideshow for the function', offset: -7, kind: 'online' },
      { title: 'Deep clean the house', offset: -3, kind: 'person' },
      { title: 'Flower and light decoration', offset: -1, kind: 'person' },
      { title: 'Set up chairs, tables and a tent', offset: 0, kind: 'person' },
      { title: 'Help serving and looking after guests', offset: 0, kind: 'person' },
      { title: 'Clear up after the function', offset: 1, kind: 'person' },
    ],
  },
  {
    key: 'festival',
    label: 'Festival cleaning',
    dayLabel: 'Festival day',
    lines: [
      { title: 'Full-home deep clean', offset: -4, kind: 'person' },
      { title: 'Sofa and curtain cleaning', offset: -3, kind: 'person' },
      { title: 'Balcony and window cleaning', offset: -2, kind: 'person' },
      { title: 'Decorating and lights help', offset: -1, kind: 'person' },
      { title: 'Rangoli and entrance decoration', offset: 0, kind: 'person' },
      { title: 'Clear up after the festival', offset: 1, kind: 'person' },
    ],
  },
  {
    key: 'parents',
    label: 'Parents visiting',
    dayLabel: 'Arrival day',
    lines: [
      { title: 'Book their train or flight tickets', offset: -14, kind: 'online' },
      { title: 'Service the AC and fans', offset: -3, kind: 'person' },
      { title: 'Deep clean the guest room', offset: -2, kind: 'person' },
      { title: 'Stock the kitchen with groceries', offset: -1, kind: 'person' },
      { title: 'Pick them up from the airport or station', offset: 0, kind: 'person' },
      { title: 'Arrange a driver for day trips', offset: 1, kind: 'person' },
    ],
  },
  {
    key: 'exam',
    label: 'Exam month',
    dayLabel: 'First exam',
    lines: [
      { title: 'Make a revision timetable', offset: -21, kind: 'online' },
      { title: 'Weekly tutor for the hardest subject', offset: -14, kind: 'person' },
      { title: 'Check my mock test papers', offset: -10, kind: 'online' },
      { title: 'Print and bind study notes', offset: -7, kind: 'person' },
      { title: 'Fix the study-room light, fan and desk', offset: -5, kind: 'person' },
      { title: 'Daily home-cooked tiffin during exams', offset: 0, kind: 'person' },
    ],
  },
  {
    key: 'shop',
    label: 'Opening a shop',
    dayLabel: 'Opening day',
    lines: [
      { title: 'Design the shop logo and flyers', offset: -14, kind: 'online' },
      { title: 'Set up Google Maps and WhatsApp Business', offset: -7, kind: 'online' },
      { title: 'Paint touch-up and signboard fitting', offset: -4, kind: 'person' },
      { title: 'Deep clean the shop', offset: -2, kind: 'person' },
      { title: 'Set up shelves and the counter', offset: -2, kind: 'person' },
      { title: 'Hand out flyers nearby', offset: -1, kind: 'person' },
      { title: 'Balloons and decoration for opening day', offset: 0, kind: 'person' },
    ],
  },
];

export const MAX_PLANS = 3;
export const TITLE_MAX = 80;

export function eventDef(key: string): EventDef {
  return EVENTS.find((e) => e.key === key) ?? EVENTS[0]!;
}

// ---------------------------------------------------------------- dates ---
// Days are 'YYYY-MM-DD' in the person's own calendar, never a timestamp, so a plan does not slip a day
// when the phone's time zone changes.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The calendar day a key names (local midnight), or null when it is not a real date. */
export function parseDay(key: unknown): Date | null {
  if (typeof key !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!m) return null;
  const [y, mo, da] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const d = new Date(y, mo - 1, da);
  return d.getFullYear() === y && d.getMonth() === mo - 1 && d.getDate() === da ? d : null;
}

export function addDays(key: string, n: number): string {
  const d = parseDay(key) ?? new Date();
  return dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + n));
}

/** Keys sort the same as dates. */
export const isBefore = (a: string, b: string) => a < b;

/** "Sun, 15 Dec", the date row. */
export function longDay(key: string): string {
  const d = parseDay(key);
  return d ? `${WEEKDAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}` : '';
}

/** "Fri 13 Dec", a line of the plan and the post's own words. */
export function shortDay(key: string): string {
  const d = parseDay(key);
  return d ? `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}` : '';
}

/**
 * The day a line falls on: the event day plus its offset, never earlier than today (nobody can be hired
 * for yesterday), or null for "any day".
 */
export function itemDay(eventDay: string, offset: number | null, today: string): string | null {
  if (offset === null) return null;
  const d = addDays(eventDay, offset);
  return isBefore(d, today) ? today : d;
}

// ---------------------------------------------------------------- plans ---

export type BigDayItem = {
  id: string;
  title: string;
  /** Days from the event day; null = any day. */
  offset: number | null;
  kind: BigDayKind;
  /** Ticked: it becomes a task. */
  on: boolean;
  /** The task made from it, once posted. */
  taskId?: string;
};

export type BigDayPlan = {
  id: string;
  event: EventKey;
  /** 'YYYY-MM-DD' */
  day: string;
  items: BigDayItem[];
  createdAt: number;
};

/** The built-in list as editable lines: all ticked except "any day" ones. */
export function buildItems(event: EventKey): BigDayItem[] {
  return eventDef(event).lines.map((l, i) => ({
    id: `i${i}`,
    title: l.title,
    offset: l.offset,
    kind: l.kind,
    on: l.offset !== null,
  }));
}

export function newPlan(id: string, event: EventKey, day: string, now = Date.now()): BigDayPlan {
  return { id, event, day, items: buildItems(event), createdAt: now };
}

export const tickedCount = (p: Pick<BigDayPlan, 'items'>) => p.items.filter((i) => i.on).length;

export function cleanTitle(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, TITLE_MAX);
}

export function whenLabel(day: string, item: Pick<BigDayItem, 'offset'>, today: string): string {
  const d = itemDay(day, item.offset, today);
  return d ? shortDay(d) : 'Any day';
}

export const kindLabel = (k: BigDayKind) => (k === 'online' ? 'Online' : 'In person');

/** What the writer opens with for a line: its title, and its day when it has one. No amount, ever. */
export function postPrompt(plan: BigDayPlan, item: BigDayItem, today: string): string {
  const d = itemDay(plan.day, item.offset, today);
  return d ? `${item.title} on ${shortDay(d)}` : item.title;
}

/** The `bigDay` route param the writer takes, checked. */
export function bigDayParam(v: unknown): { planId: string; itemId: string } | null {
  if (typeof v !== 'object' || v === null) return null;
  const { planId, itemId } = v as { planId?: unknown; itemId?: unknown };
  return typeof planId === 'string' && planId && typeof itemId === 'string' && itemId ? { planId, itemId } : null;
}

// ---------------------------------------------------------------- store ---
// The rules of the saved list, apart from where it is kept (bigDayStore.ts).

const isKind = (k: unknown): k is BigDayKind => k === 'person' || k === 'online';

function cleanItem(x: unknown): BigDayItem | null {
  if (typeof x !== 'object' || x === null) return null;
  const r = x as Record<string, unknown>;
  const offset = r.offset === null ? null : typeof r.offset === 'number' && Number.isInteger(r.offset) ? r.offset : undefined;
  if (typeof r.id !== 'string' || typeof r.title !== 'string' || offset === undefined || !isKind(r.kind)) return null;
  const title = cleanTitle(r.title);
  if (!title) return null;
  return {
    id: r.id,
    title,
    offset,
    kind: r.kind,
    on: r.on === true,
    ...(typeof r.taskId === 'string' && r.taskId ? { taskId: r.taskId } : {}),
  };
}

/** Reads what storage held: anything malformed is dropped, never thrown. */
export function parsePlans(raw: string | null | undefined): BigDayPlan[] {
  try {
    const rows: unknown = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(rows)) return [];
    const out: BigDayPlan[] = [];
    for (const x of rows) {
      if (typeof x !== 'object' || x === null) continue;
      const r = x as Record<string, unknown>;
      if (typeof r.id !== 'string' || !EVENTS.some((e) => e.key === r.event) || !parseDay(r.day)) continue;
      const items = Array.isArray(r.items) ? r.items.map(cleanItem).filter((i): i is BigDayItem => i !== null) : [];
      if (items.length === 0) continue;
      out.push({ id: r.id, event: r.event as EventKey, day: r.day as string, items, createdAt: typeof r.createdAt === 'number' ? r.createdAt : 0 });
    }
    return out.sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PLANS);
  } catch {
    return [];
  }
}

/** Newest first; a fourth plan pushes the oldest out. A plan with the same id is replaced. */
export function withPlan(plans: BigDayPlan[], plan: BigDayPlan): BigDayPlan[] {
  return [plan, ...plans.filter((p) => p.id !== plan.id)].sort((a, b) => b.createdAt - a.createdAt).slice(0, MAX_PLANS);
}

export const withoutPlan = (plans: BigDayPlan[], planId: string): BigDayPlan[] => plans.filter((p) => p.id !== planId);

/** Records the task a line became. A line that already has one is left alone. */
export function withPosted(plans: BigDayPlan[], planId: string, itemId: string, taskId: string): BigDayPlan[] {
  return plans.map((p) =>
    p.id !== planId ? p : { ...p, items: p.items.map((i) => (i.id === itemId && !i.taskId ? { ...i, taskId } : i)) },
  );
}

/** A line posted again after its task was cancelled: the old task id is let go. */
export function withoutPosted(plans: BigDayPlan[], planId: string, itemId: string): BigDayPlan[] {
  return plans.map((p) =>
    p.id !== planId
      ? p
      : {
          ...p,
          items: p.items.map((i) => {
            if (i.id !== itemId) return i;
            const { taskId: _gone, ...rest } = i;
            return rest;
          }),
        },
  );
}

export type BigDayState = 'not_posted' | 'posted' | 'hired' | 'done' | 'cancelled';

/** The line's status from the real task's status (the server's words); no task = not posted. */
export function stateFor(taskId: string | undefined, status: string | undefined): BigDayState {
  if (!taskId) return 'not_posted';
  if (!status) return 'posted';
  if (status === 'OPEN') return 'posted';
  if (status === 'COMPLETED' || status === 'AUTO_COMPLETED') return 'done';
  if (status === 'CANCELLED') return 'cancelled';
  return 'hired';
}
