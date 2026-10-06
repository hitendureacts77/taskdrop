import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, TextInput, RefreshControl } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { Badge, BottomSheet, ConfirmDialog, EmptyState, Grid, MenuRow, Pill, PillTabs, Shimmer, StatTile, SwipeTabs, rupees, timeLeft } from '../components/kit';
import { WorkCard, categoryIcon, categoryLabel } from '../components/WorkCard';
import { BidSheet } from '../components/BidSheet';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { descriptionPreview } from '../components/TaskDescription';
import { useTheme, ring } from '../providers/ThemeProvider';
import { useNav, useFocusTick } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp, useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import {
  attachPosters,
  cancelTask,
  getTask,
  countBidsByTask,
  listMyAssignments,
  listMyBids,
  listMyTasks,
  myStats,
  refundEscrow,
  type MyStats,
  type Task,
  type TaskWithPoster,
} from '../data/api';
import { listSavedTasks, listSavedTaskIds, setSaved } from '../data/extras';
import { openPostedTask, openRow, toneInk, workerAssignmentRow, workerBidRow, type ViewRow } from '../lib/taskRows';
import { ListingCard } from '../components/ListingCard';
import { taskToFeedRow } from '../lib/openTask';

/**
 * My Tasks (posting) / My Work (earning).
 *
 * The poster side is the task list with what matters about each one at a
 * glance -- quotes, escrow, time left -- and the actions a poster takes from
 * a list: open it, post a similar one, or close it (which refunds any escrow,
 * the same path the orders list has always used).
 */
export function MyTasksScreen() {
  const { mode } = useMode();
  return mode === 'worker' ? <MyWork /> : <MyPosted />;
}

// --------------------------------------------------------------- poster -----

const POSTER_TABS = ['Open', 'In progress', 'Completed', 'Closed'] as const;

