import { View, Text as RNText, Pressable } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { cardSurface, formatINR } from '../ui';
import { Icon } from '../Icon';
import { rupees, timeAgo } from '../kit';
import { categoryIcon, categoryLabel } from '../WorkCard';
import { tx } from '../primitives';
import type { ViewRow } from '../../lib/taskRows';
import { toneInk } from '../../lib/taskRows';
import type { HeldRates } from '../../lib/heldWords';
import {
  POSTER_STAGES,
  WORKER_STAGES,
  customerShown,
  dayMonth,
  dueShort,
  firstName,
  openDatePassed,
  posterStage,
  workerButton,
  workerStage,
  workerStateLabel,
} from '../../lib/myTasksBoard';
import { newOffersLabel } from '../../lib/seenOffers';
import type { Profile, Task } from '../../data/api';
import { ActionButton, DotsButton, IconTile, Initial, SegmentTrack } from './bits';
import { posterNextLabel } from './PosterCard';
import { areaOf, earnOf, earnedLine } from './WorkerCard';

/**
 * The desktop My tasks / My work table (D31 v11, board WebMyTasks, >= 1024 wide only): one card holding the tabs
 * as a segmented control with a search box on the right, the tasks as rows (task, stage, offers or the person,
 * money, due, the live button and the ⋯ menu), and a "Showing X of Y" footer with Show more.
 */

export type Column = { label: string; flex?: number; width?: number };

export const POSTER_COLUMNS: Column[] = [
  { label: 'TASK', flex: 3 },
  { label: 'STAGE', flex: 1.5 },
  { label: 'OFFERS', flex: 1.4 },
  { label: 'BUDGET', flex: 1.2 },
  { label: 'DUE', flex: 1.4 },
  { label: '', width: 290 },
];

export const WORKER_COLUMNS: Column[] = [
  { label: 'TASK', flex: 3 },
  { label: 'STAGE', flex: 1.5 },
  { label: 'CUSTOMER', flex: 1.7 },
  { label: 'PRICE', flex: 1.3 },
  { label: 'DUE', flex: 1.3 },
  { label: '', width: 230 },
];

const cellStyle = (c: Column) => (c.width ? { width: c.width, flexShrink: 0 } : { flex: c.flex ?? 1, minWidth: 0 });

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
  return (
    <View nativeID="myTasksTable" style={[cardSurface(t, 16), { overflow: 'hidden' }]}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16, paddingHorizontal: 20, paddingVertical: 14, flexWrap: 'wrap' }}>
        <View style={{ flex: 1, minWidth: 0 }}>{toolbarLeft}</View>
        {toolbarRight}
      </View>
      {table ? (
        <View style={{ flexDirection: 'row', gap: 16, paddingHorizontal: 20, paddingVertical: 10, backgroundColor: t.colors.surface2, borderTopWidth: 1, borderBottomWidth: 1, borderColor: t.colors.line }}>
          {columns.map((c, i) => (
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
            paddingVertical: 14,
            borderTopWidth: 1,
            borderTopColor: t.colors.line,
            backgroundColor: hovered ? t.colors.bg : 'transparent',
          }}
        >
          {cells.map((cell, i) => (
            <View key={i} style={[cellStyle(columns[i]!), i === cells.length - 1 ? { flexDirection: 'row', justifyContent: 'flex-end', alignItems: 'center', gap: 8 } : null]}>
              {cell}
            </View>
          ))}
        </View>
      )}
    </Pressable>
  );
}

