import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { cardSurface, formatINR } from '../ui';
import { Icon } from '../Icon';
import { rupees, timeAgo } from '../kit';
import { categoryIcon, categoryLabel } from '../WorkCard';
import { tx } from '../primitives';
import { useLayout } from '../../lib/layout';
import type { ViewRow } from '../../lib/taskRows';
import type { HeldRates } from '../../lib/heldWords';
import {
  customerShown,
  openDatePassed,
  posterDateBits,
  posterPill,
  posterStage,
  whereLine,
  workerButton,
  workerPill,
  type Bit,
} from '../../lib/myTasksBoard';
import { presenceOf } from '../../lib/presence';
import { newOffersLabel } from '../../lib/seenOffers';
import type { Profile, Task } from '../../data/api';
import { ActionButton, DotsButton, Face, IconTile, StatusPill } from './bits';
import { posterNextLabel } from './PosterCard';
import { areaOf, earnOf, earnedLine, workerDateBits } from './WorkerCard';

/**
 * The desktop My tasks / My work table (D31 v11, board WebMyTasks, >= 1024 wide only): one card holding the tabs
 * as a segmented control with a search box on the right, the tasks as rows (task, stage, offers or the person,
 * money, due, the live button and the ⋯ menu), and a "Showing X of Y" footer with Show more.
 */

/**
 * `dropBelow`: the least important columns leave when the table's room is narrower than this (layout px, the same
 * unit as `useTableWidth`, already divided by the page zoom), so nothing overlaps. `narrow`: the width the column
 * takes when the room is under NARROW.
 */
export type Column = { label: string; flex?: number; width?: number; narrow?: number; minWidth?: number; dropBelow?: number };

/** Under this much room (about a 1024 px window) the fixed columns tighten and the action buttons may wrap. */
const NARROW = 900;

/** The room the table's rows have, in layout px: the feed column less the page's side padding and the card's. */
function useTableWidth(): number {
  const { contentWidth } = useLayout();
  return contentWidth('feed') - 80;
}
const shownCols = (columns: Column[], w: number): Column[] =>
  columns.filter((c) => !c.dropBelow || w >= c.dropBelow).map((c) => (w < NARROW && c.narrow ? { ...c, width: c.narrow } : c));

export const POSTER_COLUMNS: Column[] = [
  // Task takes the room that is left; the others hold a width of their own (design D3: Status, Offers, Budget
  // narrow, Date wide enough for "Posted 3 Nov · No fixed date" on one line). Date goes first, then Offers.
  { label: 'TASK', flex: 1.05, minWidth: 150 },
  { label: 'STATUS', width: 156, narrow: 130 },
  { label: 'OFFERS', width: 156, narrow: 110, dropBelow: 700 },
  { label: 'BUDGET', width: 130, narrow: 100 },
  { label: 'DATE', flex: 1, minWidth: 180, dropBelow: 1090 },
  // Wide enough for the longest set (Leave a review + Book again + the menu); narrow: the buttons wrap.
  { label: '', width: 290, narrow: 170 },
];

export const WORKER_COLUMNS: Column[] = [
  { label: 'TASK', flex: 1.05, minWidth: 150 },
  { label: 'STATUS', width: 156, narrow: 130 },
  { label: 'CUSTOMER', width: 170, narrow: 130, dropBelow: 700 },
  { label: 'PRICE', width: 130, narrow: 100 },
  { label: 'DATE', flex: 1, minWidth: 180, dropBelow: 1090 },
  { label: '', width: 290, narrow: 170 },
];

// The actions column (no label) never shrinks, so its buttons and the menu are always whole. The other fixed columns
// may give a little room back (they share it by size, in the head row and every row alike), so a row can never be
// wider than the table; Task and Date take what is left.
const cellStyle = (c: Column) =>
  c.width
    ? { width: c.width, flexShrink: c.label ? 1 : 0, minWidth: 0 }
    : { flex: c.flex ?? 1, minWidth: c.minWidth ?? 0 };

