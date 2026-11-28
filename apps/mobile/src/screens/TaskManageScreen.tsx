import { useCallback, useEffect, useState } from 'react';
import { HoldLine } from '../components/HoldLine';
import { TaskPromotionResults } from '../components/PromotionResultsCard';
import { View, Text as RNText, ScrollView, Pressable, Platform, RefreshControl } from 'react-native';
import { Screen, formatINR, cardSurface } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import {
  Badge,
  BottomSheet,
  ConfirmDialog,
  EmptyState,
  IconButton,
  LoadFailed,
  SwipeTabs,
  MenuRow,
  PrimaryButton,
  Shimmer,
  TopBar,
  UnderlineTabs,
  rupees,
  timeAgo,
  timeLeft,
} from '../components/kit';
import { categoryLabel } from '../components/WorkCard';
import { TaskMediaThumb } from '../components/TaskMediaThumb';
import { FadeIn, tx } from '../components/primitives';
import { TaskDescription } from '../components/TaskDescription';
import { AvatarPresence, PresenceLabel } from '../components/PresenceDot';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { noteOffersSeen } from '../lib/seenOffersStore';
import { workersNear } from '../data/extras';
import { roughPlace } from '../lib/place';
import { taskShareItem } from '../lib/links';
import { ShareSheet, useShare } from '../components/ShareSheet';
import { countToldHelpers, toldLine, TOLD_LIMIT, TOLD_RADIUS_KM, type ToldHelpers } from '../lib/toldHelpers';
import { useApp } from '../providers/AppStateProvider';
import {
  cancelTask,
  getTaskDetail,
  isOfferChanged,
  offerChangedMessage,
  listBidsForTask,
  lockBid,
  refundEscrow,
  WalletShortError,
  type Bid,
  type Profile,
  setTaskDue,
  type TaskDetail,
} from '../data/api';
import { openRow, posterRow } from '../lib/taskRows';
import { statusBadge } from './MyTasksScreen';
import { useLayout } from '../lib/layout';
import { DateTimeSheet, formatDeadline } from '../components/DateTimeSheet';
import { messageWithoutTiming, offerTimingLine } from '../lib/offerTiming';
import { dueFor } from '../lib/taskBrief';
import { openDatePassed } from '../lib/myTasksBoard';
import { useFees } from '../lib/useFees';
import { saveTemplate } from '../lib/postTemplatesStore';
import { reportError } from '../lib/errors';
import { countOf } from '../lib/plural';
import { FEES, posterEscrowCharge } from '@taskdrop/rules';
import { closeTaskText, hireFineNote } from '../lib/closeTaskText';
import { KeepTaskSheet } from '../components/KeepTaskSheet';
import { TopUpSheet } from '../components/TopUpSheet';
import { AddFundsSheet } from '../components/AddFundsSheet';
import { useMoneyMode } from '../lib/useMoneyMode';
import { hireRefusal } from '../lib/moneyText';
import { TaskOptionsPanel } from '../components/TaskOptionsPanel';
import { TaskQuestions } from '../components/TaskQuestions';
import { HuntPosterPanel } from '../components/Hunt';
import { isHunt } from '../lib/hunt';
import { paymentLine, showAssignmentChip } from '../lib/taskStatusText';

type QuoteFilter = 'newest' | 'cheapest' | 'budget' | 'rated' | 'fastest';
const QUOTE_FILTERS: { key: QuoteFilter; label: string }[] = [
  { key: 'newest', label: 'Newest' },
  { key: 'cheapest', label: 'Lowest price' },
  { key: 'budget', label: 'Within budget' },
  { key: 'rated', label: 'Top rated' },
  { key: 'fastest', label: 'Fastest' },
];

type Milestone = { title: string; pct: number };
type Event = { at: string; title: string; body?: string; icon: IconName };

function milestonesOf(v: unknown): Milestone[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((m) => m as Partial<Milestone>)
    .filter((m): m is Milestone => typeof m.title === 'string' && typeof m.pct === 'number');
}

/**
 * One of my tasks, as its poster manages it: the overview (description,
 * milestones, what has happened, the details) and the work (quotes while it is
 * open, the worker once someone is on it). Every action routes into the
 * existing flows -- compare, escrow, active, confirm, review -- so the money
 * rules stay in the one place they already live.
 */
