import { useCallback, useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, TextInput, RefreshControl } from 'react-native';
import { Screen, cardSurface, formatINR } from '../components/ui';
import { HeroCard } from '../components/Hero';
import { AppHeader } from '../components/AppHeader';
import { Icon } from '../components/Icon';
import { BottomSheet, ConfirmDialog, EmptyState, Grid, LoadFailed, MenuRow, Pill, PillTabs, Shimmer, StatTile, SwipeTabs, rupees, timeAgo, timeLeft } from '../components/kit';
import { WorkCard, categoryIcon, categoryLabel } from '../components/WorkCard';
import { BidSheet } from '../components/BidSheet';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { descriptionPreview } from '../components/TaskDescription';
import { listDrafts, removeDraft, type PostDraft } from '../lib/drafts';
import { useTheme, ring } from '../providers/ThemeProvider';
import { useNav, useFocusTick } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp, useActions } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { GUEST_DRAFTS_OWNER } from '../lib/guest';
import { listGuestSaves, loadGuestSavedTasks, setGuestSaved } from '../lib/guestSaves';
import { GuestNote } from '../components/GuestBits';
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
import { AlertsCard } from '../components/AlertsCard';
import { taskToFeedRow } from '../lib/openTask';
import { useMyOffers } from '../lib/useMyOffers';

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

const STAGES = ['Posted', 'Offers', 'Hired', 'Working', 'Done'] as const;