export function DeskTableCard({
  toolbarLeft,
  toolbarRight,
  columns,
  children,
  footer,
  table = true,
}: {
  toolbarLeft?: React.ReactNode;
  toolbarRight?: React.ReactNode;
  columns: Column[];
  children: React.ReactNode;
  footer?: React.ReactNode;
  /** False for the tabs that keep their card grid (Saved, My services) or an empty state: no column heads. */
  table?: boolean;
}) {
  const t = useTheme();
  const { scale } = useLayout();
  const w = useTableWidth();
  return (
    <View nativeID="myTasksTable" style={[cardSurface(t, 16), { overflow: 'hidden' }]}>
      {/* The tabs are underline tabs 52 px tall (ListPage SegmentedTabs): the toolbar is exactly that high, and the
          column-head row under it draws the line they sit on. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, minHeight: 52 / scale, flexWrap: 'wrap' }}>
        <View style={{ flexGrow: 1, flexShrink: 0 }}>{toolbarLeft}</View>
        {toolbarRight}
      </View>
      {table ? (
        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: t.colors.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.colors.line }}>
          {shownCols(columns, w).map((c, i) => (
            <RNText key={i} style={[tx('700', 11, t.colors.muted, { letterSpacing: 1 }), cellStyle(c)]}>{c.label}</RNText>
          ))}
        </View>
      ) : (
        <View style={{ height: 1, backgroundColor: t.colors.line }} />
      )}
      {children}
      {footer ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}>{footer}</View>
      ) : null}
    </View>
  );
}

/** "Showing 10 of 12 open tasks" and, when more are waiting, Show more. */
export function TableFooter({ shown, total, noun, onMore }: { shown: number; total: number; noun: string; onMore: () => void }) {
  const t = useTheme();
  return (
    <>
      <RNText style={tx('500', 13, t.colors.muted, { flex: 1 })}>
        Showing {shown} of {total} {noun}
      </RNText>
      {shown < total ? <ActionButton kind="quiet" label="Show more" onPress={onMore} /> : null}
    </>
  );
}

function Row({ columns, cells, onPress, label }: { columns: Column[]; cells: React.ReactNode[]; onPress: () => void; label: string }) {
  const t = useTheme();
  const { scale } = useLayout();
  const w = useTableWidth();
  const keep = columns.map((c) => !c.dropBelow || w >= c.dropBelow);
  const shown = shownCols(columns, w);
  return (
    // Not a button: the row holds its own buttons (a button inside a button is invalid on the web).
    <Pressable onPress={onPress} accessibilityLabel={label}>
      {({ hovered }: { pressed: boolean; hovered?: boolean }) => (
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 16,
            paddingHorizontal: 20,
            paddingVertical: 8,
            minHeight: 56 / scale,
            borderTopWidth: 1,
            borderTopColor: t.colors.line,
            backgroundColor: hovered ? t.colors.bg : 'transparent',
          }}
        >
          {cells.filter((_, i) => keep[i]).map((cell, i) => (
            <View key={i} style={[cellStyle(shown[i]!), i === shown.length - 1 ? { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center', gap: 8 } : null]}>
              {cell}
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

/** The status pill hugs its words: never stretched across its column. */
function HugPill({ label, tone }: { label: string; tone: Parameters<typeof StatusPill>[0]['tone'] }) {
  return (
    <View style={{ alignItems: 'flex-start' }}>
      <StatusPill label={label} tone={tone} />
    </View>
  );
}

function TaskCell({ task, title }: { task: Pick<Task, 'category' | 'pillar' | 'loc_lat' | 'loc_label'> | null; title: string }) {
  const t = useTheme();
  const area = areaOf(task as Task | null);
  const sub = task ? whereLine(categoryLabel(task), area) : '';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <IconTile icon={categoryIcon(task?.category)} tone="accent" size={36} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={2} style={tx('700', 14.5, t.colors.ink, { lineHeight: 20 })}>{title}</RNText>
        {sub ? <RNText numberOfLines={1} style={tx('400', 12.5, t.colors.muted, { marginTop: 2 })}>{sub}</RNText> : null}
      </View>
    </View>
  );
}

function Two({ top, sub, topInk, subInk, icon }: { top: string; sub?: string | null; topInk?: string; subInk?: string; icon?: 'lock' }) {
  const t = useTheme();
  return (
    <View>
      <RNText numberOfLines={1} style={tx('700', 14, topInk ?? t.colors.ink, { fontVariant: ['tabular-nums'] })}>{top}</RNText>
      {sub ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 }}>
          {icon ? <Icon name={icon} size={11} color={subInk ?? t.colors.muted} /> : null}
          <RNText numberOfLines={1} style={tx('600', 11.5, subInk ?? t.colors.muted, { flexShrink: 1 })}>{sub}</RNText>
        </View>
      ) : null}
    </View>
  );
}

/** The date column: plain and bold parts, like the card's date line. */
function DateText({ bits, prefix }: { bits: Bit[]; prefix?: string }) {
  const t = useTheme();
  return (
    <RNText numberOfLines={1} style={tx('600', 12.5, t.colors.muted, { lineHeight: 18 })}>
      {prefix}
      {bits.map((b, i) => (b.b ? <RNText key={i} style={tx('800', 12.5, t.colors.ink)}>{b.t}</RNText> : b.t))}
    </RNText>
  );
}

/** One of my posted tasks as a table row. */
export function PosterDeskRow({
  task,
  offers,
  newOffers,
  worker,
  heldText,
  onOpen,
  onMenu,
  onAgain,
  onReview,
  first = false,
}: {
  /** The table's first row: the only one whose button may be filled. */
  first?: boolean;
  task: Task;
  offers: number;
  /** Offers that came in since this device last opened them (lib/seenOffers). */
  newOffers?: number;
  worker?: Profile | null;
  heldText: string;
  onOpen: () => void;
  onMenu: () => void;
  onAgain: () => void;
  onReview: () => void;
}) {
  const t = useTheme();
  const now = Date.now();
  const open = task.status === 'OPEN';
  const done = task.status === 'COMPLETED' || task.status === 'AUTO_COMPLETED';
  const closed = posterStage(task.status, offers) === 0;
  const passed = openDatePassed(task, now) || task.status === 'OVERDUE';
  const unpaid = task.status === 'LOCKED' && !task.funded_at;
  const rating = worker && worker.worker_rating_count > 0 ? worker.worker_rating_avg.toFixed(1) : null;

  const people = open ? (
    <RNText style={tx(offers > 0 ? '700' : '400', 13.5, offers > 0 ? t.colors.accentDeep : t.colors.muted)}>
      {offers > 0 ? `${offers} ${offers === 1 ? 'offer' : 'offers'}` : 'No offers'}
      {newOffersLabel(newOffers) ? <RNText style={tx('600', 12.5, t.colors.accentDeep)}>{` · ${newOffersLabel(newOffers)}`}</RNText> : null}
    </RNText>
  ) : closed ? (
    <RNText style={tx('400', 13.5, t.colors.muted)}>—</RNText>
  ) : worker ? (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Face name={worker.display_name} lastSeen={worker.last_seen_at} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={tx('700', 13, t.colors.ink)}>{worker.display_name}</RNText>
        <RNText numberOfLines={1} style={tx('500', 11.5, t.colors.muted)}>{[rating ? '★ ' + rating : '', done ? 'done' : presenceOf(worker.last_seen_at).label].filter(Boolean).join(' · ')}</RNText>
      </View>
    </View>
  ) : (
    <RNText style={tx('500', 13.5, t.colors.muted)}>{done ? 'Done' : 'Hired'}</RNText>
  );

  const budget = (
    <Two
      top={rupees((task.locked_minor ?? task.benchmark_minor) / 100)}
      sub={done ? `${heldText} paid` : unpaid ? 'Not paid yet' : task.funded_at && !closed ? `${heldText} held` : null}
      subInk={unpaid ? t.colors.signalDeep : t.colors.accentDeep}
      icon={!done && !unpaid && task.funded_at ? 'lock' : undefined}
    />
  );

  const pill = posterPill(task, offers, now);
  const dateBits = posterDateBits(task, now, timeAgo(task.created_at));

  const label = posterNextLabel(task, offers);
  const primary = label === 'Choose an offer' || label === 'Pay to start' || label === 'Review the work';
  const actions = (
    <>
      {/* Buttons repeated on every row are 32 px and outlined; only the first row's may be filled. */}
      {done ? <ActionButton row kind="outline" label="Leave a review" onPress={onReview} a11y={`Leave a review: ${task.title}`} /> : null}
      {open && passed && offers === 0 ? (
        <ActionButton row kind="outline" label="Post again" onPress={onAgain} a11y={`Post again: ${task.title}`} />
      ) : done ? (
        <ActionButton row kind={first ? 'primary' : 'outline'} label="Book again" onPress={onAgain} a11y={`Book again: ${task.title}`} />
      ) : (
        <ActionButton row kind={primary && first ? 'primary' : 'outline'} label={label} onPress={onOpen} a11y={`${label}: ${task.title}`} />
      )}
      <DotsButton boxed onPress={onMenu} />
    </>
  );

  return (
    <Row
      columns={POSTER_COLUMNS}
      label={task.title}
      onPress={onOpen}
      cells={[<TaskCell key="t" task={task} title={task.title} />, <HugPill key="s" label={pill.label} tone={pill.tone} />, people, budget, <DateText key="d" bits={dateBits} />, actions]}
    />
  );
}

/** One of my jobs or offers as a table row (Active, Offers and Closed tabs). */
export function WorkerDeskRow({
  row,
  task,
  customer,
  sentAt,
  rates,
  onOpen,
  first = false,
}: {
  /** The table's first row: the only one whose button may be filled. */
  first?: boolean;
  row: ViewRow;
  task: Task | null;
  customer?: Profile | null;
  sentAt?: string;
  rates: HeldRates;
  onOpen: () => void;
}) {
  const t = useTheme();
  const now = Date.now();
  const pending = row.state === 'PENDING';
  const active = row.bucket === 1;
  const earn = earnOf(row, task, rates);
  const shown = customerShown(task);
  const button = workerButton(row.state);

  const person = active ? (
    shown && customer?.display_name ? (
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Face name={customer.display_name} lastSeen={customer.last_seen_at} size={28} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <RNText numberOfLines={1} style={tx('700', 13, t.colors.ink)}>{customer.display_name}</RNText>
          {areaOf(task) ? <RNText numberOfLines={1} style={tx('500', 11.5, t.colors.muted)}>{areaOf(task)}</RNText> : null}
        </View>
      </View>
    ) : (
      <RNText style={tx('400', 12.5, t.colors.muted)}>Shown when the job starts</RNText>
    )
  ) : pending ? (
    <RNText style={tx('400', 12.5, t.colors.muted)}>Waiting for the customer</RNText>
  ) : (
    <RNText numberOfLines={2} style={tx('400', 12.5, t.colors.muted)}>{row.state === 'DONE · PAID' ? earnedLine(earn, task, now) : row.meta}</RNText>
  );

  const price = (
    <Two
      top={row.priceLabel}
      sub={active ? (task?.funded_at ? `You earn ${formatINR(earn)}` : 'Not paid yet') : pending ? `You’d earn ${formatINR(earn)}` : null}
      subInk={active && !task?.funded_at ? t.colors.signalDeep : t.colors.accentDeep}
      icon={active && task?.funded_at ? 'lock' : undefined}
    />
  );

  const pill = workerPill(row.state, task?.status);

  const action = button ? (
    <ActionButton row kind={button.kind === 'quiet' || !first ? 'outline' : 'primary'} label={button.label} onPress={onOpen} a11y={`${button.label}: ${row.title}`} />
  ) : (
    <ActionButton row kind="outline" label="Open job" onPress={onOpen} a11y={`Open job: ${row.title}`} />
  );

  return (
    <Row
      columns={WORKER_COLUMNS}
      label={row.title}
      onPress={onOpen}
      cells={[
        <TaskCell key="t" task={task} title={row.title} />,
        <HugPill key="s" label={pill.label} tone={pill.tone} />,
        person,
        price,
        <DateText key="d" bits={workerDateBits(row, task, now, sentAt)} prefix={row.state === 'ACTIVE · TIMER RUNNING' && task?.status !== 'OVERDUE' ? 'Timer running' : undefined} />,
        action,
      ]}
    />
  );
}
