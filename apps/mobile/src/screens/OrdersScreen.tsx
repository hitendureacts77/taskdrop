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
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  listMyTasks,
  listMyBids,
  listMyAssignments,
  countBidsByTask,
  cancelTask,
  refundEscrow,
} from '../data/api';
import { type Theme } from '../theme';
import {
  bucketOf,
  openRow as openTaskRow,
  posterRow,
  toneDot,
  toneInk,
  workerAssignmentRow,
  workerBidRow,
  type ViewRow,
} from '../lib/taskRows';
import { FadeIn, Pressy, tx } from '../components/primitives';

/**
 * My bids / My requests — pixel parity with docs/design/_design_markup.html
 * lines 204-246 (title, sliding tab underline, order cards, empty state).
 * Data/handlers mirror docs/design/_design_source.jsx lines 138-196 (bidRows/
 * requestRows/orderRows/orderTabs). Mode-aware: workers see bids they placed,
 * posters see requests they posted.
 */


const WORKER_TABS = ['Listings', 'Accepted', 'Pending', 'Closed'];
const POSTER_TABS = ['Open', 'Active', 'Done'];


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

  const openRow = (row: ViewRow) => openTaskRow(row, { go, flash, setOpenTask, startedOf });

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
