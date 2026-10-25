import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
} from 'react-native';
import { UnderlineTabs } from '../components/kit';
import { Icon } from '../components/Icon';
import { Screen, formatINR, cardSurface } from '../components/ui';
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


const WORKER_TABS = ['Services', 'Accepted', 'Pending', 'Closed'];
const POSTER_TABS = ['Open', 'Active', 'Done'];


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
          ...cardSurface(t, 18),
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

/** The v2 empty state: a soft drop-tinted circle with a faint ripple ring. */
function EmptyBoxIcon({ t }: { t: Theme }) {
  return (
    <View style={{ width: 96, height: 96, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ position: 'absolute', width: 96, height: 96, borderRadius: 999, borderWidth: 1.5, borderColor: t.colors.accentBorder, opacity: 0.6 }} />
      <View style={{ width: 68, height: 68, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="briefcase" size={28} color={t.colors.accentDeep} strokeWidth={1.7} />
      </View>
    </View>
  );
}

export function OrdersScreen() {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();
  const { flash, setOpenTask, startedOf } = useApp();
  const { userId } = useAuth();
  const [orderTab, setOrderTab] = useState(0);
  // Until the person picks a tab, show the first one that has something in it: right after sending an offer
  // the first tab (Services) is empty and read as "nothing here yet" while the offer sat under Pending.
  const [pickedTab, setPickedTab] = useState(false);

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

  useEffect(() => {
    if (pickedTab || loading || allRows.length === 0) return;
    if (allRows.some((r) => bucketOf(r, worker) === orderTab)) return;
    const first = tabNames.findIndex((_, i) => allRows.some((r) => bucketOf(r, worker) === i));
    if (first > 0) setOrderTab(first);
  }, [pickedTab, loading, allRows, worker, orderTab, tabNames]);

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

  const emptyLine = worker ? 'Offers you send show up here.' : 'Requests you post show up here.';

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
          {worker ? 'My offers' : 'My requests'}
        </RNText>

        <UnderlineTabs tabs={tabNames} active={orderTab} onPick={(i) => { setPickedTab(true); setOrderTab(i); }} />

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
                  ...cardSurface(t, 18),
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
              <RNText style={tx('800', 18, t.colors.ink, { marginTop: 18, letterSpacing: -0.3 })}>Nothing here yet</RNText>
              <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21, textAlign: 'center' })}>
                {emptyLine}
              </RNText>
              <Pressy
                onPress={() => go('home')}
                scaleTo={0.96}
                style={{ marginTop: 20, backgroundColor: t.colors.btn, borderRadius: 999, paddingVertical: 12, paddingHorizontal: 22 }}
              >
                <RNText style={tx('700', 14, t.colors.onBtn)}>Browse jobs</RNText>
              </Pressy>
            </FadeIn>
          )}
        </View>
      </FadeIn>
    </Screen>
  );
}