function tabOf(task: Task): number {
  switch (task.status) {
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

export function statusBadge(task: Task): { label: string; tone: 'accent' | 'gold' | 'signal' | 'blue' | 'neutral' } {
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

function MyPosted() {
  const t = useTheme();
  const { go } = useNav();
  const { flash } = useActions();
  const { userId } = useAuth();
  const focusTick = useFocusTick();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [quotes, setQuotes] = useState<Map<string, number>>(new Map());
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const [needs, setNeeds] = useState(false);
  const [menu, setMenu] = useState<Task | null>(null);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setTasks([]);
      return;
    }
    // Every figure on this screen is counted from this one list, so the
    // summary card and the tab counts can never disagree.
    const rows = await listMyTasks(userId);
    const counts = await countBidsByTask(rows.filter((r) => r.status === 'OPEN').map((r) => r.id));
    setTasks(rows);
    setQuotes(counts);
  }, [userId, focusTick]);

  useEffect(() => {
    void load().catch(() => setTasks([]));
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  };

  const needCount = (tasks ?? []).filter((x) => x.status === 'OPEN' && (quotes.get(x.id) ?? 0) === 0).length;
  const counts = POSTER_TABS.map((_, i) => (tasks ?? []).filter((x) => tabOf(x) === i).length);

  const shown = useMemo(() => {
    if (!tasks) return null;
    const needle = q.trim().toLowerCase();
    return tasks.filter((x) => {
      if (needs) {
        if (!(x.status === 'OPEN' && (quotes.get(x.id) ?? 0) === 0)) return false;
      } else if (tabOf(x) !== tab) return false;
      if (!needle) return true;
      return [x.title, x.description, x.category ?? ''].join(' ').toLowerCase().includes(needle);
    });
  }, [tasks, tab, q, needs, quotes]);

  const close = async (task: Task) => {
    setClosing(true);
    try {
      await cancelTask(task.id);
      setConfirmClose(null);
      flash('Task closed');
      try {
        const out = await refundEscrow(task.id);
        if (out.refundedMinor > 0) flash(formatINR(out.refundedMinor) + ' is on its way back to you');
      } catch {
        flash('Closed. Your refund is being processed — it can take a few days.');
      }
      await load();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not close that task');
    } finally {
      setClosing(false);
    }
  };

  const reviewCount = (tasks ?? []).filter((x) => x.status === 'WORK_DONE').length;

  return (
    <Screen padded={false}>
      <AppHeader />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />}
      >
        {/* One summary card rather than four tiles: what is running, what is
            waiting on me, what is done. Spending lives in Wallet → Insights. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <View
            style={{
              borderRadius: 22,
              padding: 18,
              backgroundColor: t.colors.hero,
              overflow: 'hidden',
            }}
          >
            <View style={{ position: 'absolute', right: -40, top: -50, width: 160, height: 160, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.07)' }} />
            <View style={{ position: 'absolute', right: 30, bottom: -60, width: 120, height: 120, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.05)' }} />
            <RNText style={tx('600', 12, 'rgba(255,255,255,0.75)', { letterSpacing: 0.3 })}>Your tasks at a glance</RNText>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              {[
                { value: (counts[0] ?? 0) + (counts[1] ?? 0), label: 'Active' },
                { value: reviewCount, label: 'To review' },
                { value: counts[2] ?? 0, label: 'Completed' },
              ].map((m, i) => (
                <View key={m.label} style={{ flex: 1, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.15)', paddingLeft: i ? 14 : 0 }}>
                  <RNText style={tx('800', 26, '#FFFFFF', { letterSpacing: -0.6 })}>{m.value}</RNText>
                  <RNText style={tx('600', 12, 'rgba(255,255,255,0.75)', { marginTop: 1 })}>{m.label}</RNText>
                </View>
              ))}
            </View>
            {reviewCount > 0 ? (
              <Pressable
                onPress={() => {
                  const next = (tasks ?? []).find((x) => x.status === 'WORK_DONE');
                  if (next) openPostedTask(next, go);
                }}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 8,
                  marginTop: 16,
                  paddingVertical: 11,
                  paddingHorizontal: 14,
                  borderRadius: 14,
                  backgroundColor: 'rgba(255,255,255,0.14)',
                  transform: [{ scale: pressed ? 0.98 : 1 }],
                })}
              >
                <Icon name="eye" size={16} color="#FFFFFF" />
                <RNText style={tx('700', 13, '#FFFFFF', { flex: 1 })}>
                  {reviewCount === 1 ? '1 task is waiting for your review' : `${reviewCount} tasks are waiting for your review`}
                </RNText>
                <Icon name="chevronRight" size={16} color="#FFFFFF" />
              </Pressable>
            ) : null}
          </View>
        </View>

        <View {...ring}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginHorizontal: 20,
            marginTop: 16,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
            paddingHorizontal: 12,
          }}
        >
          <Icon name="search" size={16} color={t.colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="Search tasks, category…"
            placeholderTextColor={t.colors.muted}
            style={tx('400', 14, t.colors.ink, { flex: 1, paddingVertical: 11 })}
          />
        </View>
        {needCount > 0 ? (
          <View style={{ flexDirection: 'row', paddingHorizontal: 20, marginTop: 10 }}>
            <Pill label="Needs providers" icon="users" count={needCount} active={needs} onPress={() => setNeeds(!needs)} />
          </View>
        ) : null}

        <View style={{ marginTop: 14 }}>
          <PillTabs
            tabs={POSTER_TABS.map((x, i) => ({ label: x, count: counts[i] }))}
            active={tab}
            onPick={(i) => {
              setNeeds(false);
              setTab(i);
            }}
          />
        </View>

        <SwipeTabs
          index={tab}
          count={POSTER_TABS.length}
          onChange={(i) => {
            setNeeds(false);
            setTab(i);
          }}
          style={{ flex: 0 }}
        >
        <View style={{ paddingHorizontal: 20, paddingTop: 4, minHeight: 320 }}>
          {shown === null ? (
            [0, 1].map((i) => <Shimmer key={i} height={110} style={{ marginTop: 12 }} />)
          ) : shown.length === 0 ? (
            <EmptyState
              icon="list"
              title={tab === 0 && !needs ? 'No open tasks' : 'Nothing here yet'}
              body={tab === 0 ? 'Create your first task to start getting work done.' : undefined}
              actionLabel={tab === 0 ? 'Create task' : undefined}
              onAction={() => go('aiPost')}
            />
          ) : (
            <Grid>
            {shown.map((task, i) => (
              <PostedCard
                key={task.id}
                task={task}
                index={i}
                quotes={quotes.get(task.id) ?? 0}
                onOpen={() => openPostedTask(task, go)}
                onMenu={() => setMenu(task)}
              />
            ))}
            </Grid>
          )}
        </View>
        </SwipeTabs>
      </ScrollView>

      <BottomSheet visible={menu !== null} onClose={() => setMenu(null)} title={menu?.title}>
        {menu ? (
          <>
            <MenuRow icon="eye" label="View details" onPress={() => { const id = menu.id; setMenu(null); go('taskManage', { taskId: id }); }} />
            <MenuRow icon="copy" label="Create similar" sub="Start a new post from this one" onPress={() => { const m = menu; setMenu(null); go('aiPost', { similar: m }); }} />
            {['OPEN', 'LOCKED', 'TASK_STARTED', 'OVERDUE'].includes(menu.status) ? (
              <MenuRow
                icon="close"
                label="Close task"
                sub={menu.status === 'OPEN' ? 'Stop taking offers' : 'Cancels the job; payment is refunded minus any fine'}
                danger
                onPress={() => {
                  const m = menu;
                  setMenu(null);
                  setConfirmClose(m);
                }}
              />
            ) : null}
          </>
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmClose !== null}
        danger
        icon="close"
        title="Close this task?"
        message={
          confirmClose?.status === 'OPEN'
            ? `“${confirmClose.title}” will be taken down and workers can no longer send offers for it. This can’t be undone.`
            : `“${confirmClose?.title ?? ''}” will be cancelled and the worker taken off it. Any payment is refunded minus any fine. This can’t be undone.`
        }
        confirmLabel="Yes, close task"
        cancelLabel="Keep it"
        busy={closing}
        onCancel={() => setConfirmClose(null)}
        onConfirm={() => confirmClose && void close(confirmClose)}
      />
    </Screen>
  );
}

function PostedCard({
  task,
  index,
  quotes,
  service,
  onOpen,
  onMenu,
}: {
  task: Task;
  index: number;
  quotes: number;
  /** A worker's own service listing: no quotes, no "needs providers". */
  service?: boolean;
  onOpen: () => void;
  onMenu: () => void;
}) {
  const t = useTheme();
  const badge = statusBadge(task);
  const left = task.status === 'OPEN' ? timeLeft(task.due_at) : null;
  const preview = descriptionPreview(task.description, task.title);
  const tones = {
    accent: t.colors.accent,
    gold: t.colors.gold,
    signal: t.colors.signal,
    blue: t.colors.blue,
    neutral: t.colors.muted,
  } as const;
  const stripe = tones[badge.tone];

  // What the poster should do next, in words, so the card says more than a status.
  const next: { label: string; tone: string } | null = service
    ? null
    : task.status === 'OPEN'
      ? quotes > 0
        ? { label: `${quotes} offer${quotes === 1 ? '' : 's'} in · select one`, tone: t.colors.accentDeep }
        : { label: 'Waiting for offers', tone: t.colors.blue }
      : task.status === 'LOCKED' && !task.funded_at
        ? { label: 'Pay to start', tone: t.colors.signalDeep }
        : task.status === 'LOCKED'
          ? { label: 'Waiting for the worker to start', tone: t.colors.accentDeep }
        : task.status === 'WORK_DONE'
          ? { label: 'Review the work and release', tone: t.colors.goldInk }
          : task.status === 'TASK_STARTED'
            ? { label: 'Work underway · track it', tone: t.colors.goldInk }
            : null;

  return (
    <FadeIn duration={340} delay={Math.min(index, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
      <Pressy
        containsControls
        onPress={onOpen}
        scaleTo={0.985}
        style={{
          backgroundColor: t.colors.surface,
          borderWidth: 1,
          borderColor: t.colors.line,
          borderRadius: 18,
          overflow: 'hidden',
          shadowColor: '#000',
          shadowOpacity: 0.04,
          shadowRadius: 10,
          shadowOffset: { width: 0, height: 3 },
          elevation: 1,
        }}
      >
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: stripe }} />
        <View style={{ flexDirection: 'row', gap: 12, padding: 14, paddingLeft: 16 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={categoryIcon(task.category)} size={21} color={t.colors.accentDeep} strokeWidth={1.8} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Badge label={badge.label} tone={badge.tone} />
              <RNText style={tx('600', 11, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
                {categoryLabel(task)} · {task.assignment_mode === 'auto' ? 'Auto-hire' : 'Offers'}
              </RNText>
              <View style={{ flex: 1 }} />
              <Pressable onPress={onMenu} hitSlop={12} accessibilityRole="button" accessibilityLabel="Task options">
                <Icon name="dots" size={18} color={t.colors.muted} strokeWidth={2.4} />
              </Pressable>
            </View>
            <RNText style={tx('800', 16, t.colors.ink, { marginTop: 7, letterSpacing: -0.2 })} numberOfLines={2}>{task.title}</RNText>
            {preview ? (
              <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 4, lineHeight: 18 })} numberOfLines={2}>
                {preview}
              </RNText>
            ) : null}
          </View>
        </View>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            paddingHorizontal: 16,
            paddingVertical: 11,
            borderTopWidth: 1,
            borderTopColor: t.colors.line,
            backgroundColor: t.colors.surface2,
          }}
        >
          <RNText style={tx('800', 16, t.colors.ink)}>{rupees((task.locked_minor ?? task.benchmark_minor) / 100)}</RNText>
          {left ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="clock" size={12} color={left === 'overdue' ? t.colors.signal : t.colors.goldInk} />
              <RNText style={tx('600', 11.5, left === 'overdue' ? t.colors.signal : t.colors.goldInk)}>{left}</RNText>
            </View>
          ) : null}
          {task.funded_at && task.status !== 'COMPLETED' && task.status !== 'AUTO_COMPLETED' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="lock" size={12} color={t.colors.accentDeep} />
              <RNText style={tx('600', 11.5, t.colors.accentDeep)}>Held safely</RNText>
            </View>
          ) : null}
          <View style={{ flex: 1 }} />
          {next ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1 }}>
              <RNText style={tx('700', 12, next.tone, { flexShrink: 1 })} numberOfLines={1}>{next.label}</RNText>
              <Icon name="chevronRight" size={14} color={next.tone} />
            </View>
          ) : null}
        </View>
      </Pressy>
    </FadeIn>
  );
}