function TaskCell({ task, title }: { task: Pick<Task, 'category' | 'pillar' | 'loc_lat' | 'loc_label'> | null; title: string }) {
  const t = useTheme();
  const area = areaOf(task as Task | null);
  const sub = task ? [categoryLabel(task), area].filter(Boolean).join(' · ') : '';
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

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
}: {
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
  const who = firstName(worker?.display_name);
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
      <Initial name={worker.display_name} size={28} />
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={tx('700', 13, t.colors.ink)}>{worker.display_name}</RNText>
        <RNText numberOfLines={1} style={tx('500', 11.5, t.colors.muted)}>{[rating ? '★ ' + rating : '', done ? 'done' : 'hired'].filter(Boolean).join(' · ')}</RNText>
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

  const status: { text: string; ink: string } | null = done
    ? null
    : unpaid
      ? { text: 'Waiting for your payment', ink: t.colors.signalDeep }
      : task.status === 'LOCKED'
        ? { text: `Paid · ${who ?? 'worker'} starts next`, ink: t.colors.accentDeep }
        : task.status === 'TASK_STARTED'
          ? { text: `${who ?? 'The worker'} is working`, ink: t.colors.accentDeep }
          : task.status === 'WORK_DONE'
            ? { text: task.auto_complete_at ? `Review by ${dayMonth(task.auto_complete_at)}` : 'Review the work', ink: t.colors.goldInk }
            : task.status === 'REVISION_REQUESTED'
              ? { text: 'You asked for changes', ink: t.colors.accentDeep }
              : task.status === 'DISPUTED'
                ? { text: 'Problem reported', ink: t.colors.signalDeep }
                : null;
  const due = done ? (
    <Two top={task.completed_at ? `Done ${dayMonth(task.completed_at)}` : 'Done'} />
  ) : closed ? (
    <Two top="Closed" topInk={t.colors.muted} />
  ) : passed ? (
    <Two top="Date passed" topInk={t.colors.goldInk} sub={status?.text} subInk={status?.ink} />
  ) : (
    <Two top={task.due_at ? cap(dueShort(task.due_at, now)) : 'No date'} topInk={task.due_at ? t.colors.ink : t.colors.muted} sub={status?.text} subInk={status?.ink} />
  );

  const label = posterNextLabel(task, offers);
  const primary = label === 'Choose an offer' || label === 'Pay to start' || label === 'Review the work';
  const actions = (
    <>
      {done ? <ActionButton kind="outline" label="Leave a review" onPress={onReview} a11y={`Leave a review: ${task.title}`} /> : null}
      {open && passed && offers === 0 ? (
        <ActionButton kind="outline" label="Post again" onPress={onAgain} a11y={`Post again: ${task.title}`} />
      ) : done ? (
        <ActionButton label="Book again" onPress={onAgain} a11y={`Book again: ${task.title}`} />
      ) : (
        <ActionButton kind={primary ? 'primary' : 'outline'} label={label} onPress={onOpen} a11y={`${label}: ${task.title}`} />
      )}
      <DotsButton boxed onPress={onMenu} />
    </>
  );

  return (
    <Row
      columns={POSTER_COLUMNS}
      label={task.title}
      onPress={onOpen}
      cells={[<TaskCell key="t" task={task} title={task.title} />, <SegmentTrack key="s" stages={POSTER_STAGES} stage={posterStage(task.status, offers)} compact />, people, budget, due, actions]}
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
}: {
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
        <Initial name={customer.display_name} size={28} />
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

  const due = (
    <Two
      top={task?.due_at ? cap(dueShort(task.due_at, now)) : 'No date'}
      topInk={task?.due_at ? t.colors.ink : t.colors.muted}
      sub={pending && sentAt ? `Offer sent ${timeAgo(sentAt)}` : workerStateLabel(row.state).toLowerCase().replace(/^./, (c) => c.toUpperCase())}
      subInk={pending ? t.colors.muted : toneInk(row.tone, t.colors)}
    />
  );

  const action = button ? (
    <ActionButton kind={button.kind === 'quiet' ? 'outline' : 'primary'} label={button.label} onPress={onOpen} a11y={`${button.label}: ${row.title}`} />
  ) : null;

  return (
    <Row
      columns={WORKER_COLUMNS}
      label={row.title}
      onPress={onOpen}
      cells={[
        <TaskCell key="t" task={task} title={row.title} />,
        <SegmentTrack key="s" stages={WORKER_STAGES} stage={workerStage(row.state)} compact />,
        person,
        price,
        due,
        action,
      ]}
    />
  );
}
