import { countOrDash, successPercent } from '../lib/taskStatusText';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, TextInput, RefreshControl } from 'react-native';
import { Screen, cardSurface, formatINR } from '../components/ui';
import { TabTitle } from '../components/TabTitle';
import { myTasksLine, myWorkLine } from '../lib/tabLines';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { BottomSheet, ConfirmDialog, EmptyState, Grid, LoadFailed, MenuRow, Pill, PillTabs, Shimmer, StatTile, SwipeTabs, timeAgo } from '../components/kit';
import { WorkCard } from '../components/WorkCard';
import { BidSheet } from '../components/BidSheet';
import { DateTimeSheet, formatDeadline } from '../components/DateTimeSheet';
import { dueFor } from '../lib/taskBrief';
import { tx } from '../components/primitives';
import { listDrafts, removeDraft, type PostDraft } from '../lib/drafts';
import { useTheme, ring } from '../providers/ThemeProvider';
import { useNav, useFocusTick } from '../providers/NavProvider';
import { closeTaskText } from '../lib/closeTaskText';
import { KeepTaskSheet } from '../components/KeepTaskSheet';
import { TopUpSheet } from '../components/TopUpSheet';
import { useMoneyMode } from '../lib/useMoneyMode';
import { useFees } from '../lib/useFees';
import { FEES, posterEscrowCharge } from '@taskdrop/rules';
import { useMode } from '../providers/ModeProvider';
import { useApp, useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { newOffers } from '../lib/seenOffers';
import { canTopUp } from '../lib/topUp';
import { loadSeenOffers, saveSeenOffers } from '../lib/seenOffersStore';
import { GUEST_DRAFTS_OWNER } from '../lib/guest';
import { listGuestSaves, loadGuestSavedTasks, setGuestSaved } from '../lib/guestSaves';
import { GuestAccountCard, GuestNote } from '../components/GuestBits';
import {
  attachPosters,
  cancelTask,
  getTask,
  getTaskDetail,
  countBidsByTask,
  listMyAssignments,
  listMyBids,
  listMyTasks,
  myStats,
  refundEscrow,
  setTaskDue,
  type MyStats,
  type Profile,
  type Task,
  type TaskWithPoster,
} from '../data/api';
import { listSavedTasks, listSavedTaskIds, setSaved } from '../data/extras';
import { openPostedTask, openRow, posterRow, workerAssignmentRow, workerBidRow, type ViewRow } from '../lib/taskRows';
import { closedLine, customerShown, isHired, posterNeeds, posterTabOf, workerNeeds, type Need } from '../lib/myTasksBoard';
import { ListingCard } from '../components/ListingCard';
import { AlertsCard } from '../components/AlertsCard';
import { taskToFeedRow } from '../lib/openTask';
import { useMyOffers } from '../lib/useMyOffers';
import { useLayout } from '../lib/layout';
import { ListPage, SegmentedTabs } from '../components/ListPage';
import { CONTENT_INSET } from '../navigation/DesktopPage';
import { useDesktopHeaderPortal } from '../components/pageHeader';
import { NeedsNow } from '../components/myTasks/NeedsNow';
import { PosterCard } from '../components/myTasks/PosterCard';
import { WorkerCard } from '../components/myTasks/WorkerCard';
import { DeskTiles } from '../components/myTasks/DeskTiles';
import { DeskTableCard, POSTER_COLUMNS, PosterDeskRow, TableFooter, WORKER_COLUMNS, WorkerDeskRow } from '../components/myTasks/DeskTable';
import { HeaderButton } from '../components/myTasks/bits';

// Shared with Home's sections and the task page; the words live in lib/myTasksBoard.
export { statusBadge } from '../lib/myTasksBoard';

// The desktop page's scroll content: ListPage's own padding, plus the inset the page header's content sits at.
const LIST_SCROLL = { paddingTop: 8, paddingBottom: 32, paddingHorizontal: CONTENT_INSET } as const;

/** Desktop table rows shown before "Show more". */
const DESK_PAGE = 10;

/** How many hired tasks the list looks up the person for (one batched read; the rest just say "Hired"). */
const PEOPLE_LOOKUP = 12;

/**
 * My Tasks (posting) / My Work (earning), the Upwork way (D31 v11).
 *
 * The poster side opens with what needs them now, then the task list: an open task is a post getting offers,
 * a task with someone picked is hired work (who, the money held, where it stands, the next step). From a list a
 * poster opens a task, posts a similar one, or closes it (which refunds any escrow, the same path the orders
 * list has always used). On a desktop the list is a table under four summary tiles.
 */
export function MyTasksScreen() {
  const { mode } = useMode();
  return mode === 'worker' ? <MyWork /> : <MyPosted />;
}

// --------------------------------------------------------------- poster -----

const POSTER_TABS = ['Open', 'In progress', 'Completed', 'Closed'] as const;
const TAB_NOUN = ['open tasks', 'tasks in progress', 'completed tasks', 'closed tasks'] as const;

function MyPosted() {
  const t = useTheme();
  // Desktop: tiles, the Needs you now card and a table. Everywhere else the phone layout (board MyTasks).
  const { desktop } = useLayout();
  const px = desktop ? 0 : 20;
  const { go } = useNav();
  const { flash, setOpenTask } = useActions();
  const { userId, guest } = useAuth();
  const fees = useFees();
  // A guest's drafts wait on this phone under one shared owner until the account is made.
  const draftOwner = userId ?? (guest ? GUEST_DRAFTS_OWNER : null);
  const focusTick = useFocusTick();
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [quotes, setQuotes] = useState<Map<string, number>>(new Map());
  // "N new" per open task, against what this device saw when it last opened the offers (lib/seenOffers).
  const [freshOffers, setFreshOffers] = useState<Map<string, number>>(new Map());
  const [tab, setTab] = useState(0);
  const [q, setQ] = useState('');
  const [needs, setNeeds] = useState(false);
  // Phone: the search sits behind the magnifier in the header; the drafts are one pill that opens their list.
  const [searchOpen, setSearchOpen] = useState(false);
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [menu, setMenu] = useState<Task | null>(null);
  const [closing, setClosing] = useState(false);
  const [keepIt, setKeepIt] = useState<Task | null>(null);
  const [confirmClose, setConfirmClose] = useState<Task | null>(null);
  const { planB } = useMoneyMode();
  // The open post whose Top up picker is showing (D31; the server prices the change, migration 194).
  const [topUp, setTopUp] = useState<Task | null>(null);
  // The open post whose date picker is showing (plan 1.19 J: a passed date, or "No fixed date").
  const [dateFor, setDateFor] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  // True when the last load failed (offline, server hiccup): an empty list is then
  // "could not load", not "you have no tasks".
  const [failed, setFailed] = useState(false);
  // Half-written posts kept on this device (see lib/drafts).
  const [drafts, setDrafts] = useState<PostDraft[]>([]);
  // The draft whose X was tapped: it goes only once they say yes (P1-21).
  const [confirmDraft, setConfirmDraft] = useState<PostDraft | null>(null);
  // The person hired on each task, once looked up (getTaskDetail, the job page's own read).
  const [people, setPeople] = useState<Map<string, Profile | null>>(new Map());
  const asked = useRef(new Set<string>());
  // Desktop: how many table rows are shown.
  const [limit, setLimit] = useState(DESK_PAGE);
  useEffect(() => {
    if (!draftOwner) return setDrafts([]);
    let alive = true;
    void listDrafts(draftOwner).then((d) => alive && setDrafts(d));
    return () => {
      alive = false;
    };
  }, [draftOwner, focusTick]);

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
    setFailed(false);
    const { fresh, seed } = newOffers(counts, await loadSeenOffers(userId));
    if (seed) void saveSeenOffers(userId, seed);
    setFreshOffers(fresh);
  }, [userId, focusTick]);

  // On failure keep whatever is already on screen; with nothing yet, show the retry card.
  const loadOrFail = useCallback(
    () =>
      load().catch(() => {
        setFailed(true);
        setTasks((prev) => prev ?? []);
      }),
    [load],
  );

  useEffect(() => {
    void loadOrFail();
  }, [loadOrFail]);

  // Who was hired: in-progress tasks first, then completed ones, in one batched read. A miss just leaves the
  // card without the person row.
  useEffect(() => {
    const want = (tasks ?? [])
      .filter((x) => isHired(x.status) && !asked.current.has(x.id))
      .sort((a, b) => posterTabOf(a.status) - posterTabOf(b.status))
      .slice(0, Math.max(0, PEOPLE_LOOKUP - asked.current.size));
    if (want.length === 0) return;
    want.forEach((x) => asked.current.add(x.id));
    let alive = true;
    void Promise.all(want.map((x) => getTaskDetail(x.id).then((d) => [x.id, d?.worker ?? null] as const).catch(() => [x.id, null] as const))).then(
      (pairs) => {
        if (!alive) return;
        setPeople((cur) => {
          const next = new Map(cur);
          for (const [id, who] of pairs) next.set(id, who);
          return next;
        });
      },
    );
    return () => {
      alive = false;
    };
  }, [tasks]);

  const refresh = async () => {
    setRefreshing(true);
    await loadOrFail();
    setRefreshing(false);
  };

  const needCount = (tasks ?? []).filter((x) => x.status === 'OPEN' && (quotes.get(x.id) ?? 0) === 0).length;
  const counts = POSTER_TABS.map((_, i) => (tasks ?? []).filter((x) => posterTabOf(x.status) === i).length);

  const shown = useMemo(() => {
    if (!tasks) return null;
    const needle = q.trim().toLowerCase();
    return tasks.filter((x) => {
      if (needs) {
        if (!(x.status === 'OPEN' && (quotes.get(x.id) ?? 0) === 0)) return false;
      } else if (posterTabOf(x.status) !== tab) return false;
      if (!needle) return true;
      return [x.title, x.description, x.category ?? ''].join(' ').toLowerCase().includes(needle);
    });
  }, [tasks, tab, q, needs, quotes]);

  // A new tab, filter or search starts the desktop table from its first page.
  useEffect(() => setLimit(DESK_PAGE), [tab, needs, q]);

  // W3-6: the menu and the dialog name the cancel fine in rupees before it can happen.
  const cancelPct = fees.cancelFine ?? FEES.POST_START_CANCEL_PENALTY_PCT;
  const closeWordsFor = (task: Task) =>
    closeTaskText({
      title: task.title,
      status: task.status,
      funded: Boolean(task.funded_at),
      fineMinor: Math.round((task.locked_minor ?? 0) * cancelPct),
      finePct: Math.round(cancelPct * 100),
      money: formatINR,
      refundTo: planB || (task.funded_via ?? 'wallet') !== 'wallet' ? 'source' : 'wallet',
    });

  // Money previews from packages/rules with the live fee rate; the server prices the real charge.
  const priceOf = (task: Task) => task.locked_minor ?? task.benchmark_minor;
  const payTextOf = (task: Task) => formatINR(posterEscrowCharge(priceOf(task), fees.posterFee));
  const heldTextOf = (task: Task) => formatINR(task.funded_minor ?? posterEscrowCharge(priceOf(task), fees.posterFee));
  const closedTextOf = (task: Task) =>
    closedLine(task, { money: formatINR, fineMinor: Math.round((task.locked_minor ?? 0) * cancelPct), finePct: Math.round(cancelPct * 100) });

  const close = async (task: Task) => {
    setClosing(true);
    try {
      await cancelTask(task.id);
      setConfirmClose(null);
      flash(planB && task.funded_at ? 'Your refund has started. It goes back to the card or UPI you paid with.' : 'Task closed');
      // Show it closed now: the refund below can take several seconds, and the list sat unchanged until a pull-down (round 7, P1-15).
      setTasks((prev) => (prev ? prev.map((x) => (x.id === task.id ? { ...x, status: 'CANCELLED' } : x)) : prev));
      void load().catch(() => {});
      try {
        const out = await refundEscrow(task.id);
        if (!planB && out.refundedMinor > 0) flash(formatINR(out.refundedMinor) + ' is on its way back to you');
      } catch {
        flash('Closed. Your refund is being processed — it can take a few days.');
      }
      // The task is closed whatever this read says; a failed refresh must not read as "could not close".
      await load().catch(() => {});
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not close that task');
    } finally {
      setClosing(false);
    }
  };

  // A new date on an open post, or none (open-ended): the date is just a plan, the task stays open.
  const changeDate = async (task: Task, at: Date | null) => {
    setDateFor(null);
    try {
      const out = await setTaskDue(task.id, at ? at.toISOString() : null);
      const dueAt = out?.due_at ?? (at ? at.toISOString() : null);
      setTasks((prev) => (prev ? prev.map((x) => (x.id === task.id || (task.crew_id && x.crew_id === task.crew_id && x.status === 'OPEN') ? { ...x, due_at: dueAt, due_lapsed_at: null } : x)) : prev));
      flash(at ? `New date set: ${formatDeadline(at)}.` : 'No fixed date now. It stays open until you pick someone.');
      void load().catch(() => {});
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not change the date');
    }
  };

  const reviewCount = (tasks ?? []).filter((x) => x.status === 'WORK_DONE').length;

  // What needs the poster now, from the live states only (lib/myTasksBoard).
  const needItems = useMemo(
    () =>
      guest || !tasks
        ? []
        : posterNeeds(tasks, {
            offersOf: (id) => quotes.get(id) ?? 0,
            nameOf: (id) => people.get(id)?.display_name ?? null,
            payText: (x) => payTextOf(x as Task),
            now: Date.now(),
          }),
    // payTextOf only reads the fee rate.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tasks, quotes, people, guest, fees.posterFee],
  );
  const onNeed = (n: Need) => {
    const task = (tasks ?? []).find((x) => x.id === n.taskId);
    if (!task) return;
    if (n.kind === 'repost') return setDateFor(task);
    openPostedTask(task, go);
  };

  // The finished task's review: the same route the orders list's done row takes (taskRows act 'review').
  const review = (task: Task) => openRow(posterRow(task), { go, flash, setOpenTask, startedOf: () => false });

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />;
  const pickTab = (i: number) => {
    setNeeds(false);
    setTab(i);
  };
  const toggleNeeds = () => {
    if (!needs) setTab(0);
    setNeeds(!needs);
  };

  const portal = useDesktopHeaderPortal({ title: 'My tasks', right: <HeaderButton label="Post a request" onPress={() => go('aiPost')} /> });

  const guestNote = guest ? (
    <View style={{ paddingHorizontal: px }}>
      <GuestNote />
    </View>
  ) : null;

  const summaryTiles = [
    { value: (counts[0] ?? 0) + (counts[1] ?? 0), label: 'Active' },
    { value: reviewCount, label: 'To review' },
    { value: counts[2] ?? 0, label: 'Completed' },
  ];

  // Phone: one summary card rather than four tiles: what is running, what is waiting on me, what is done.
  // Spending lives in Wallet → Insights. What to review now sits in the Needs you now card under it.
  // Desktop: four tiles, the fourth the Needs providers switch.
  // B175: a guest has no tasks to count yet; the zeros read like a real empty account.
  const summary = guest ? null : desktop ? (
    <DeskTiles
      // W2-18: a dash while the tasks load, never a 0 that is not true yet.
      tiles={summaryTiles.map((m) => ({ label: m.label, value: countOrDash(m.value, tasks === null) }))}
      needs={tasks === null ? null : needCount}
      needsOn={needs}
      onNeeds={toggleNeeds}
    />
  ) : null;

  // Phone: the "at a glance" card and the tiles became this one live line under the tab's name (plan 1.19, row 3).
  const titleRow = desktop ? null : (
    <TabTitle
      title="My tasks"
      live={guest ? null : myTasksLine({ loaded: tasks !== null, need: needItems.length, active: (counts[0] ?? 0) + (counts[1] ?? 0), done: counts[2] ?? 0 })}
      action={
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          {guest ? null : (
            <Pressable
              onPress={() => setSearchOpen((o) => !o)}
              accessibilityRole="button"
              accessibilityLabel="Search tasks"
              accessibilityState={{ expanded: searchOpen }}
              style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 13, borderWidth: 1, borderColor: t.colors.line, backgroundColor: searchOpen ? t.colors.accentSoft : t.colors.surface, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.7 : 1 })}
            >
              <Icon name="search" size={17} color={searchOpen ? t.colors.accentDeep : t.colors.ink} />
            </Pressable>
          )}
          <Pressable
            onPress={() => go('aiPost')}
            accessibilityRole="button"
            accessibilityLabel="Post a task"
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.btn, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, opacity: pressed ? 0.8 : 1 })}
          >
            <Icon name="plus" size={15} color={t.colors.onBtn} />
            <RNText style={tx('800', 13.5, t.colors.onBtn)}>Post</RNText>
          </Pressable>
        </View>
      }
    />
  );

  const needsCard = <NeedsNow items={needItems} onPick={onNeed} desktop={desktop} side="hire" />;

  const alerts = <AlertsCard show={(tasks?.length ?? 0) > 0} side="hire" />;

  // Desktop: a 300-wide box on the right of the table's tab row. Elsewhere: the full-width box under the summary.
  const searchBox = (
    <View {...ring}
      style={
        desktop
          ? { flexDirection: 'row', alignItems: 'center', gap: 8, width: 300, flexShrink: 1, minWidth: 150, ...cardSurface(t, 12), shadowOpacity: 0, paddingHorizontal: 14 }
          : {
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              marginHorizontal: 20,
              marginTop: 16,
              ...cardSurface(t, 16),
              paddingHorizontal: 14,
            }
      }
    >
      <Icon name="search" size={17} color={t.colors.muted} />
      <TextInput
        value={q}
        onChangeText={setQ}
        placeholder="Search tasks, category…"
        placeholderTextColor={t.colors.muted}
        autoFocus={!desktop}
        style={tx('400', 14, t.colors.ink, { flex: 1, paddingVertical: desktop ? 9 : 11 })}
      />
    </View>
  );

  // Desktop shows the same switch as its fourth tile.
  const needsPill =
    needCount > 0 && !desktop ? <Pill label="Needs providers" icon="users" count={needCount} active={needs} onPress={toggleNeeds} /> : null;

  const draftRows = (
    <>
        {drafts.map((d) => (
          <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, ...cardSurface(t, 16), paddingLeft: 14, paddingRight: 8 }}>
            <Pressable
              onPress={() => go('aiPost', { prompt: d.prompt, draftId: d.id })}
              accessibilityRole="button"
              accessibilityLabel={`Continue draft: ${d.prompt}`}
              style={{ flex: 1, paddingVertical: 12 }}
            >
              <RNText numberOfLines={2} style={tx('600', 14, t.colors.ink, { lineHeight: 20 })}>{d.prompt}</RNText>
              <RNText style={tx('500', 12, t.colors.accentDeep, { marginTop: 3 })}>Continue · saved {timeAgo(new Date(d.savedAt).toISOString())} · price and date asked again</RNText>
            </Pressable>
            <Pressable
              onPress={() => {
                setDraftsOpen(false);
                setConfirmDraft(d);
              }}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Delete this draft"
              style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}
            >
              <Icon name="close" size={16} color={t.colors.muted} />
            </Pressable>
          </View>
        ))}
    </>
  );
  // Desktop: the drafts stay a block above the table. Phone: one pill that opens the same rows in a sheet.
  const draftsBlock =
    desktop && drafts.length > 0 ? (
      <View style={{ paddingHorizontal: px, marginBottom: 20, gap: 8 }}>
        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>DRAFTS · {drafts.length}</RNText>
        {draftRows}
      </View>
    ) : null;
  const draftsPill = !desktop && drafts.length > 0 ? <Pill label="Drafts" icon="edit" count={drafts.length} onPress={() => setDraftsOpen(true)} /> : null;

  const empty =
    shown === null ? null : shown.length === 0 && failed ? (
      <LoadFailed onRetry={() => void refresh()} />
    ) : shown.length === 0 ? (
      q.trim() ? (
        // A search that found nothing is not an empty account (round 7, P1-10).
        <EmptyState icon="search" title={`No tasks match "${q.trim()}"`} body="Check the spelling, or clear the search to see them all." actionLabel="Clear search" onAction={() => setQ('')} />
      ) : (
        <EmptyState
          icon="list"
          title={tab === 0 && !needs ? 'No open tasks' : 'Nothing here yet'}
          body={tab === 0 ? 'Create your first task to start getting work done.' : undefined}
          actionLabel={tab === 0 ? 'Create task' : undefined}
          onAction={() => go('aiPost')}
        />
      )
    ) : null;

  const cardProps = (task: Task) => ({
    task,
    offers: quotes.get(task.id) ?? 0,
    newOffers: freshOffers.get(task.id),
    worker: people.get(task.id),
    onOpen: () => openPostedTask(task, go),
    onMenu: () => setMenu(task),
    onTopUp: () => setTopUp(task),
    onNewDate: () => setDateFor(task),
    onAgain: () => go('aiPost', { similar: task }),
    onReview: () => review(task),
  });

  const results = (
    <View style={{ paddingHorizontal: px, paddingTop: 4, minHeight: 320 }}>
      {shown === null ? (
        [0, 1].map((i) => <Shimmer key={i} height={110} style={{ marginTop: 12 }} />)
      ) : empty ? (
        empty
      ) : (
        <Grid>
          {shown.map((task, i) => (
            <PosterCard
              key={task.id}
              {...cardProps(task)}
              index={i}
              payText={payTextOf(task)}
              heldText={heldTextOf(task)}
              closedText={closedTextOf(task)}
              onClose={() => setKeepIt(task)}
              onChat={() => go('chat', { taskId: task.id, title: task.title })}
            />
          ))}
        </Grid>
      )}
    </View>
  );

  const table = (
    <DeskTableCard
      columns={POSTER_COLUMNS}
      table={!!shown && !empty}
      toolbarLeft={
        <SegmentedTabs
          tabs={POSTER_TABS.map((x, i) => ({ key: x, label: x, count: tasks === null ? undefined : counts[i] }))}
          value={POSTER_TABS[tab] ?? POSTER_TABS[0]}
          onChange={(k) => pickTab(POSTER_TABS.indexOf(k))}
        />
      }
      toolbarRight={searchBox}
      footer={
        shown && !empty ? (
          <TableFooter shown={Math.min(limit, shown.length)} total={shown.length} noun={needs ? 'tasks that need providers' : TAB_NOUN[tab]!} onMore={() => setLimit((n) => n + DESK_PAGE)} />
        ) : null
      }
    >
      {shown === null ? (
        <View style={{ padding: 20, gap: 12 }}>
          {[0, 1, 2].map((i) => <Shimmer key={i} height={52} />)}
        </View>
      ) : empty ? (
        <View style={{ padding: 20 }}>{empty}</View>
      ) : (
        shown.slice(0, limit).map((task, i) => <PosterDeskRow key={task.id} first={i === 0} {...cardProps(task)} heldText={heldTextOf(task)} />)
      )}
    </DeskTableCard>
  );

  // Phone children, in order. The tab pills row is the sticky one: it stays in view while the list scrolls.
  const kids: React.ReactElement[] = [];
  const add = (key: string, node: React.ReactNode) => {
    if (node) kids.push(<View key={key}>{node}</View>);
  };
  add('guest', guestNote);
  add('needs', needsCard);
  add('alerts', alerts);
  add('search', searchOpen || q ? searchBox : null);
  add('chips', needsPill || draftsPill ? <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 20, marginTop: 10 }}>{needsPill}{draftsPill}</View> : null);
  const stickyAt = kids.length;
  kids.push(
    <View key="tabs" style={{ backgroundColor: t.colors.bg, paddingTop: 10, paddingBottom: 6 }}>
      <PillTabs
        tabs={POSTER_TABS.map((x, i) => (tasks === null ? { label: x } : { label: x, count: counts[i] }))}
        active={tab}
        onPick={pickTab}
      />
    </View>,
    <SwipeTabs key="list" index={tab} count={POSTER_TABS.length} onChange={pickTab} style={{ flex: 0 }}>
      {results}
    </SwipeTabs>,
  );

  return (
    <Screen padded={false}>
      <AppHeader />
      {titleRow}
      {portal}
      {desktop ? (
        <ListPage scrollProps={{ refreshControl, contentContainerStyle: LIST_SCROLL }}>
          {guestNote}
          {summary}
          {alerts}
          {needsCard}
          {draftsBlock}
          {table}
        </ListPage>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} refreshControl={refreshControl} stickyHeaderIndices={[stickyAt]}>
          {kids}
        </ScrollView>
      )}

      <BottomSheet visible={menu !== null} onClose={() => setMenu(null)} title={menu?.title}>
        {menu ? (
          <>
            <MenuRow icon="eye" label="View details" onPress={() => { const id = menu.id; setMenu(null); go('taskManage', { taskId: id }); }} />
            <MenuRow icon="copy" label="Create similar" sub="Start a new post from this one" onPress={() => { const m = menu; setMenu(null); go('aiPost', { similar: m }); }} />
            {canTopUp(menu) ? (
              <MenuRow icon="plus" label="Top up" sub="Offer workers a bit more to get offers sooner" onPress={() => { const m = menu; setMenu(null); setTopUp(m); }} />
            ) : null}
            {['OPEN', 'LOCKED', 'TASK_STARTED', 'OVERDUE'].includes(menu.status) ? (
              <MenuRow
                icon="close"
                label="Delete task"
                sub={closeWordsFor(menu).sub}
                danger
                onPress={() => {
                  const m = menu;
                  setMenu(null);
                  setKeepIt(m);
                }}
              />
            ) : null}
          </>
        ) : null}
      </BottomSheet>

      <BottomSheet visible={draftsOpen} onClose={() => setDraftsOpen(false)} title={`Drafts · ${drafts.length}`}>
        <View style={{ gap: 8 }}>{draftRows}</View>
      </BottomSheet>

      <KeepTaskSheet
        task={keepIt}
        hasWorker={false}
        flash={flash}
        onKeep={() => setKeepIt(null)}
        onDelete={() => { const k = keepIt; setKeepIt(null); setConfirmClose(k); }}
        onTopUp={(k) => setTopUp(k as Task)}
        onSimilar={(k) => go('aiPost', { similar: k })}
      />
      <TopUpSheet
        task={topUp}
        onClose={() => setTopUp(null)}
        flash={flash}
        onRaised={(id, out) => {
          if (out) setTasks((prev) => (prev ? prev.map((x) => (x.id === id ? { ...x, topup_pct: out.topup_pct, benchmark_minor: out.benchmark_minor } : x)) : prev));
          void load().catch(() => {});
        }}
      />

      <DateTimeSheet
        visible={dateFor !== null}
        title="Close this task by"
        subtitle="Workers see this date on your post."
        confirmLabel="Set closing time"
        initial={dateFor ? dueFor('2days') : undefined}
        onCancel={() => setDateFor(null)}
        onConfirm={(d) => dateFor && void changeDate(dateFor, d)}
        onOpenEnded={() => dateFor && void changeDate(dateFor, null)}
        openEndedLabel="Keep no fixed date"
      />
      <ConfirmDialog
        visible={confirmClose !== null}
        danger
        icon="close"
        title="Delete this task?"
        message={confirmClose ? closeWordsFor(confirmClose).message : ''}
        confirmLabel="Yes, delete"
        cancelLabel="Keep it"
        busy={closing}
        onCancel={() => setConfirmClose(null)}
        onConfirm={() => confirmClose && void close(confirmClose)}
      />
      <ConfirmDialog
        visible={confirmDraft !== null}
        danger
        icon="close"
        title="Delete this draft?"
        message={`“${confirmDraft?.prompt ?? ''}” will be deleted. This can’t be undone.`}
        confirmLabel="Yes, delete draft"
        cancelLabel="Keep it"
        onCancel={() => setConfirmDraft(null)}
        onConfirm={() => {
          const d = confirmDraft;
          setConfirmDraft(null);
          if (!d || !draftOwner) return;
          setDrafts((cur) => cur.filter((x) => x.id !== d.id));
          void removeDraft(draftOwner, d.id);
          flash('Draft deleted');
        }}
      />
    </Screen>
  );
}