// --------------------------------------------------------------- worker -----

const WORKER_TABS = ['Active', 'Offers', 'Done', 'Saved', 'My services'] as const;

function MyWork() {
  const t = useTheme();
  const { go } = useNav();
  const { flash, setOpenTask, startedOf } = useApp();
  const { userId } = useAuth();
  const focusTick = useFocusTick();
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<ViewRow[] | null>(null);
  const [saved, setSavedTasks] = useState<TaskWithPoster[] | null>(null);
  // Services this worker listed; posters browse these (migration 050).
  const [listings, setListings] = useState<Task[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<MyStats | null>(null);
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      return;
    }
    const [bids, assignments, s, sv, ids, mine] = await Promise.all([
      listMyBids(userId),
      listMyAssignments(userId),
      myStats('worker').catch(() => null),
      listSavedTasks().then(attachPosters).catch(() => [] as TaskWithPoster[]),
      listSavedTaskIds().catch(() => new Set<string>()),
      listMyTasks(userId, 'service').catch(() => [] as Task[]),
    ]);
    setListings(mine.filter((x) => x.status !== 'CANCELLED'));
    const assigned = new Set(assignments.map((a) => a.task_id));
    setRows([
      ...assignments.map(workerAssignmentRow),
      ...bids.filter((b) => !assigned.has(b.task_id)).map(workerBidRow),
    ]);
    setStats(s);
    setSavedTasks(sv);
    setSavedIds(ids);
  }, [userId, focusTick]);

  useEffect(() => {
    void load().catch(() => setRows([]));
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  };

  // taskRows buckets: 1 accepted/active, 2 pending quote, 3 closed.
  const bucketFor = (i: number) => (i === 0 ? 1 : i === 1 ? 2 : 3);
  const list = (rows ?? []).filter((r) => r.bucket === bucketFor(tab));
  const counts = WORKER_TABS.map((_, i) =>
    i === 3 ? (saved?.length ?? 0) : i === 4 ? listings.length : (rows ?? []).filter((r) => r.bucket === bucketFor(i)).length,
  );

  const w = stats && stats.role === 'worker' ? stats : null;
  const success = w && w.quotesPlaced > 0 ? Math.round((w.quotesWon / w.quotesPlaced) * 100) : 0;

  // A pending quote opens back up for editing: price, pitch, hours, date.
  const editQuote = async (taskId?: string) => {
    if (!taskId) return;
    const task = await getTask(taskId).catch(() => null);
    if (!task) return flash('That request is no longer available');
    setBidTask(task);
  };

  const unsave = async (id: string) => {
    try {
      await setSaved(id, false);
      setSavedTasks((s) => (s ?? []).filter((x) => x.id !== id));
      setSavedIds((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not update saved');
    }
  };

  return (
    <Screen padded={false}>
      <AppHeader />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.purple} />}
      >
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: 20, paddingTop: 8 }}>
          <StatTile icon="wallet" label="Earned" value={w ? formatINR(w.earnedMinor) : '–'} />
          <StatTile icon="check" label="Completed" value={String(w?.jobsDone ?? '–')} tone="blue" />
          <StatTile icon="play" label="Active" value={String(w?.jobsLive ?? '–')} tone="gold" />
          <StatTile icon="trending" label="Success" value={`${success}%`} tone="purple" />
        </View>

        <View style={{ marginTop: 16 }}>
          <PillTabs tabs={WORKER_TABS.map((x, i) => ({ label: x, count: counts[i] }))} active={tab} onPick={setTab} />
        </View>

        <View style={{ paddingHorizontal: 20, paddingTop: 4 }}>
          {rows === null ? (
            [0, 1].map((i) => <Shimmer key={i} height={90} style={{ marginTop: 12 }} />)
          ) : tab === 4 ? (
            listings.length === 0 ? (
              <EmptyState
                icon="tag"
                title="No services listed yet"
                body="Offer what you do — “I will design your logo, from ₹800” — and customers can hire you straight from it."
                actionLabel="Offer a service"
                onAction={() => go('listing')}
              />
            ) : (
              <>
                {listings.map((task) => (
                  <View key={task.id} style={{ marginTop: 12 }}>
                    <ListingCard task={task} owner onPress={() => go('listing', { taskId: task.id })} />
                  </View>
                ))}
                <Pressable
                  onPress={() => go('listing')}
                  accessibilityRole="button"
                  style={{ marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 14, borderRadius: 14, borderWidth: 1, borderStyle: 'dashed', borderColor: t.colors.accentBorder }}
                >
                  <Icon name="plus" size={15} color={t.colors.accentDeep} />
                  <RNText style={tx('700', 13, t.colors.accentDeep)}>Offer another service</RNText>
                </Pressable>
              </>
            )
          ) : tab === 3 ? (
            (saved ?? []).length === 0 ? (
              <EmptyState icon="bookmark" title="No saved tasks" body="Tap the bookmark on any task to keep it here." actionLabel="Browse tasks" onAction={() => go('explore')} />
            ) : (
              (saved ?? []).map((task, i) => (
                <WorkCard
                  key={task.id}
                  task={task}
                  index={i}
                  saved={savedIds.has(task.id)}
                  onOpen={() => go('taskDetail', { row: taskToFeedRow(task) })}
                  onApply={() => setBidTask(task)}
                  onToggleSave={() => void unsave(task.id)}
                />
              ))
            )
          ) : list.length === 0 ? (
            <EmptyState
              icon="briefcase"
              title={tab === 0 ? 'No active tasks' : tab === 1 ? 'No pending offers' : 'Nothing finished yet'}
              body={tab === 0 ? 'Pick tasks from Explore to start working and earning.' : undefined}
              actionLabel="Browse tasks"
              onAction={() => go('explore')}
            />
          ) : (
            list.map((row, i) => (
              <FadeIn key={`${row.taskId}-${i}`} duration={320} delay={Math.min(i, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
                <Pressy
                  onPress={() =>
                    tab === 1 && row.state === 'PENDING' ? void editQuote(row.taskId) : openRow(row, { go, flash, setOpenTask, startedOf })
                  }
                  scaleTo={0.985}
                  style={{ backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 14 }}
                >
                  <RNText style={tx('700', 10, toneInk(row.tone, t.colors), { letterSpacing: 1.4 })}>{row.state}</RNText>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 7 }}>
                    <RNText style={tx('700', 15, t.colors.ink, { flex: 1 })} numberOfLines={2}>{row.title}</RNText>
                    <RNText style={tx('800', 15, t.colors.ink)}>{row.priceLabel}</RNText>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
                    <RNText style={tx('400', 12, t.colors.muted, { flex: 1 })}>{row.meta}</RNText>
                    {tab === 1 && row.state === 'PENDING' ? <RNText style={tx('700', 12, t.colors.purpleDeep)}>Edit offer ›</RNText> : null}
                  </View>
                </Pressy>
              </FadeIn>
            ))
          )}
        </View>
      </ScrollView>
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void refresh()} />
    </Screen>
  );
}
