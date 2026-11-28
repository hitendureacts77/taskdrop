import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FEES } from '@taskdrop/rules';
import { ConfirmDialog } from '../components/kit';
import { KeepTaskSheet } from '../components/KeepTaskSheet';
import { TopUpSheet } from '../components/TopUpSheet';
import { closeTaskText } from '../lib/closeTaskText';
import { useFees } from '../lib/useFees';
import { useMoneyMode } from '../lib/useMoneyMode';
import {
  View,
  Text as RNText,
  Pressable,
  RefreshControl,
} from 'react-native';
import { Grid, UnderlineTabs } from '../components/kit';
import { ListPage, SegmentedTabs } from '../components/ListPage';
import { CONTENT_INSET } from '../navigation/DesktopPage';
import { useLayout } from '../lib/layout';
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
  type Task,
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

// The desktop page's scroll content: ListPage's own padding, plus the inset the page header's content sits at.
const LIST_SCROLL = { paddingTop: 8, paddingBottom: 32, paddingHorizontal: CONTENT_INSET } as const;


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
  // On the desktop grid a long unbroken title must not push the price out of the card: it takes two lines and
  // shortens with "...", the price keeps its width. The phone card is unchanged.
  const { desktop } = useLayout();
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
          <RNText numberOfLines={desktop ? 2 : undefined} style={tx('700', 16, t.colors.ink, desktop ? { flex: 1, minWidth: 0 } : { flex: 1 })}>
            {row.title}
          </RNText>
          <RNText style={tx('800', 16, t.colors.ink, desktop ? { flexShrink: 0 } : undefined)}>{row.priceLabel}</RNText>
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
            <RNText style={tx('600', 12, t.colors.signalDeep)}>Cancel</RNText>
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
  // Desktop: a ListPage (tabs as a segmented control in the toolbar, the cards in a grid, the title in the page
  // header). Everywhere else the screen is drawn exactly as before.
  const { desktop } = useLayout();
  const [orderTab, setOrderTab] = useState(0);
  // Until the person picks a tab, show the first one that has something in it: right after sending an offer
  // the first tab (Services) is empty and read as "nothing here yet" while the offer sat under Pending.
  const [pickedTab, setPickedTab] = useState(false);

  const worker = mode === 'worker';

  // Real rows for the signed-in user: tasks they posted, or the quotes and
  // assignments they hold as a worker. Status drives the label, tone and the
  // action a tap performs.
  const [rows, setRows] = useState<ViewRow[]>([]);
  // The posted tasks behind the rows, so Delete can show the keep-it sheet and the exact refund words.
  const postedRef = useRef<Map<string, Task>>(new Map());
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
        postedRef.current = new Map(tasks.map((x) => [x.id, x]));
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
  const [keepIt, setKeepIt] = useState<Task | null>(null);
  const [topUp, setTopUp] = useState<Task | null>(null);
  const [confirmClose, setConfirmClose] = useState<Task | null>(null);
  const { planB } = useMoneyMode();
  const fees = useFees();
  const cancelPct = fees.cancelFine ?? FEES.POST_START_CANCEL_PENALTY_PCT;
  const closeWords = confirmClose
    ? closeTaskText({
        title: confirmClose.title,
        status: confirmClose.status,
        funded: Boolean(confirmClose.funded_at),
        fineMinor: Math.round((confirmClose.locked_minor ?? 0) * cancelPct),
        finePct: Math.round(cancelPct * 100),
        money: formatINR,
        refundTo: planB || (confirmClose.funded_via ?? 'wallet') !== 'wallet' ? 'source' : 'wallet',
      })
    : null;
  // A poster deleting a task they posted sees the keep-it sheet first; a worker stepping off goes straight through.
  const askCancel = (row: ViewRow) => {
    const posted = !worker && row.taskId ? postedRef.current.get(row.taskId) : undefined;
    if (posted) setKeepIt(posted);
    else void cancelRow(row);
  };

  const cancelRow = async (row: Pick<ViewRow, 'taskId'>) => {
    if (!row.taskId || cancelling) return;
    const funded = Boolean(postedRef.current.get(row.taskId)?.funded_at);
    setCancelling(row.taskId);
    try {
      await cancelTask(row.taskId);
      // The wording differs because the outcome does: a worker stepping off
      // puts the task back on the market rather than ending it.
      flash(worker ? 'You stepped off — the task is open again' : planB && funded ? 'Your refund has started. It goes back to the card or UPI you paid with.' : 'Request cancelled');
      await load();

      // A poster who paid gets that money back now, not when somebody
      // remembers. The refund is attempted quietly: the cancellation already
      // succeeded and must not be reported as having failed.
      if (!worker) {
        try {
          const out = await refundEscrow(row.taskId);
          if (!planB && out.refundedMinor > 0) {
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

  const pickTab = (i: number) => {
    setPickedTab(true);
    setOrderTab(i);
  };

  const cards = (
    <>
      <Grid>
      {orderRows.map((row, i) => (
        <OrderCard
          key={`${row.title}-${i}`}
          row={row}
          index={i}
          onOpen={() => openRow(row)}
          onCancel={row.taskId && row.cancellable ? () => askCancel(row) : undefined}
          t={t}
        />
      ))}
      </Grid>

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
    </>
  );

  const sheets = (
    <>
      <KeepTaskSheet
        task={keepIt}
        hasWorker={false}
        flash={flash}
        onKeep={() => setKeepIt(null)}
        onDelete={() => { const k = keepIt; setKeepIt(null); setConfirmClose(k); }}
        onTopUp={(k) => setTopUp(k as Task)}
        onSimilar={(k) => go('aiPost', { similar: k })}
      />
      <TopUpSheet task={topUp} onClose={() => setTopUp(null)} flash={flash} onRaised={() => void load()} />
      <ConfirmDialog
        visible={confirmClose !== null}
        danger
        icon="close"
        title="Delete this task?"
        message={closeWords?.message ?? ''}
        confirmLabel="Yes, delete"
        cancelLabel="Keep it"
        busy={cancelling !== null}
        onCancel={() => setConfirmClose(null)}
        onConfirm={() => {
          const c = confirmClose;
          setConfirmClose(null);
          if (c) void cancelRow({ taskId: c.id });
        }}
      />
    </>
  );

  if (desktop) {
    return (
      <Screen padded={false}>
        <ListPage
          scrollProps={{
            contentContainerStyle: LIST_SCROLL,
            refreshControl: <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} colors={[t.colors.accent]} />,
          }}
          toolbar={{
            left: (
              <SegmentedTabs
                tabs={tabNames.map((x) => ({ key: x, label: x }))}
                value={tabNames[orderTab] ?? tabNames[0]!}
                onChange={(k) => pickTab(tabNames.indexOf(k))}
              />
            ),
            right:
              orderRows.length > 0 ? (
                <RNText style={tx('600', 13, t.colors.muted, { fontVariant: ['tabular-nums'] })}>
                  {orderRows.length === 1 ? '1 order' : `${orderRows.length} orders`}
                </RNText>
              ) : undefined,
          }}
        >
          <FadeIn duration={260}>{cards}</FadeIn>
        </ListPage>
        {sheets}
      </Screen>
    );
  }

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
          {worker ? 'My Work' : 'My requests'}
        </RNText>

        <UnderlineTabs tabs={tabNames} active={orderTab} onPick={pickTab} />

        <View style={{ paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 }}>{cards}</View>
      </FadeIn>
      {sheets}
    </Screen>
  );
}