/** How far along the 5-step track a task is (1-5); 0 for closed tasks, which show no track. */
function stageOf(task: Task, quotes: number): number {
  switch (task.status) {
    case 'OPEN':
      return quotes > 0 ? 2 : 1;
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

function MyPosted() {
  const t = useTheme();
  const { go } = useNav();
  const { flash } = useActions();
  const { userId, guest } = useAuth();
  // A guest's drafts wait on this phone under one shared owner until the account is made.
  const draftOwner = userId ?? (guest ? GUEST_DRAFTS_OWNER : null);
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
  // True when the last load failed (offline, server hiccup): an empty list is then
  // "could not load", not "you have no tasks".
  const [failed, setFailed] = useState(false);
  // Half-written posts kept on this device (see lib/drafts).
  const [drafts, setDrafts] = useState<PostDraft[]>([]);
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

  const refresh = async () => {
    setRefreshing(true);
    await loadOrFail();
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
        {guest ? (
          <View style={{ paddingHorizontal: 20 }}>
            <GuestNote />
          </View>
        ) : null}
        {/* One summary card rather than four tiles: what is running, what is
            waiting on me, what is done. Spending lives in Wallet → Insights. */}
        <View style={{ paddingHorizontal: 20, paddingTop: 8 }}>
          <HeroCard radius={24} padding={20} watermark={false} ringSize={180}>
            <RNText style={tx('700', 12.5, 'rgba(255,255,255,0.82)')}>Your tasks at a glance</RNText>
            <View style={{ flexDirection: 'row', marginTop: 12 }}>
              {[
                { value: (counts[0] ?? 0) + (counts[1] ?? 0), label: 'Active' },
                { value: reviewCount, label: 'To review' },
                { value: counts[2] ?? 0, label: 'Completed' },
              ].map((m, i) => (
                <View key={m.label} style={{ flex: 1, borderLeftWidth: i ? 1 : 0, borderLeftColor: 'rgba(255,255,255,0.15)', paddingLeft: i ? 14 : 0 }}>
                  <RNText style={tx('800', 30, '#FFFFFF', { letterSpacing: -0.6, fontVariant: ['tabular-nums'] })}>{m.value}</RNText>
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
                  backgroundColor: 'rgba(255,255,255,0.16)',
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
          </HeroCard>
        </View>
        <AlertsCard show={(tasks?.length ?? 0) > 0} side="hire" />

        <View {...ring}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            marginHorizontal: 20,
            marginTop: 16,
            ...cardSurface(t, 16),
            paddingHorizontal: 14,
          }}
        >
          <Icon name="search" size={17} color={t.colors.muted} />
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

        {drafts.length > 0 ? (
          <View style={{ paddingHorizontal: 20, marginTop: 16, gap: 8 }}>
            <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>DRAFTS · {drafts.length}</RNText>
            {drafts.map((d) => (
              <View key={d.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, ...cardSurface(t, 16), paddingLeft: 14, paddingRight: 8 }}>
                <Pressable
                  onPress={() => go('aiPost', { prompt: d.prompt, draftId: d.id })}
                  accessibilityRole="button"
                  accessibilityLabel={`Continue draft: ${d.prompt}`}
                  style={{ flex: 1, paddingVertical: 12 }}
                >
                  <RNText numberOfLines={2} style={tx('600', 14, t.colors.ink, { lineHeight: 20 })}>{d.prompt}</RNText>
                  <RNText style={tx('500', 12, t.colors.accentDeep, { marginTop: 3 })}>Continue · {timeAgo(new Date(d.savedAt).toISOString())}</RNText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (!draftOwner) return;
                    setDrafts((cur) => cur.filter((x) => x.id !== d.id));
                    void removeDraft(draftOwner, d.id);
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
          ) : shown.length === 0 && failed ? (
            <LoadFailed onRetry={() => void refresh()} />
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
                onClose={() => setConfirmClose(task)}
                onAgain={() => go('aiPost', { similar: task })}
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
  onClose,
  onAgain,
}: {
  task: Task;
  index: number;
  quotes: number;
  /** A worker's own service listing: no quotes, no "needs providers". */
  service?: boolean;
  onOpen: () => void;
  onMenu: () => void;
  /** Opens the close-task confirm dialog (the same path as the menu's "Close task"). */
  onClose: () => void;
  /** Starts a new post from this one ("Create similar"). */
  onAgain: () => void;
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

  // The date has passed: said calmly, in gold, never as a red "overdue".
  const datePassed = !service && (task.status === 'OVERDUE' || (task.status === 'OPEN' && !!task.due_at && new Date(task.due_at).getTime() < Date.now()));
  const stage = service ? 0 : stageOf(task, quotes);
  const done = task.status === 'COMPLETED' || task.status === 'AUTO_COMPLETED';
  const toneInkOf = { accent: t.colors.accentDeep, gold: t.colors.goldInk, signal: t.colors.signalDeep, blue: t.colors.blue, neutral: t.colors.muted } as const;
  const topLine = datePassed ? (quotes > 0 ? 'THE DATE HAS PASSED' : 'THE DATE HAS PASSED · NO ONE PICKED IT') : badge.label.toUpperCase();
  const topInk = datePassed ? t.colors.goldInk : toneInkOf[badge.tone];

  // The one thing the poster should do next, as a big button at the foot of the card.
  const nextLabel: string | null = service
    ? null
    : done
      ? 'Book again'
      : task.status === 'OPEN'
        ? quotes > 0
          ? 'Choose an offer'
          : 'Open'
        : task.status === 'LOCKED' && !task.funded_at
          ? 'Pay to start'
          : task.status === 'WORK_DONE'
            ? 'Review the work'
            : task.status === 'LOCKED' || task.status === 'TASK_STARTED' || task.status === 'REVISION_REQUESTED'
              ? 'Track'
              : 'Open';
  const bigButton = (label: string, onPress: () => void, quiet = false) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${task.title}`}
      style={({ pressed }) => ({
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        paddingVertical: 13,
        borderRadius: 14,
        backgroundColor: quiet ? t.colors.surface2 : t.colors.btn,
        borderWidth: quiet ? 1 : 0,
        borderColor: t.colors.line,
        transform: [{ scale: pressed ? 0.98 : 1 }],
      })}
    >
      <RNText style={tx('800', 14, quiet ? t.colors.ink : t.colors.onBtn)}>{label}</RNText>
    </Pressable>
  );

  return (
    <FadeIn duration={340} delay={Math.min(index, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
      <Pressy
        containsControls
        onPress={onOpen}
        scaleTo={0.985}
        style={[cardSurface(t, 20), { overflow: 'hidden' }]}
      >
        <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 4, backgroundColor: stripe }} />
        <View style={{ flexDirection: 'row', gap: 12, padding: 14, paddingLeft: 16 }}>
          <View style={{ width: 44, height: 44, borderRadius: 14, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={categoryIcon(task.category)} size={21} color={t.colors.accentDeep} strokeWidth={1.8} />
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <RNText style={tx('800', 10.5, topInk, { letterSpacing: 1.2, flexShrink: 1 })} numberOfLines={1}>{topLine}</RNText>
              <RNText style={tx('600', 11, t.colors.muted, { flexShrink: 1 })} numberOfLines={1}>
                · {categoryLabel(task)}
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
        {stage > 0 ? (
          <View style={{ paddingHorizontal: 16, paddingBottom: 12 }} accessible accessibilityLabel={`Step ${stage} of 5: ${STAGES[stage - 1]}`}>
            <View style={{ flexDirection: 'row', gap: 4 }}>
              {STAGES.map((name, k) => (
                <View key={name} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: k < stage ? t.colors.accent : t.colors.line }} />
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 4, marginTop: 5 }}>
              {STAGES.map((name, k) => (
                <RNText key={name} numberOfLines={1} style={tx(k === stage - 1 ? '800' : '500', 10, k === stage - 1 ? t.colors.ink : t.colors.muted, { flex: 1 })}>
                  {name}
                </RNText>
              ))}
            </View>
          </View>
        ) : null}
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
          <RNText style={tx('800', 17, t.colors.ink, { fontVariant: ['tabular-nums'], letterSpacing: -0.3 })}>{rupees((task.locked_minor ?? task.benchmark_minor) / 100)}</RNText>
          {left && !datePassed ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="clock" size={12} color={t.colors.goldInk} />
              <RNText style={tx('600', 11.5, t.colors.goldInk)}>{left}</RNText>
            </View>
          ) : null}
          {task.funded_at && task.status !== 'COMPLETED' && task.status !== 'AUTO_COMPLETED' ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
              <Icon name="lock" size={12} color={t.colors.accentDeep} />
              <RNText style={tx('600', 11.5, t.colors.accentDeep)}>Held safely</RNText>
            </View>
          ) : null}
        </View>
        {nextLabel ? (
          <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingVertical: 12, borderTopWidth: 1, borderTopColor: t.colors.line }}>
            {datePassed && task.status === 'OPEN' ? (
              // There is no date edit yet, so a passed date offers a fresh post (or the offers that came in) and Close.
              <>
                {quotes > 0 ? bigButton('Choose an offer', onOpen) : bigButton('Post again', onAgain)}
                {bigButton('Close', onClose, true)}
              </>
            ) : datePassed ? (
              bigButton('Open', onOpen)
            ) : done ? (
              bigButton(nextLabel, onAgain)
            ) : (
              bigButton(nextLabel, onOpen)
            )}
          </View>
        ) : null}
      </Pressy>
    </FadeIn>
  );
}

// --------------------------------------------------------------- worker -----

// "Closed", not "Done": it also holds offers the customer did not pick, which are not completed jobs.
const WORKER_TABS = ['Active', 'Offers', 'Closed', 'Saved', 'My services'] as const;

function MyWork() {
  const t = useTheme();
  const { go } = useNav();
  const { flash, setOpenTask, startedOf } = useApp();
  const { userId, guest } = useAuth();
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
  const [failed, setFailed] = useState(false);
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

  return (
    <Screen padded={false}>
      <AppHeader />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: 32 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.purple} />}
      >
        {guest ? (
          <View style={{ paddingHorizontal: 20 }}>
            <GuestNote />
          </View>
        ) : null}
        <AlertsCard show={(rows?.length ?? 0) > 0} side="earn" />
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
          ) : failed && rows.length === 0 ? (
            <LoadFailed onRetry={() => void refresh()} />
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
          ) : list.length === 0 ? (
            <EmptyState
              icon="briefcase"
              title={tab === 0 ? 'No active tasks' : tab === 1 ? 'No pending offers' : 'Nothing closed yet'}
              body={tab === 0 ? 'Pick tasks from Explore to start working and earning.' : undefined}
              actionLabel="Browse tasks"
              onAction={() => go('explore')}
            />
          ) : (
            <Grid>
            {list.map((row, i) => (
              <FadeIn key={`${row.taskId}-${i}`} duration={320} delay={Math.min(i, 6) * 60} translateY={8} style={{ marginTop: 12 }}>
                <Pressy
                  onPress={() =>
                    tab === 1 && row.state === 'PENDING' ? void editQuote(row.taskId) : openRow(row, { go, flash, setOpenTask, startedOf })
                  }
                  scaleTo={0.985}
                  style={{ ...cardSurface(t, 18), padding: 14 }}
                >
                  <RNText style={tx('700', 10, toneInk(row.tone, t.colors), { letterSpacing: 1.4 })}>{row.state}</RNText>
                  <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, marginTop: 7 }}>
                    <RNText style={tx('700', 15, t.colors.ink, { flex: 1 })} numberOfLines={2}>{row.title}</RNText>
                    <RNText style={tx('800', 15, t.colors.ink)}>{row.priceLabel}</RNText>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 5 }}>
                    <RNText style={tx('400', 12, t.colors.muted, { flex: 1 })}>{row.meta}</RNText>
                    {tab === 1 && row.state === 'PENDING' ? <RNText style={tx('700', 12, t.colors.accentDeep)}>Edit offer ›</RNText> : null}
                  </View>
                </Pressy>
              </FadeIn>
            ))}
            </Grid>
          )}
        </View>
      </ScrollView>
      <BidSheet task={bidTask} visible={bidTask !== null} onClose={() => setBidTask(null)} onPlaced={() => void refresh()} />
    </Screen>
  );
}
