import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp, type TaskCtx } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  listMyTasks,
  listMyBids,
  listMyAssignments,
  countBidsByTask,
  cancelTask,
  refundEscrow,
  type Task,
  type Bid,
  type Assignment,
} from '../data/api';
import { type Theme } from '../theme';
import { FadeIn, Pressy, tx } from '../components/primitives';

/**
 * My bids / My requests — pixel parity with docs/design/_design_markup.html
 * lines 204-246 (title, sliding tab underline, order cards, empty state).
 * Data/handlers mirror docs/design/_design_source.jsx lines 138-196 (bidRows/
 * requestRows/orderRows/orderTabs). Mode-aware: workers see bids they placed,
 * posters see requests they posted.
 */

/** Tone keys shared with `useApp().myBids` so both sources render identically. */
type Tone = 'accent' | 'gold' | 'signal' | 'blue' | 'violet' | 'neutral';
type Act = 'compare' | 'quotes' | 'confirm' | 'review' | 'active' | 'start' | 'pay' | null;

type ViewRow = {
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

function toneDot(tone: Tone, colors: Theme['colors']): string {
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

function toneInk(tone: Tone, colors: Theme['colors']): string {
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
function bucketOf(row: { bucket?: number; state: string }, worker: boolean): number {
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

const WORKER_TABS = ['Listings', 'Accepted', 'Pending', 'Closed'];
const POSTER_TABS = ['Open', 'Active', 'Done'];

/** A task the signed-in user posted. Status decides label, tone, tab and tap. */
function posterRow(task: Task, quoteCount = 0): ViewRow {
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
        state: quoteCount > 0 ? 'OPEN · ' + quoteCount + (quoteCount === 1 ? ' QUOTE' : ' QUOTES') : 'OPEN',
        tone: 'blue',
        meta: quoteCount > 0 ? 'Tap to compare and lock one' : 'Waiting for quotes',
        act: 'compare',
      };
    case 'LOCKED':
      // "Escrow funded" used to be printed here unconditionally, which was a
      // claim the data did not support: a locked task with funded_at null has
      // had nothing collected, and the worker cannot start until it does.
      return task.funded_at
        ? { ...base, bucket: 0, state: 'LOCKED · WORKER TO START', tone: 'accent', meta: 'Escrow funded · worker starts next', act: null }
        : { ...base, bucket: 0, state: 'AWAITING YOUR PAYMENT', tone: 'signal', meta: 'Pay the escrow so the worker can start', act: 'pay' };
    case 'TASK_STARTED':
      return { ...base, bucket: 1, state: 'ACTIVE · TIMER RUNNING', tone: 'gold', meta: 'Work is underway', act: 'active' };
    case 'OVERDUE':
      return { ...base, bucket: 1, state: 'OVERDUE', tone: 'signal', meta: 'Past the agreed time', act: 'active' };
    case 'WORK_DONE':
    case 'REVISION_REQUESTED':
      return { ...base, bucket: 1, state: 'MARKED DONE · CONFIRM TO RELEASE', tone: 'gold', meta: 'Tap to review and release', act: 'confirm' };
    case 'COMPLETED':
    case 'AUTO_COMPLETED':
      return { ...base, bucket: 2, state: 'DONE · RELEASED', tone: 'accent', meta: 'Tap to review the worker', act: 'review' };
    default:
      return { ...base, bucket: 2, state: String(task.status), tone: 'neutral', meta: '', act: null };
  }
}

/** A quote this worker sent that hasn't been locked yet. */
function workerBidRow(bid: Bid & { tasks: Task | null }): ViewRow {
  return {
    taskId: bid.task_id,
    bucket: 2,
    state: 'PENDING',
    tone: 'blue',
    title: bid.tasks?.title ?? 'Task',
    priceLabel: formatINR(bid.price_minor),
    priceMinor: bid.price_minor,
    meta: 'Quote sent · awaiting the poster',
    act: null,
  };
}

/** A task this worker was picked for. */
function workerAssignmentRow(a: Assignment & { tasks: Task | null }): ViewRow {
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
    return { ...base, bucket: 3, state: 'DONE · PAID', tone: 'accent', meta: 'Earnings are clearing', act: null };
  if (task?.status === 'WORK_DONE' || task?.status === 'REVISION_REQUESTED')
    return { ...base, bucket: 1, state: 'WORK DONE · AWAITING POSTER', tone: 'gold', meta: 'Poster confirms next', act: 'active' };
  if (task?.status === 'TASK_STARTED' || task?.status === 'OVERDUE' || a.status === 'started')
    return { ...base, bucket: 1, state: 'ACTIVE · TIMER RUNNING', tone: 'gold', meta: 'Task started · timer running', act: 'start' };
  // Sliding to start now fails server-side on an unfunded task, so say so here
  // rather than letting someone swipe into a refusal.
  if (!task?.funded_at)
    return { ...base, bucket: 1, state: 'WAITING ON PAYMENT', tone: 'gold', meta: 'The poster has not funded the escrow yet', act: null };
  return { ...base, bucket: 1, state: 'ACCEPTED · SWIPE TO START', tone: 'accent', meta: 'Escrow funded · first to start wins', act: 'start' };
}

/** Tab row with a sliding underline, ~ markup lines 208-214 (underline calc in
 * `_design_source.jsx` lines 351-356: width (100%-40px)/n, left 20px + that*index). */
function OrderTabs({
  tabs,
  active,
  onPick,
  t,
}: {
  tabs: string[];
  active: number;
  onPick: (i: number) => void;
  t: Theme;
}) {
  const [width, setWidth] = useState(0);
  const trackWidth = Math.max(0, width - 40);
  const underlineWidth = tabs.length ? trackWidth / tabs.length : 0;
  const left = useRef(new Animated.Value(20)).current;
  useEffect(() => {
    const anim = Animated.timing(left, {
      toValue: 20 + underlineWidth * active,
      duration: 300,
      useNativeDriver: false,
    });
    anim.start();
    return () => anim.stop();
  }, [active, underlineWidth, left]);

  return (
    <View
      style={{ flexDirection: 'row', paddingHorizontal: 20, position: 'relative' }}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
    >
      {tabs.map((label, i) => {
        const isActive = active === i;
        return (
          <Pressable
            key={label}
            onPress={() => onPick(i)}
            style={{ flex: 1, alignItems: 'center', paddingVertical: 11 }}
          >
            <RNText style={tx(isActive ? '700' : '600', 13, isActive ? t.colors.ink : t.colors.muted)}>
              {label}
            </RNText>
          </Pressable>
        );
      })}
      <View style={{ position: 'absolute', left: 20, right: 20, bottom: 0, height: 2, backgroundColor: t.colors.line }} />
      <Animated.View
        style={{ position: 'absolute', left, bottom: 0, height: 2, width: underlineWidth, backgroundColor: t.colors.ink }}
      />
    </View>
  );
}

function OrderCard({
  row,
  index,
  onOpen,
  onCancel,
  t,
}: {
  row: ViewRow;
  index: number;
  onOpen: () => void;
  onCancel?: () => void;
  t: Theme;
}) {
  return (
    <FadeIn duration={360} delay={index * 70} translateY={10} style={{ marginTop: 12 }}>
      <Pressy
        containsControls
        onPress={onOpen}
        scaleTo={0.985}
        style={{
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.line,
          borderRadius: 14,
          padding: 15,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View
            style={{
              width: 6,
              height: 6,
              borderRadius: 999,
              backgroundColor: toneDot(row.tone, t.colors),
            }}
          />
          <RNText style={tx('700', 10, toneInk(row.tone, t.colors), { letterSpacing: 1.6 })}>{row.state}</RNText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 12, marginTop: 9 }}>
          <RNText style={tx('700', 16, t.colors.ink, { flex: 1 })}>{row.title}</RNText>
          <RNText style={tx('800', 16, t.colors.ink)}>{row.priceLabel}</RNText>
        </View>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 6 })}>{row.meta}</RNText>

        {onCancel && (
          <Pressable
            onPress={onCancel}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={`Cancel ${row.title}`}
            style={{ alignSelf: 'flex-start', marginTop: 11 }}
          >
            <RNText style={tx('600', 12, t.colors.signal)}>Cancel</RNText>
          </Pressable>
        )}
      </Pressy>
    </FadeIn>
  );
}