// --------------------------------------------------------------- worker -----

// "Closed", not "Done": it also holds offers the customer did not pick, which are not completed jobs.
const WORKER_TABS = ['Active', 'Offers', 'Closed', 'Saved', 'My services'] as const;
const WORKER_NOUN = ['active jobs', 'offers waiting', 'closed'] as const;

function MyWork() {
  const t = useTheme();
  // Desktop: the Needs you now card and a table; elsewhere the phone layout (board MyWork).
  const { desktop } = useLayout();
  const px = desktop ? 0 : 20;
  const { go } = useNav();
  const { flash, setOpenTask, startedOf } = useApp();
  const { userId, guest } = useAuth();
  const fees = useFees();
  const focusTick = useFocusTick();
  const [pickedTab, setTab] = useState(0);
  // A guest only has the jobs saved on this phone (B175).
  const tab = guest ? 3 : pickedTab;
  const [rows, setRows] = useState<ViewRow[] | null>(null);
  // The task behind each row (assignments and offers carry it) and when each offer was sent.
  const [taskById, setTaskById] = useState<Map<string, Task>>(new Map());
  const [sentAt, setSentAt] = useState<Map<string, string>>(new Map());
  // The customer of each started job: named to the worker only once the job starts.
  const [customers, setCustomers] = useState<Map<string, Profile | null>>(new Map());
  const askedCustomers = useRef(new Set<string>());
  const [saved, setSavedTasks] = useState<TaskWithPoster[] | null>(null);
  // Services this worker listed; posters browse these (migration 050).
  const [listings, setListings] = useState<Task[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [stats, setStats] = useState<MyStats | null>(null);
  const [bidTask, setBidTask] = useState<Task | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [limit, setLimit] = useState(DESK_PAGE);
  const offers = useMyOffers(userId, (saved ?? []).map((r) => r.id), !guest);

  const load = useCallback(async () => {
    if (!userId) {
      setRows([]);
      if (guest) {
        // Nothing of theirs yet, but the tasks they saved on this phone are listed.
        setSavedTasks(await attachPosters(await loadGuestSavedTasks(getTask)).catch(() => [] as TaskWithPoster[]));
        setSavedIds(new Set(await listGuestSaves()));
      }
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
    const byId = new Map<string, Task>();
    for (const b of bids) if (b.tasks) byId.set(b.task_id, b.tasks);
    for (const a of assignments) if (a.tasks) byId.set(a.task_id, a.tasks);
    setTaskById(byId);
    setSentAt(new Map(bids.map((b) => [b.task_id, b.created_at])));
    setStats(s);
    setSavedTasks(sv);
    setSavedIds(ids);
    setFailed(false);
  }, [userId, guest, focusTick]);

  const loadOrFail = useCallback(
    () =>
      load().catch(() => {
        setFailed(true);
        setRows((prev) => prev ?? []);
      }),
    [load],
  );

  useEffect(() => {
    void loadOrFail();
  }, [loadOrFail]);

  // The customers of jobs that have started (privacy: never before), in one read of the posters.
  useEffect(() => {
    const want = (rows ?? [])
      .filter((r) => r.bucket === 1 && r.taskId && !askedCustomers.current.has(r.taskId))
      .map((r) => taskById.get(r.taskId!))
      .filter((x): x is Task => !!x && customerShown(x));
    if (want.length === 0) return;
    want.forEach((x) => askedCustomers.current.add(x.id));
    let alive = true;
    void attachPosters(want)
      .then((list) => {
        if (!alive) return;
        setCustomers((cur) => {
          const next = new Map(cur);
          for (const x of list) next.set(x.id, x.poster);
          return next;
        });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [rows, taskById]);

  const refresh = async () => {
    setRefreshing(true);
    await loadOrFail();
    setRefreshing(false);
  };

  // taskRows buckets: 1 accepted/active, 2 pending quote, 3 closed.
  const bucketFor = (i: number) => (i === 0 ? 1 : i === 1 ? 2 : 3);
  const list = (rows ?? []).filter((r) => r.bucket === bucketFor(tab));
  const counts = WORKER_TABS.map((_, i) =>
    i === 3 ? (saved?.length ?? 0) : i === 4 ? listings.length : (rows ?? []).filter((r) => r.bucket === bucketFor(i)).length,
  );
  useEffect(() => setLimit(DESK_PAGE), [tab]);

  const w = stats && stats.role === 'worker' ? stats : null;
  // No stats yet (or they failed), or no offers sent: a dash like the other tiles, not a made-up 0%.
  const success = w ? successPercent(w.quotesPlaced, w.quotesWon, counts[1]) : '–';

  // A pending quote opens back up for editing: price, pitch, hours, date.
  const editQuote = async (taskId?: string) => {
    if (!taskId) return;
    const task = await getTask(taskId).catch(() => null);
    if (!task) return flash('That request is no longer available');
    setBidTask(task);
  };
  const openWorkRow = (row: ViewRow) =>
    tab === 1 && row.state === 'PENDING' ? void editQuote(row.taskId) : openRow(row, { go, flash, setOpenTask, startedOf });

  const needItems = useMemo(
    () =>
      guest || !rows
        ? []
        : workerNeeds(rows, { dueOf: (id) => (id ? taskById.get(id)?.due_at : null), pendingOffers: counts[1] ?? 0, now: Date.now() }),
    // counts[1] is counted from rows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rows, taskById, guest],
  );
  const onNeed = (n: Need) => {
    if (n.kind === 'offers') return setTab(1);
    const row = (rows ?? []).find((r) => r.taskId === n.taskId && r.bucket === 1);
    if (row) openRow(row, { go, flash, setOpenTask, startedOf });
  };

  const unsave = async (id: string) => {
    try {
      if (guest) await setGuestSaved(id, false);
      else await setSaved(id, false);
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

  const refreshControl = <RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.purple} />;

  const portal = useDesktopHeaderPortal({ title: 'My work', right: <HeaderButton label="Offer a service" onPress={() => go('listing')} /> });

  const guestBlock = guest ? (
    // B175: no earnings, counts or tabs that read like an empty real account; the jobs saved on
    // this phone stay listed under the account block.
    <View style={{ paddingHorizontal: px }}>
      <GuestAccountCard
        icon="briefcase"
        heading="Your jobs need an account"
        body="Offers you send, jobs you win and what you earn show up here once your account is made."
      />
      <RNText style={tx('800', 15, t.colors.ink, { marginTop: 8 })}>Saved on this phone</RNText>
    </View>
  ) : null;

  const statsBlock = guest ? null : (
    <>
      <AlertsCard show={(rows?.length ?? 0) > 0} side="earn" />
      {/* Phone: the four tiles became the live line under the tab's name; the desktop keeps them. */}
      {desktop ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, paddingHorizontal: px, marginBottom: 20 }}>
          <StatTile icon="wallet" label="Earned" value={w ? formatINR(w.earnedMinor) : '–'} />
          <StatTile icon="check" label="Completed" value={String(w?.jobsDone ?? '–')} tone="blue" />
          <StatTile icon="play" label="Active" value={String(w?.jobsLive ?? '–')} tone="gold" />
          <StatTile icon="trending" label="Success" value={success} tone="purple" />
        </View>
      ) : null}
    </>
  );

  const titleRow = desktop ? null : (
    <TabTitle
      title="My work"
      live={guest ? null : myWorkLine({ earned: w ? formatINR(w.earnedMinor) : null, done: w ? w.jobsDone : null, active: w ? w.jobsLive : null, success })}
      action={
        <Pressable
          onPress={() => go('listing')}
          accessibilityRole="button"
          accessibilityLabel="Offer a service"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.btn, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 14, opacity: pressed ? 0.8 : 1 })}
        >
          <Icon name="plus" size={15} color={t.colors.onBtn} />
          <RNText style={tx('800', 13.5, t.colors.onBtn)}>Offer a service</RNText>
        </Pressable>
      }
    />
  );

  const needsCard = <NeedsNow items={needItems} onPick={onNeed} desktop={desktop} side="earn" />;

  // Saved and My services keep their cards on every size.
  const savedOrServices =
    tab === 4 ? (
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
          <Grid>
            {listings.map((task) => (
              <View key={task.id} style={{ marginTop: 12 }}>
                <ListingCard task={task} owner onPress={() => go('listing', { taskId: task.id })} />
              </View>
            ))}
          </Grid>
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
        <Grid>
          {(saved ?? []).map((task, i) => (
            <WorkCard
              key={task.id}
              task={task}
              index={i}
              saved={savedIds.has(task.id)}
              quoted={offers.has(task.id)}
              onOpen={() => go('taskDetail', { row: taskToFeedRow(task) })}
              onApply={() => setBidTask(task)}
              onToggleSave={() => void unsave(task.id)}
            />
          ))}
        </Grid>
      )
    ) : null;

  const emptyList =
    list.length === 0 ? (
      <EmptyState
        icon="briefcase"
        title={tab === 0 ? 'No active tasks' : tab === 1 ? 'No pending offers' : 'Nothing closed yet'}
        body={tab === 0 ? 'Pick tasks from Explore to start working and earning.' : undefined}
        actionLabel="Browse tasks"
        onAction={() => go('explore')}
      />
    ) : null;

  const cardFor = (row: ViewRow) => ({
    row,
    task: row.taskId ? (taskById.get(row.taskId) ?? null) : null,
    customer: row.taskId ? customers.get(row.taskId) : undefined,
    sentAt: row.taskId ? sentAt.get(row.taskId) : undefined,
    rates: fees,
    onOpen: () => openWorkRow(row),
  });

  const results = (
    <View style={{ paddingHorizontal: px, paddingTop: 4 }}>
      {rows === null ? (
        [0, 1].map((i) => <Shimmer key={i} height={90} style={{ marginTop: 12 }} />)
      ) : failed && rows.length === 0 ? (
        <LoadFailed onRetry={() => void refresh()} />
      ) : savedOrServices ? (
        savedOrServices
      ) : emptyList ? (
        emptyList
      ) : (
        <Grid>
          {list.map((row, i) => (
            <WorkerCard
              key={`${row.taskId}-${i}`}
              {...cardFor(row)}
              index={i}
              onChat={() => row.taskId && go('chat', { taskId: row.taskId, title: row.title })}
            />
          ))}
        </Grid>
      )}
    </View>
  );

  const isTable = tab <= 2 && rows !== null && !(failed && rows.length === 0) && !emptyList;
  const table = (
    <DeskTableCard
      columns={WORKER_COLUMNS}
      table={isTable}
      toolbarLeft={
        guest ? (
          <RNText style={tx('800', 15, t.colors.ink)}>Saved on this phone</RNText>
        ) : (
          <SegmentedTabs
            tabs={WORKER_TABS.map((x, i) => ({ key: x, label: x, count: rows === null ? undefined : counts[i] }))}
            value={WORKER_TABS[tab] ?? WORKER_TABS[0]}
            onChange={(k) => setTab(WORKER_TABS.indexOf(k))}
          />
        )
      }
      footer={isTable ? <TableFooter shown={Math.min(limit, list.length)} total={list.length} noun={WORKER_NOUN[tab]!} onMore={() => setLimit((n) => n + DESK_PAGE)} /> : null}
    >
      {isTable ? (
        list.slice(0, limit).map((row, i) => <WorkerDeskRow key={`${row.taskId}-${i}`} first={i === 0} {...cardFor(row)} />)
      ) : (
        <View style={{ paddingHorizontal: 20, paddingBottom: 20, paddingTop: 8 }}>{results}</View>
      )}
    </DeskTableCard>
  );

  return (
    <Screen padded={false}>
      <AppHeader />
      {titleRow}
      {portal}
      {desktop ? (
        <ListPage scrollProps={{ refreshControl, contentContainerStyle: LIST_SCROLL }}>
          {guest ? (
            <View style={{ marginBottom: 16 }}>
              <GuestAccountCard
                icon="briefcase"
                heading="Your jobs need an account"
                body="Offers you send, jobs you win and what you earn show up here once your account is made."
              />
            </View>
          ) : null}
          {statsBlock}
          {needsCard}
          {table}
        </ListPage>
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} refreshControl={refreshControl} stickyHeaderIndices={guest ? undefined : [3]}>
          <View>{guestBlock}</View>
          <View>{statsBlock}</View>
          <View>{needsCard}</View>
          {/* Sticky: the tab pills stay in view while the list scrolls (child 3). */}
          {guest ? null : (
            <View style={{ backgroundColor: t.colors.bg, paddingTop: 16, paddingBottom: 6 }}>
              <PillTabs tabs={WORKER_TABS.map((x, i) => (rows === null ? { label: x } : { label: x, count: counts[i] }))} active={tab} onPick={setTab} />
            </View>
          )}
          {results}
        </ScrollView>
      )}
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void refresh()} />
    </Screen>
  );
}