export function TaskManageScreen() {
  const fees = useFees();
  const { planB } = useMoneyMode();
  const t = useTheme();
  const { twoPane, desktop } = useLayout();
  const { params, back, go } = useNav();
  const { flash, celebrate, setOpenTask, startedOf } = useApp();
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  // Opened straight after posting (AiPostScreen): the card leads with "Share your task" (task 128).
  const justPosted = params.posted === true || params.posted === '1';
  const { userId } = useAuth();
  const [detail, setDetail] = useState<TaskDetail | null | undefined>(undefined);
  const [bids, setBids] = useState<(Bid & { profiles: Profile | null })[]>([]);
  // 'offers' in the address (My tasks, the new-offer alert) opens the Worker offers tab straight away.
  const [tab, setTab] = useState(params.tab === 'offers' ? 1 : 0);
  const share = useShare(flash);
  // Who can see this new task: a real count of helpers nearby who do its kind of work; null until known.
  const [told, setTold] = useState<ToldHelpers | null>(null);
  const [menu, setMenu] = useState(false);
  const [closing, setClosing] = useState(false);
  const [keepIt, setKeepIt] = useState(false);
  const [topUp, setTopUp] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  // The date picker for an open post (plan 1.19 J): a new date, or no fixed date.
  const [dateOpen, setDateOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  // The first load failed (not the same as a task that does not exist).
  const [loadFailed, setLoadFailed] = useState(false);
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>('newest');
  const [selecting, setSelecting] = useState<{ bidId: string; name: string; priceMinor: number; dueAt?: string | null; newDate?: string } | null>(null);
  const [locking, setLocking] = useState(false);
  // Set when the wallet cannot cover the chosen offer: exactly what is missing.
  const [shortBy, setShortBy] = useState<{ minor: number; pick: { bidId: string; name: string; priceMinor: number; dueAt?: string | null } } | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return setDetail(null);
    // Both or neither: an offers list that quietly failed would read as "no offers yet".
    const [d, b] = await Promise.all([getTaskDetail(taskId), listBidsForTask(taskId)]);
    setDetail(d);
    setBids(b);
    setLoadFailed(false);
    // These offers are now seen on this device: My tasks stops calling them new (lib/seenOffers).
    if (userId) void noteOffersSeen(userId, taskId, b.length);
  }, [taskId, userId]);

  useEffect(() => {
    void load().catch((e) => {
      reportError(e, 'task-manage');
      setLoadFailed(true);
    });
  }, [load]);

  // Right after posting: how many helpers nearby do this kind of work (the same list the map shows). Read once
  // per task; a failure just leaves the line out, never a made-up number.
  const openTask = detail?.task ?? null;
  const toldFor = openTask && openTask.status === 'OPEN' && openTask.kind !== 'service' ? openTask : null;
  const toldId = toldFor?.id ?? null;
  const toldLat = toldFor?.loc_lat ?? null;
  const toldLng = toldFor?.loc_lng ?? null;
  const toldCategory = toldFor?.category ?? null;
  useEffect(() => {
    setTold(null);
    if (!toldId || toldLat == null || toldLng == null) return;
    let live = true;
    workersNear({ lat: toldLat, lng: toldLng }, TOLD_RADIUS_KM, TOLD_LIMIT)
      .then((list) => { if (live) setTold(countToldHelpers(list, toldCategory)); })
      .catch(() => {});
    return () => { live = false; };
  }, [toldId, toldLat, toldLng, toldCategory]);

  const refresh = async () => {
    setRefreshing(true);
    await load().catch((e) => {
      reportError(e, 'task-manage');
      flash('Couldn’t refresh. Pull down to try again.');
    });
    setRefreshing(false);
  };

  if (detail === undefined && loadFailed) {
    return (
      <Screen padded={false}>
        <TopBar title="Task" onBack={back} />
        <LoadFailed
          title="Couldn’t load this task"
          onRetry={() => {
            setLoadFailed(false);
            void load().catch((e) => {
              reportError(e, 'task-manage');
              setLoadFailed(true);
            });
          }}
        />
      </Screen>
    );
  }
  if (detail === undefined) {
    return (
      <Screen padded={false}>
        {/* Desktop: the title is the page header's, so the page does not repeat it. */}
        <TopBar title={desktop && typeof params.title === 'string' && params.title ? params.title : 'Task'} onBack={back} />
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          {/* The row you tapped already told us the title: show it now rather than a grey box. */}
          {typeof params.title === 'string' && params.title ? (
            desktop ? null : <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.6 })}>{params.title}</RNText>
          ) : (
            <Shimmer height={60} />
          )}
          <Shimmer height={200} />
        </View>
      </Screen>
    );
  }
  if (detail === null) {
    return (
      <Screen padded={false}>
        <TopBar title="Task" onBack={back} />
        <EmptyState icon="list" title="This task could not be found" body="It may have been removed." />
      </Screen>
    );
  }

  const { task, assignment, worker } = detail;
  const badge = statusBadge(task);
  const row = posterRow(task, bids.length);
  const milestones = milestonesOf(task.milestones);
  const base = task.locked_minor ?? task.benchmark_minor;
  const escrow = assignment?.escrow_minor ?? posterEscrowCharge(base, fees.posterFee);
  const left = timeLeft(task.due_at);
  // City Hunt (D19): while it is open the page is the Hunt's finds, not offers.
  const hunting = isHunt(task) && task.status === 'OPEN';

  const events: Event[] = [
    { at: task.created_at, title: 'Task created', body: `“${task.title}” was posted`, icon: 'plus' as IconName },
    ...bids.map((b) => ({
      at: b.created_at,
      title: `Offer received · ${rupees(b.price_minor / 100)}`,
      body: b.profiles?.display_name ? `from ${b.profiles.display_name}` : undefined,
      icon: 'tag' as IconName,
    })),
    ...(assignment ? [{ at: assignment.created_at, title: 'Offer accepted', body: worker?.display_name ? `${worker.display_name} was picked` : undefined, icon: 'check' as IconName }] : []),
    ...(task.funded_at ? [{ at: task.funded_at, title: 'Payment held safely', body: formatINR(escrow) + ' held safely', icon: 'lock' as IconName }] : []),
    ...(task.started_at ? [{ at: task.started_at, title: 'Work started', icon: 'play' as IconName }] : []),
    ...(task.work_done_at ? [{ at: task.work_done_at, title: 'Work submitted', body: 'Review it and release the payment', icon: 'flag' as IconName }] : []),
    // A closed task also carries completed_at; only an approved one paid anybody.
    ...(task.completed_at && (task.status === 'COMPLETED' || task.status === 'AUTO_COMPLETED') ? [{ at: task.completed_at, title: 'Completed', body: 'Payment released to the worker', icon: 'trophy' as IconName }] : []),
    ...(task.status === 'CANCELLED' ? [{ at: task.updated_at, title: 'Task closed', icon: 'close' as IconName }] : []),
    ...(task.status === 'DISPUTED' ? [{ at: task.updated_at, title: 'Problem reported', body: 'Our team is looking at it', icon: 'gavel' as IconName }] : []),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  // The fine rate the server has now (the admin can change it), else the built-in one.
  const cancelPct = fees.cancelFine ?? FEES.POST_START_CANCEL_PENALTY_PCT;
  const fineOf = (lockedMinor: number) => Math.round(lockedMinor * cancelPct);

  // W2-3: once the worker has started, closing costs the fine; the menu and dialog say so.
  const closeWords = closeTaskText({
    title: task.title,
    status: task.status,
    funded: Boolean(task.funded_at),
    fineMinor: fineOf(task.locked_minor ?? 0),
    finePct: Math.round(cancelPct * 100),
    money: formatINR,
    refundTo: planB || (task.funded_via ?? 'wallet') !== 'wallet' ? 'source' : 'wallet',
  });

  const primary: { label: string; onPress: () => void } | null =
    row.act === 'compare'
      ? { label: bids.length === 1 ? 'Review the offer' : bids.length ? `Compare ${bids.length} offers` : 'Waiting for offers', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
      : row.act === 'pay'
        ? { label: `Pay ${formatINR(escrow)} now`, onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
        : row.act === 'confirm'
          ? { label: 'Review the work and release', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
          : row.act === 'active'
            ? { label: 'Track the work', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
            : row.act === 'review'
              ? { label: 'Rate the worker', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
              : null;

  // Choosing an offer pays for it from the wallet in the same step. A wallet
  // that is short opens a top-up for exactly the difference, and the offer is
  // chosen by itself once that money lands.
  const lockPick = async (pick: { bidId: string; name: string; priceMinor: number; dueAt?: string | null }) => {
    if (locking) return;
    setLocking(true);
    try {
      // The price and finish date shown are the ones hired on: a changed offer is refused (B53, 227).
      await lockBid(pick.bidId, 'one_time', pick.priceMinor, pick.dueAt);
      setSelecting(null);
      if (planB) {
        // Pay per task: hired, now pay for this one task.
        celebrate(`${pick.name} is hired`);
        go('escrow', { taskId: task.id, title: task.title, who: pick.name, priceMinor: pick.priceMinor });
        return;
      }
      celebrate(`${pick.name} is hired · paid from your wallet`);
      // The hire went through; if the screen cannot refresh now, the next pull-down will.
      await load().catch((e) => reportError(e, 'task-manage'));
    } catch (e) {
      if (e instanceof WalletShortError && !planB) {
        setSelecting(null);
        setShortBy({ minor: e.shortMinor, pick });
      } else if (isOfferChanged(e)) {
        setSelecting(null);
        setShortBy(null);
        flash(offerChangedMessage(e));
        await load().catch((err) => reportError(err, 'task-manage'));
      } else {
        flash(e instanceof Error ? hireRefusal(e.message) : 'Could not choose that offer');
      }
    } finally {
      setLocking(false);
    }
  };
  const lockSelected = () => (selecting ? lockPick(selecting) : undefined);

  const visibleBids = bids
    .filter((b) => (quoteFilter === 'budget' ? b.price_minor <= task.benchmark_minor : true))
    .sort((a, b) => {
      if (quoteFilter === 'cheapest' || quoteFilter === 'budget') return a.price_minor - b.price_minor;
      if (quoteFilter === 'rated') {
        return Number(b.profiles?.worker_rating_avg ?? 0) - Number(a.profiles?.worker_rating_avg ?? 0);
      }
      if (quoteFilter === 'fastest') return a.time_limit_minutes - b.time_limit_minutes;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  const close = async () => {
    setClosing(true);
    try {
      await cancelTask(task.id);
      setConfirmClose(false);
      flash(planB && task.funded_at ? 'Your refund has started. It goes back to the card or UPI you paid with.' : 'Task closed');
      // Show it closed now: the refund below can take several seconds (round 7, P1-19).
      setDetail((d) => (d ? { ...d, task: { ...d.task, status: 'CANCELLED' } } : d));
      void load().catch((e) => reportError(e, 'task-manage'));
      try {
        const out = await refundEscrow(task.id);
        if (!planB && out.refundedMinor > 0) flash(formatINR(out.refundedMinor) + ' is on its way back to you');
      } catch {
        flash('Closed. Your refund is being processed — it can take a few days.');
      }
      // The task is closed; if the screen cannot refresh now, the next pull-down will.
      await load().catch((e) => reportError(e, 'task-manage'));
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not close that task');
    } finally {
      setClosing(false);
    }
  };

  // A new date on an open post, or none (open-ended): the date is just a plan, the task stays open (plan 1.19 J).
  const changeDate = async (at: Date | null) => {
    setDateOpen(false);
    try {
      const out = await setTaskDue(task.id, at ? at.toISOString() : null);
      const dueAt = out?.due_at ?? (at ? at.toISOString() : null);
      setDetail((d) => (d ? { ...d, task: { ...d.task, due_at: dueAt, due_lapsed_at: null } } : d));
      flash(at ? `New date set: ${formatDeadline(at)}.` : 'No fixed date now. It stays open until you pick someone.');
      void load().catch((e) => reportError(e, 'task-manage'));
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not change the date');
    }
  };

  const card = { ...cardSurface(t, 18), padding: 15, marginTop: 12 } as const;
  const detailRow = (label: string, value: string) => (
    <View key={label} style={{ flexDirection: 'row', paddingVertical: 6 }}>
      <RNText style={tx('400', 13, t.colors.muted, { flex: 1 })}>{label}</RNText>
      <RNText style={tx('600', 13, t.colors.ink, { flexShrink: 1, textAlign: 'right' })} numberOfLines={2}>{value}</RNText>
    </View>
  );

  // Wide desktop (W4): Overview and the offers side by side, each under its
  // own heading, in place of the tabs, once the column has room for two panes
  // (lib/layout.ts). Narrower screens keep the tabs.
  const sideBySide = twoPane;
  const offersLabel = task.status === 'OPEN' ? `Worker offers${bids.length ? ` (${bids.length})` : ''}` : 'Worker';
  // An open post whose date passed with nobody picked: it is open with no fixed date now (plan 1.19 J).
  const datePassed = openDatePassed(task, Date.now());
  const lapsedAt = task.due_lapsed_at ?? (datePassed ? task.due_at : null);
  // The task's public link with its title and rough area, never the exact address (task 128).
  const shareTask = () => share.start(taskShareItem(task));
  // After posting: who can see the task, and a way to share it (Hire jade green). Opened straight from
  // posting (AiPostScreen passes posted), it says so and makes sharing the main button (task 128).
  const toldCard =
    task.status === 'OPEN' && !hunting && bids.length === 0 && task.kind !== 'service' ? (
      <View style={{ ...card, backgroundColor: t.colors.accentSoft, borderColor: t.colors.accentBorder }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name={justPosted ? 'check' : 'users'} size={16} color={t.colors.accentDeep} />
          <RNText style={tx('800', 15, t.colors.accentDeep, { flex: 1 })}>{justPosted ? 'Your task is posted' : 'Waiting for offers'}</RNText>
        </View>
        <RNText style={tx('500', 13, t.colors.text, { marginTop: 6, lineHeight: 19 })}>
          {task.loc_lat == null
            ? 'This task is remote, so helpers anywhere can see it. Share it to bring offers in faster.'
            : told
              ? toldLine(told, (roughPlace(task.loc_label) ?? '').split(',')[0] || null, task.category)
              : 'Helpers nearby can see your task. We will tell you as soon as an offer comes in.'}
        </RNText>
        {justPosted ? (
          <RNText style={tx('500', 13, t.colors.text, { marginTop: 6, lineHeight: 19 })}>
            Share its link on WhatsApp, Instagram or anywhere to get offers faster.
          </RNText>
        ) : null}
        <View style={{ flexDirection: 'row', marginTop: 12 }}>
          <PrimaryButton
            label={justPosted ? 'Share your task' : 'Share this task'}
            tone={justPosted ? undefined : 'quiet'}
            onPress={shareTask}
          />
        </View>
      </View>
    ) : null;
  const overview = (
    <>
      {twoPane ? null : toldCard}
      <HoldLine taskId={task.id} />
      <TaskPromotionResults taskId={task.id} />
      {datePassed ? (
        <View style={{ ...card, backgroundColor: t.colors.goldSoft, borderColor: t.colors.goldSoft }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="clock" size={16} color={t.colors.goldInk} />
            <RNText style={tx('800', 15, t.colors.goldInk, { flex: 1 })}>Your date passed: still open</RNText>
          </View>
          <RNText style={tx('500', 13, t.colors.goldInk, { marginTop: 6, lineHeight: 19 })}>
            {`Nobody was picked${lapsedAt ? ` by ${formatDeadline(new Date(lapsedAt))}` : ''}, so the task now has no fixed date. Helpers can still offer and say when they can finish.`}
          </RNText>
          <View style={{ flexDirection: 'row', marginTop: 12 }}>
            <PrimaryButton label="Set a new date" tone="quiet" onPress={() => setDateOpen(true)} />
          </View>
        </View>
      ) : null}
      <View style={card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="list" size={16} color={t.colors.accentDeep} />
          <RNText style={tx('800', 15, t.colors.ink)}>Task description</RNText>
        </View>
        <View style={{ marginTop: 12 }}>
          <TaskDescription text={task.description} title={task.title} size="sm" />
        </View>
        {task.media_path ? (
          <View style={{ marginTop: 12 }}>
            <TaskMediaThumb
              path={task.media_path}
              kind={task.media_kind === 'video' ? 'video' : 'image'}
              seconds={task.media_seconds}
              size={84}
            />
          </View>
        ) : null}
      </View>

      <TaskOptionsPanel task={task} onChanged={() => void load().catch((e) => reportError(e, 'task-manage'))} />

      {milestones.length > 0 ? (
        <View style={card}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Icon name="flag" size={16} color={t.colors.accent} />
            <RNText style={tx('800', 15, t.colors.ink)}>Steps ({milestones.length})</RNText>
          </View>
          {milestones.map((m, i) => (
            <View key={m.title} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 10, backgroundColor: t.colors.surface2, borderRadius: 10, padding: 11 }}>
              <RNText style={tx('600', 13, t.colors.ink, { flex: 1 })}>{i + 1}. {m.title}</RNText>
              <RNText style={tx('700', 12, t.colors.accentDeep)}>{rupees((base / 100) * (m.pct / 100))}</RNText>
            </View>
          ))}
        </View>
      ) : null}

      <TaskQuestions taskId={task.id} role="answer" style={{ padding: 15, marginTop: 12 }} />

      <View style={card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Icon name="trending" size={16} color={t.colors.accentDeep} />
          <RNText style={tx('800', 15, t.colors.ink)}>Activity timeline</RNText>
        </View>
        {events.map((e, i) => (
          <FadeIn key={e.title + e.at} duration={300} delay={i * 40}>
            <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
              <View style={{ alignItems: 'center' }}>
                <View style={{ width: 26, height: 26, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={e.icon} size={13} color={t.colors.accentDeep} strokeWidth={2} />
                </View>
                {i < events.length - 1 ? <View style={{ width: 1, flex: 1, backgroundColor: t.colors.line, marginTop: 3 }} /> : null}
              </View>
              <View style={{ flex: 1, paddingBottom: 2 }}>
                <View style={{ flexDirection: 'row' }}>
                  <RNText style={tx('700', 13, t.colors.ink, { flex: 1 })}>{e.title}</RNText>
                  <RNText style={tx('400', 11, t.colors.muted)}>{timeAgo(e.at)}</RNText>
                </View>
                {e.body ? <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>{e.body}</RNText> : null}
              </View>
            </View>
          </FadeIn>
        ))}
      </View>

      <View style={card}>
        <RNText style={tx('800', 15, t.colors.ink, { marginBottom: 4 })}>Task details</RNText>
        {detailRow('Offers', String(bids.length))}
        {detailRow('Budget', rupees(task.benchmark_minor / 100))}
        {task.locked_minor ? detailRow('Accepted offer', rupees(task.locked_minor / 100)) : null}
        {detailRow(
          'Your payment',
          paymentLine(task, !!assignment, formatINR(escrow)),
        )}
        {task.due_at
          ? detailRow('Closes by', formatDeadline(new Date(task.due_at)) + (left ? ` · ${left}` : ''))
          : detailRow('Closes by', 'No fixed date · open task')}
        {detailRow('Category', categoryLabel(task))}
        {task.difficulty ? detailRow('Difficulty', task.difficulty.charAt(0).toUpperCase() + task.difficulty.slice(1)) : null}
        {detailRow('Assignment', task.assignment_mode === 'auto' ? 'Auto-hire' : 'See offers')}
        {detailRow('Location', detail?.address ?? task.loc_label ?? 'Not set')}
        {(task.skills ?? []).length > 0 ? (
          <View style={{ marginTop: 8 }}>
            <RNText style={tx('400', 13, t.colors.muted)}>Skills required</RNText>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 7 }}>
              {task.skills.map((s) => (
                <View key={s} style={{ borderWidth: 1, borderColor: t.colors.line, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 3 }}>
                  <RNText style={tx('600', 11, t.colors.text)}>{s}</RNText>
                </View>
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </>
  );
  const offers = (
    <>
      {worker ? (
        <View style={card}>
          <RNText style={tx('600', 11, t.colors.muted, { letterSpacing: 1.2 })}>WORKER</RNText>
          <Pressable
            onPress={() => go('publicProfile', { userId: worker.id })}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}
            accessibilityRole="button"
          >
            <View style={{ width: 42, height: 42, borderRadius: 999, backgroundColor: t.colors.purpleFill, alignItems: 'center', justifyContent: 'center' }}>
              <RNText style={tx('800', 16, '#FFFFFF')}>{worker.display_name.charAt(0).toUpperCase()}</RNText>
            </View>
            <View style={{ flex: 1 }}>
              <RNText style={tx('700', 15, t.colors.ink)}>{worker.display_name}</RNText>
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                {worker.worker_rating_count > 0
                  ? `★ ${Number(worker.worker_rating_avg).toFixed(1)} · ${countOf(worker.worker_rating_count, 'review')}`
                  : 'New worker'}
              </RNText>
            </View>
            <Icon name="chevronRight" size={16} color={t.colors.muted} />
          </Pressable>
          <Pressable
            onPress={() => go('chat', { taskId: task.id, title: task.title })}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderWidth: 1.5, borderColor: t.colors.accentBorder, backgroundColor: t.colors.accentSoft, borderRadius: 999, minHeight: 46, transform: [{ scale: pressed ? 0.97 : 1 }] })}
            accessibilityRole="button"
          >
            <Icon name="chat" size={16} color={t.colors.accentDeep} />
            <RNText style={tx('700', 14, t.colors.accentDeep)}>Message</RNText>
          </Pressable>
        </View>
      ) : null}

      {task.status === 'OPEN' ? (
        bids.length === 0 ? (
          <>
          {toldCard}
          <EmptyState icon="users" title="No offers yet" body="You’ll get a notification when an offer comes in." />
        </>
        ) : (
          <>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 14, lineHeight: 17 })}>
              {bids.length === 1
                ? 'One worker has sent an offer. Select it now, or wait for more.'
                : `${bids.length} workers have sent offers. Filter them, then select the one you want.`}
            </RNText>
            {/* Desktop: the filters wrap inside the column instead of scrolling sideways (the last one was cut off). */}
            <ScrollView
              horizontal={!desktop}
              scrollEnabled={!desktop}
              showsHorizontalScrollIndicator={false}
              style={{ marginTop: 12, marginHorizontal: desktop ? 0 : -20, flexGrow: 0 }}
              contentContainerStyle={{ paddingHorizontal: desktop ? 0 : 20, gap: 8, ...(desktop ? { flexDirection: 'row', flexWrap: 'wrap' } : null) }}
            >
              {QUOTE_FILTERS.map((f) => {
                const on = quoteFilter === f.key;
                return (
                  <Pressable
                    key={f.key}
                    onPress={() => setQuoteFilter(f.key)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: on }}
                    style={({ pressed }) => ({
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                      paddingVertical: 8,
                      paddingHorizontal: 13,
                      borderRadius: 999,
                      backgroundColor: on ? t.colors.ink : t.colors.surface,
                      borderWidth: 1,
                      borderColor: on ? t.colors.ink : t.colors.line,
                      transform: [{ scale: pressed ? 0.95 : 1 }],
                    })}
                  >
                    {f.key === 'newest' ? <Icon name="filter" size={13} color={on ? t.colors.bg : t.colors.muted} /> : null}
                    <RNText style={tx('700', 12, on ? t.colors.bg : t.colors.ink)}>{f.label}</RNText>
                  </Pressable>
                );
              })}
            </ScrollView>
            {visibleBids.length === 0 ? (
              <View style={[card, { alignItems: 'center', paddingVertical: 22 }]}>
                <RNText style={tx('700', 14, t.colors.ink)}>No offers within your budget yet</RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, textAlign: 'center' })}>
                  Try another filter, or wait for more offers to come in.
                </RNText>
              </View>
            ) : null}
            {visibleBids.map((b, i) => {
              const who = b.profiles;
              const name = who?.display_name || (who?.username ? '@' + who.username : 'Worker');
              const diff = b.price_minor - task.benchmark_minor;
              // When they can finish (plan 1.19 J, 26 Nov): a date, hours, or more time than the customer's date.
              const timing = offerTimingLine(b as { proposed_due_at?: string | null; message?: string | null }, datePassed ? null : task.due_at, (d) => formatDeadline(d));
              const shownMessage = messageWithoutTiming(b.message);
              return (
                <FadeIn key={b.id} duration={300} delay={Math.min(i, 6) * 50}>
                  <View style={card}>
                    <Pressable
                      onPress={() => who && go('publicProfile', { userId: who.id })}
                      accessibilityRole="button"
                      style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}
                    >
                      <View>
                        <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.purpleFill, alignItems: 'center', justifyContent: 'center' }}>
                          <RNText style={tx('800', 15, '#FFFFFF')}>{(who?.display_name || '?').charAt(0).toUpperCase()}</RNText>
                        </View>
                        <AvatarPresence lastSeen={who?.last_seen_at} ring={t.colors.surface} />
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>{name}</RNText>
                        {who?.username && who.display_name ? (
                          <RNText style={tx('500', 11, t.colors.muted, { marginTop: 1 })} numberOfLines={1}>@{who.username}</RNText>
                        ) : null}
                        {/* Wraps: a long "Last seen 2 days ago" must drop to the next line, not run under the price. */}
                        <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', columnGap: 6, marginTop: 2 }}>
                          <RNText style={tx('600', 11, who && who.worker_rating_count > 0 ? t.colors.goldInk : t.colors.muted)}>
                            {who && who.worker_rating_count > 0 ? `★ ${Number(who.worker_rating_avg).toFixed(1)} (${who.worker_rating_count})` : 'New worker'}
                          </RNText>
                          <PresenceLabel lastSeen={who?.last_seen_at} />
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end', flexShrink: 0 }}>
                        <RNText style={tx('800', 17, t.colors.ink)}>{rupees(b.price_minor / 100)}</RNText>
                        <RNText style={tx('600', 10, diff > 0 ? t.colors.goldInk : t.colors.accentDeep, { marginTop: 1 })}>
                          {diff === 0 ? 'Your budget' : diff > 0 ? `${rupees(diff / 100)} over budget` : `${rupees(-diff / 100)} under budget`}
                        </RNText>
                      </View>
                    </Pressable>
                    {timing?.kind === 'more' ? (
                      <View style={{ marginTop: 10, borderLeftWidth: 3, borderLeftColor: t.colors.accent, paddingLeft: 10 }}>
                        <RNText style={tx('700', 12.5, t.colors.accentDeep)}>{timing.text}</RNText>
                        <RNText style={tx('500', 11.5, t.colors.muted, { marginTop: 2 })}>{timing.yours}</RNText>
                        {timing.reason ? (
                          <RNText style={tx('400', 12.5, t.colors.text, { marginTop: 4, lineHeight: 18 })}>“{timing.reason}”</RNText>
                        ) : null}
                      </View>
                    ) : timing ? (
                      <RNText style={tx('700', 12.5, t.colors.accentDeep, { marginTop: 10 })}>{timing.text}</RNText>
                    ) : null}
                    {shownMessage ? (
                      <View style={{ marginTop: 11, backgroundColor: t.colors.surface2, borderRadius: 10, padding: 11 }}>
                        <RNText style={tx('400', 13, t.colors.text, { lineHeight: 19 })} numberOfLines={4}>“{shownMessage}”</RNText>
                      </View>
                    ) : null}
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 12 }}>
                      <View style={{ flex: 1 }}>
                        <RNText style={tx('400', 11, t.colors.muted)}>Offered {timeAgo(b.created_at)}</RNText>
                        <RNText style={tx('600', 11, t.colors.text, { marginTop: 2 })}>
                          Done in ~{Math.max(1, Math.round(b.time_limit_minutes / 60))} hr{Math.round(b.time_limit_minutes / 60) === 1 ? '' : 's'}
                        </RNText>
                      </View>
                      <Pressable
                        onPress={() =>
                          setSelecting({
                            bidId: b.id,
                            name,
                            priceMinor: b.price_minor,
                            dueAt: (b as { proposed_due_at?: string | null }).proposed_due_at ?? null,
                            ...(timing?.kind === 'more' ? { newDate: timing.text.replace('Asks for more time: ', '') } : null),
                          })
                        }
                        accessibilityRole="button"
                        accessibilityLabel={`Select ${name}'s offer of ${rupees(b.price_minor / 100)}`}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 6,
                          paddingVertical: 10,
                          paddingHorizontal: 16,
                          borderRadius: 999,
                          backgroundColor: t.colors.btn,
                          transform: [{ scale: pressed ? 0.96 : 1 }],
                        })}
                      >
                        <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.4} />
                        <RNText style={tx('800', 13, t.colors.onAccent)}>{timing?.kind === 'more' ? 'Choose with the new date' : 'Choose this offer'}</RNText>
                      </Pressable>
                    </View>
                  </View>
                </FadeIn>
              );
            })}
          </>
        )
      ) : !worker ? (
        <EmptyState icon="briefcase" title="No one is on this task" />
      ) : null}
    </>
  );
  const colHead = (icon: IconName, label: string) => (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 18 }}>
      <Icon name={icon} size={17} color={t.colors.accentDeep} />
      <RNText style={tx('800', 16, t.colors.ink, { letterSpacing: -0.3 })}>{label}</RNText>
    </View>
  );

  return (
    <Screen padded={false}>
      <TopBar
        title={task.title}
        onBack={back}
        right={<IconButton icon="dots" label="Task options" onPress={() => setMenu(true)} />}
      />
      {/* On the web the chips tuck up under the in-page title; on a phone the title is the native header,
          and pulled up under it the chips' tops were cut off (P1-18). */}
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginTop: Platform.OS === 'web' ? -4 : 8 }}>
        <Badge label={badge.label} tone={badge.tone} />
        {isHunt(task) || showAssignmentChip(task.status) ? (
          <Badge
            label={isHunt(task) ? 'Hunt' : task.assignment_mode === 'auto' ? 'Auto-hire' : 'Choose from offers'}
            tone={isHunt(task) ? 'gold' : 'neutral'}
          />
        ) : null}
      </View>
      {sideBySide || hunting ? null : (
        <View style={{ marginTop: 10 }}>
          {/* While the task is open the second tab is where quotes land; once
              someone is hired it is where that worker is. */}
          <UnderlineTabs
            tabs={['Overview', task.status === 'OPEN' ? `Worker offers${bids.length ? ` (${bids.length})` : ''}` : 'Worker']}
            active={tab}
            onPick={setTab}
          />
        </View>
      )}

      {hunting ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />}
        >
          <HuntPosterPanel task={task} onChanged={() => void load().catch((e) => reportError(e, 'task-manage'))} />
          {overview}
        </ScrollView>
      ) : sideBySide ? (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />}
        >
          <View style={{ flexDirection: 'row', gap: 20, alignItems: 'flex-start' }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              {colHead('list', 'Overview')}
              {overview}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              {colHead('users', offersLabel)}
              {offers}
            </View>
          </View>
        </ScrollView>
      ) : (
        <SwipeTabs index={tab} count={2} onChange={setTab}>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />}
        >
          {tab === 0 ? overview : offers}
        </ScrollView>
        </SwipeTabs>
      )}

      {primary && !hunting ? (
        <View
          style={{
            paddingHorizontal: 20,
            paddingBottom: 16,
            paddingTop: 6,
            // Desktop: a button of its own width at the right, not one the width of the page.
            ...(desktop ? { alignItems: 'flex-end', borderTopWidth: 1, borderTopColor: t.colors.line, marginHorizontal: 20, paddingHorizontal: 0, paddingTop: 14 } : null),
          }}
        >
          <PrimaryButton
            label={primary.label}
            onPress={primary.onPress}
            disabled={row.act === 'compare' && bids.length === 0}
            style={desktop ? { minWidth: 260, paddingHorizontal: 32 } : undefined}
          />
        </View>
      ) : null}

      <DateTimeSheet
        visible={dateOpen}
        title="Close this task by"
        subtitle="Workers see this date on your post."
        confirmLabel="Set closing time"
        initial={task.due_at && new Date(task.due_at).getTime() > Date.now() ? new Date(task.due_at) : dueFor('2days')}
        onCancel={() => setDateOpen(false)}
        onConfirm={(d) => void changeDate(d)}
        onOpenEnded={() => void changeDate(null)}
        openEndedLabel={datePassed ? 'Keep no fixed date' : undefined}
      />
      <BottomSheet visible={menu} onClose={() => setMenu(false)} title="Task options">
        {task.status === 'OPEN' ? (
          <MenuRow icon="share" label="Share this task" sub="Post its link on WhatsApp, Instagram or anywhere" onPress={() => { setMenu(false); shareTask(); }} />
        ) : null}
        <MenuRow icon="copy" label="Create similar" sub="Start a new post from this one" onPress={() => { setMenu(false); go('aiPost', { similar: task }); }} />
        {userId ? (
          <MenuRow
            icon="bookmark"
            label="Save as template"
            sub="Start your next post from this one in one tap"
            onPress={() => {
              setMenu(false);
              void saveTemplate(userId, { title: task.title, description: task.description, category: task.category, budget: Math.round(task.benchmark_minor / 100) }).then((ok) =>
                flash(ok ? 'Saved. It shows under Your templates when you post.' : 'Couldn’t save the template. Try again.'),
              );
            }}
          />
        ) : null}
        {task.status === 'OPEN' ? (
          <MenuRow icon="calendar" label="Change the date" sub="A new date, or no fixed date" onPress={() => { setMenu(false); setDateOpen(true); }} />
        ) : null}
        {assignment ? (
          <MenuRow icon="chat" label="Message the worker" onPress={() => { setMenu(false); go('chat', { taskId: task.id, title: task.title }); }} />
        ) : null}
        {row.cancellable ? (
          <MenuRow
            icon="close"
            label="Delete task"
            sub={closeWords.sub}
            danger
            onPress={() => {
              setMenu(false);
              setKeepIt(true);
            }}
          />
        ) : null}
      </BottomSheet>

      <KeepTaskSheet
        task={keepIt ? task : null}
        hasWorker={Boolean(assignment)}
        flash={flash}
        onKeep={() => setKeepIt(false)}
        onDelete={() => { setKeepIt(false); setConfirmClose(true); }}
        onTopUp={() => setTopUp(true)}
        onSimilar={(k) => go('aiPost', { similar: k })}
        onMessage={(k) => go('chat', { taskId: k.id, title: k.title })}
      />
      <TopUpSheet
        task={topUp ? task : null}
        onClose={() => setTopUp(false)}
        flash={flash}
        onRaised={() => void load().catch((e) => reportError(e, 'task-manage'))}
      />

      <ConfirmDialog
        visible={confirmClose}
        danger
        icon="close"
        title="Delete this task?"
        message={closeWords.message}
        confirmLabel="Yes, delete"
        cancelLabel="Keep it"
        busy={closing}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => void close()}
      />

      <ShareSheet visible={share.open} item={share.item} onClose={share.close} flash={flash} />
      <ConfirmDialog
        visible={selecting !== null}
        icon="check"
        title={selecting ? `Select ${selecting.name}?` : ''}
        message={
          selecting
            ? `${formatINR(posterEscrowCharge(selecting.priceMinor, fees.posterFee))} (the offer plus the ${Math.round(fees.posterFee * 100)}% service fee) ${planB ? 'is paid by UPI or card when you hire, and Razorpay holds it until you approve the work.' : 'is taken from your wallet and locked in this task until it is done.'} ${hireFineNote({ fineMinor: fineOf(selecting.priceMinor), finePct: Math.round(cancelPct * 100), money: formatINR })} Phone numbers are shared once the work starts.${selecting.newDate ? ` The task's date moves to ${selecting.newDate}.` : ''}`
            : ''
        }
        confirmLabel={planB ? (selecting ? `Hire and pay ${formatINR(posterEscrowCharge(selecting.priceMinor, fees.posterFee))} by UPI or card` : 'Hire and pay') : 'Choose and pay from wallet'}
        busy={locking}
        onCancel={() => setSelecting(null)}
        onConfirm={() => void lockSelected()}
      />
      <AddFundsSheet
        visible={shortBy !== null}
        initialMinor={shortBy?.minor}
        reason={
          shortBy
            ? `Your wallet is ${formatINR(shortBy.minor)} short for ${shortBy.pick.name}’s offer. Add at least that much, and the offer is chosen as soon as the money arrives.`
            : undefined
        }
        onClose={() => setShortBy(null)}
        flash={flash}
        onFunded={() => {
          const pick = shortBy?.pick;
          setShortBy(null);
          if (pick) void lockPick(pick);
        }}
      />
    </Screen>
  );
}