/** Empty-state illustration copied from the markup's inline svg (lines 231-237) — no emoji. */
function EmptyBoxIcon({ t }: { t: Theme }) {
  return (
    <Svg width={120} height={96} viewBox="0 0 120 96" fill="none" opacity={0.75}>
      <Path d="M30 40h44v40H30z" stroke={t.colors.muted} strokeWidth={2.2} strokeLinejoin="round" />
      <Path d="M42 56h20" stroke={t.colors.muted} strokeWidth={2.2} strokeLinecap="round" />
      <Path d="M34 40 42 26h20l8 14" stroke={t.colors.muted} strokeWidth={2.2} strokeLinejoin="round" />
      <Circle cx={88} cy={66} r={8} stroke={t.colors.accent} strokeWidth={2.2} />
      <Path d="M18 80h84" stroke={t.colors.muted} strokeWidth={2.2} strokeLinecap="round" />
    </Svg>
  );
}

export function OrdersScreen() {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();
  const { flash, setOpenTask, startedOf } = useApp();
  const { userId } = useAuth();
  const [orderTab, setOrderTab] = useState(0);

  const worker = mode === 'worker';

  // Real rows for the signed-in user: tasks they posted, or the quotes and
  // assignments they hold as a worker. Status drives the label, tone and the
  // action a tap performs.
  const [rows, setRows] = useState<ViewRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      if (!worker) {
        const tasks = await listMyTasks(userId);
        const counts = await countBidsByTask(tasks.filter((t) => t.status === 'OPEN').map((t) => t.id));
        setRows(tasks.map((t) => posterRow(t, counts.get(t.id) ?? 0)));
      } else {
        const [bids, assignments] = await Promise.all([
          listMyBids(userId),
          listMyAssignments(userId),
        ]);
        // An assignment supersedes the quote it came from.
        const assignedTaskIds = new Set(assignments.map((a) => a.task_id));
        setRows([
          ...assignments.map(workerAssignmentRow),
          ...bids.filter((b) => !assignedTaskIds.has(b.task_id)).map(workerBidRow),
        ]);
      }
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [userId, worker]);

  useEffect(() => {
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await load();
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  const allRows = rows;

  const tabNames = worker ? WORKER_TABS : POSTER_TABS;
  const orderRows = useMemo(
    () => allRows.filter((r) => bucketOf(r, worker) === orderTab),
    [allRows, worker, orderTab],
  );

  // Every tap carries the real task id so the next screen works on live data.
  const [cancelling, setCancelling] = useState<string | null>(null);

  const cancelRow = async (row: ViewRow) => {
    if (!row.taskId || cancelling) return;
    setCancelling(row.taskId);
    try {
      await cancelTask(row.taskId);
      // The wording differs because the outcome does: a worker stepping off
      // puts the task back on the market rather than ending it.
      flash(worker ? 'You stepped off — the task is open again' : 'Request cancelled');
      await load();

      // A poster who paid gets that money back now, not when somebody
      // remembers. The refund is attempted quietly: the cancellation already
      // succeeded and must not be reported as having failed.
      if (!worker) {
        try {
          const out = await refundEscrow(row.taskId);
          if (out.refundedMinor > 0) {
            flash(formatINR(out.refundedMinor) + ' is on its way back to you');
            await load();
          }
        } catch {
          flash('Cancelled. Your refund is being processed — it can take a few days.');
        }
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not cancel that');
    } finally {
      setCancelling(null);
    }
  };

  const openRow = (row: ViewRow) => {
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
        return go('escrow', {
          ...p,
          priceMinor: row.priceMinor,
          escrowMinor: row.escrowMinor,
        });
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
  };

  const emptyLine = worker ? 'Quotes you send show up here.' : 'Requests you post show up here.';

  return (
    <Screen scroll padded={false} onRefresh={refresh} refreshing={refreshing}>
      <FadeIn duration={260}>
        <RNText
          style={tx('800', 24, t.colors.ink, {
            letterSpacing: -0.72,
            paddingTop: 6,
            paddingHorizontal: 20,
            paddingBottom: 14,
          })}
        >
          {worker ? 'My bids' : 'My requests'}
        </RNText>

        <OrderTabs tabs={tabNames} active={orderTab} onPick={setOrderTab} t={t} />

        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 }}>
          {orderRows.map((row, i) => (
            <OrderCard
              key={`${row.title}-${i}`}
              row={row}
              index={i}
              onOpen={() => openRow(row)}
              onCancel={row.taskId && row.cancellable ? () => void cancelRow(row) : undefined}
              t={t}
            />
          ))}

          {loading && orderRows.length === 0 &&
            [0, 1, 2].map((i) => (
              <View
                key={i}
                style={{
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: t.colors.line,
                  borderRadius: 14,
                  padding: 16,
                  marginTop: 12,
                  height: 86,
                  opacity: 0.5,
                }}
              />
            ))}

          {!loading && orderRows.length === 0 && (
            <FadeIn duration={400} style={{ paddingVertical: 70, alignItems: 'center' }}>
              <EmptyBoxIcon t={t} />
              <RNText style={tx('800', 18, t.colors.ink, { marginTop: 20 })}>Nothing here yet</RNText>
              <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21, textAlign: 'center' })}>
                {emptyLine}
              </RNText>
              <Pressy onPress={() => go('home')} scaleTo={0.96} style={{ marginTop: 20 }}>
                <RNText style={tx('700', 14, t.colors.ink, { textDecorationLine: 'underline' })}>Browse the feed</RNText>
              </Pressy>
            </FadeIn>
          )}
        </View>
      </FadeIn>
    </Screen>
  );
}
