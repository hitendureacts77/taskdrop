import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, RefreshControl } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import {
  Badge,
  BottomSheet,
  ConfirmDialog,
  EmptyState,
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
import { useApp } from '../providers/AppStateProvider';
import {
  cancelTask,
  getTaskDetail,
  listBidsForTask,
  lockBid,
  refundEscrow,
  WalletShortError,
  type Bid,
  type Profile,
  type TaskDetail,
} from '../data/api';
import { openRow, posterRow } from '../lib/taskRows';
import { statusBadge } from './MyTasksScreen';
import { formatDeadline } from '../components/DateTimeSheet';
import { FEES } from '@taskdrop/rules';
import { AddFundsSheet } from '../components/AddFundsSheet';

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
  const t = useTheme();
  const { params, back, go } = useNav();
  const { flash, celebrate, setOpenTask, startedOf } = useApp();
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  const [detail, setDetail] = useState<TaskDetail | null | undefined>(undefined);
  const [bids, setBids] = useState<(Bid & { profiles: Profile | null })[]>([]);
  const [tab, setTab] = useState(0);
  const [menu, setMenu] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [quoteFilter, setQuoteFilter] = useState<QuoteFilter>('newest');
  const [selecting, setSelecting] = useState<{ bidId: string; name: string; priceMinor: number } | null>(null);
  const [locking, setLocking] = useState(false);
  // Set when the wallet cannot cover the chosen offer: exactly what is missing.
  const [shortBy, setShortBy] = useState<{ minor: number; pick: { bidId: string; name: string; priceMinor: number } } | null>(null);

  const load = useCallback(async () => {
    if (!taskId) return setDetail(null);
    const [d, b] = await Promise.all([getTaskDetail(taskId), listBidsForTask(taskId).catch(() => [])]);
    setDetail(d);
    setBids(b);
  }, [taskId]);

  useEffect(() => {
    void load().catch(() => setDetail(null));
  }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  };

  if (detail === undefined) {
    return (
      <Screen padded={false}>
        <TopBar title="Task" onBack={back} />
        <View style={{ paddingHorizontal: 20, gap: 12 }}>
          <Shimmer height={120} />
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
  const escrow = assignment?.escrow_minor ?? Math.round(base * (1 + FEES.POSTER_SERVICE_FEE_PCT));
  const left = timeLeft(task.due_at);

  const events: Event[] = [
    { at: task.created_at, title: 'Task created', body: `“${task.title}” was posted`, icon: 'plus' as IconName },
    ...bids.map((b) => ({
      at: b.created_at,
      title: `Quote received · ${rupees(b.price_minor / 100)}`,
      body: b.profiles?.display_name ? `from ${b.profiles.display_name}` : undefined,
      icon: 'tag' as IconName,
    })),
    ...(assignment ? [{ at: assignment.created_at, title: 'Offer accepted', body: worker?.display_name ? `${worker.display_name} was picked` : undefined, icon: 'check' as IconName }] : []),
    ...(task.funded_at ? [{ at: task.funded_at, title: 'Payment held safely', body: formatINR(escrow) + ' held safely', icon: 'lock' as IconName }] : []),
    ...(task.started_at ? [{ at: task.started_at, title: 'Work started', icon: 'play' as IconName }] : []),
    ...(task.work_done_at ? [{ at: task.work_done_at, title: 'Work submitted', body: 'Review it and release the payment', icon: 'flag' as IconName }] : []),
    ...(task.completed_at ? [{ at: task.completed_at, title: 'Completed', body: 'Payment released to the worker', icon: 'trophy' as IconName }] : []),
    ...(task.status === 'CANCELLED' ? [{ at: task.updated_at, title: 'Task closed', icon: 'close' as IconName }] : []),
    ...(task.status === 'DISPUTED' ? [{ at: task.updated_at, title: 'Problem reported', body: 'Our team is looking at it', icon: 'gavel' as IconName }] : []),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const primary: { label: string; onPress: () => void } | null =
    row.act === 'compare'
      ? { label: bids.length ? `Compare ${bids.length} offer${bids.length === 1 ? '' : 's'}` : 'Waiting for offers', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
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
  const lockPick = async (pick: { bidId: string; name: string; priceMinor: number }) => {
    if (locking) return;
    setLocking(true);
    try {
      await lockBid(pick.bidId);
      setSelecting(null);
      celebrate(`${pick.name} is hired · paid from your wallet`);
      await load().catch(() => {});
    } catch (e) {
      if (e instanceof WalletShortError) {
        setSelecting(null);
        setShortBy({ minor: e.shortMinor, pick });
      } else {
        flash(e instanceof Error ? e.message : 'Could not choose that offer');
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

  const card = { backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line, borderRadius: 14, padding: 15, marginTop: 12 } as const;
  const detailRow = (label: string, value: string) => (
    <View key={label} style={{ flexDirection: 'row', paddingVertical: 6 }}>
      <RNText style={tx('400', 13, t.colors.muted, { flex: 1 })}>{label}</RNText>
      <RNText style={tx('600', 13, t.colors.ink, { flexShrink: 1, textAlign: 'right' })} numberOfLines={2}>{value}</RNText>
    </View>
  );

  return (
    <Screen padded={false}>
      <TopBar
        title={task.title}
        onBack={back}
        right={
          <Pressable onPress={() => setMenu(true)} hitSlop={10} accessibilityRole="button" accessibilityLabel="Task options">
            <Icon name="dots" size={20} color={t.colors.ink} strokeWidth={2.4} />
          </Pressable>
        }
      />
      <View style={{ flexDirection: 'row', gap: 6, paddingHorizontal: 20, marginTop: -4 }}>
        <Badge label={badge.label} tone={badge.tone} />
        <Badge label={task.assignment_mode === 'auto' ? 'Auto-hire' : 'Choose from offers'} tone="neutral" />
      </View>
      <View style={{ marginTop: 10 }}>
        {/* While the task is open the second tab is where quotes land; once
            someone is hired it is where that worker is. */}
        <UnderlineTabs
          tabs={['Overview', task.status === 'OPEN' ? `Worker offers${bids.length ? ` (${bids.length})` : ''}` : 'Worker']}
          active={tab}
          onPick={setTab}
        />
      </View>

      <SwipeTabs index={tab} count={2} onChange={setTab}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />}
      >
        {tab === 0 ? (
          <>
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

            {milestones.length > 0 ? (
              <View style={card}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Icon name="flag" size={16} color={t.colors.purple} />
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
                task.funded_at ? `${formatINR(escrow)} held` : assignment ? `${formatINR(escrow)} due` : 'Paid when you accept an offer',
              )}
              {task.due_at ? detailRow('Target date', formatDeadline(new Date(task.due_at)) + (left ? ` · ${left}` : '')) : null}
              {detailRow('Category', categoryLabel(task))}
              {task.difficulty ? detailRow('Difficulty', task.difficulty.charAt(0).toUpperCase() + task.difficulty.slice(1)) : null}
              {detailRow('Assignment', task.assignment_mode === 'auto' ? 'Auto-hire' : 'See offers')}
              {detailRow('Location', task.loc_label ?? 'Not set')}
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
        ) : (
          <>
            {worker ? (
              <View style={card}>
                <RNText style={tx('600', 11, t.colors.muted, { letterSpacing: 1.2 })}>WORKER</RNText>
                <Pressable
                  onPress={() => go('publicProfile', { userId: worker.id })}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 10 }}
                  accessibilityRole="button"
                >
                  <View style={{ width: 42, height: 42, borderRadius: 999, backgroundColor: t.colors.purpleDeep, alignItems: 'center', justifyContent: 'center' }}>
                    <RNText style={tx('800', 16, '#FFFFFF')}>{worker.display_name.charAt(0).toUpperCase()}</RNText>
                  </View>
                  <View style={{ flex: 1 }}>
                    <RNText style={tx('700', 15, t.colors.ink)}>{worker.display_name}</RNText>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>
                      {worker.worker_rating_count > 0
                        ? `★ ${Number(worker.worker_rating_avg).toFixed(1)} · ${worker.worker_rating_count} reviews`
                        : 'New worker'}
                    </RNText>
                  </View>
                  <Icon name="chevronRight" size={16} color={t.colors.muted} />
                </Pressable>
                <Pressable
                  onPress={() => go('chat', { taskId: task.id, title: task.title })}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 14, borderWidth: 1, borderColor: t.colors.line, borderRadius: 12, paddingVertical: 11 }}
                  accessibilityRole="button"
                >
                  <Icon name="chat" size={16} color={t.colors.ink} />
                  <RNText style={tx('700', 14, t.colors.ink)}>Message</RNText>
                </Pressable>
              </View>
            ) : null}

            {task.status === 'OPEN' ? (
              bids.length === 0 ? (
                <EmptyState icon="users" title="No offers yet" body="Workers nearby will see your task. You’ll get a notification when an offer comes in." />
              ) : (
                <>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 14, lineHeight: 17 })}>
                    {bids.length === 1
                      ? 'One worker has sent an offer. Select it now, or wait for more.'
                      : `${bids.length} workers have sent offers. Filter them, then select the one you want.`}
                  </RNText>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ marginTop: 12, marginHorizontal: -20 }}
                    contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}
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
                    const name = who?.username ? '@' + who.username : (who?.display_name ?? 'Worker');
                    const diff = b.price_minor - task.benchmark_minor;
                    return (
                      <FadeIn key={b.id} duration={300} delay={Math.min(i, 6) * 50}>
                        <View style={card}>
                          <Pressable
                            onPress={() => who && go('publicProfile', { userId: who.id })}
                            accessibilityRole="button"
                            style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}
                          >
                            <View>
                              <View style={{ width: 40, height: 40, borderRadius: 999, backgroundColor: t.colors.purpleDeep, alignItems: 'center', justifyContent: 'center' }}>
                                <RNText style={tx('800', 15, '#FFFFFF')}>{(who?.display_name || '?').charAt(0).toUpperCase()}</RNText>
                              </View>
                              <AvatarPresence lastSeen={who?.last_seen_at} ring={t.colors.surface} />
                            </View>
                            <View style={{ flex: 1, minWidth: 0 }}>
                              <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>{name}</RNText>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
                                <RNText style={tx('600', 11, who && who.worker_rating_count > 0 ? t.colors.goldInk : t.colors.muted)}>
                                  {who && who.worker_rating_count > 0 ? `★ ${Number(who.worker_rating_avg).toFixed(1)} (${who.worker_rating_count})` : 'New worker'}
                                </RNText>
                                <PresenceLabel lastSeen={who?.last_seen_at} />
                              </View>
                            </View>
                            <View style={{ alignItems: 'flex-end' }}>
                              <RNText style={tx('800', 17, t.colors.ink)}>{rupees(b.price_minor / 100)}</RNText>
                              <RNText style={tx('600', 10, diff > 0 ? t.colors.goldInk : t.colors.accentDeep, { marginTop: 1 })}>
                                {diff === 0 ? 'Your budget' : diff > 0 ? `${rupees(diff / 100)} over budget` : `${rupees(-diff / 100)} under budget`}
                              </RNText>
                            </View>
                          </Pressable>
                          {b.message ? (
                            <View style={{ marginTop: 11, backgroundColor: t.colors.surface2, borderRadius: 10, padding: 11 }}>
                              <RNText style={tx('400', 13, t.colors.text, { lineHeight: 19 })} numberOfLines={4}>“{b.message}”</RNText>
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
                              onPress={() => setSelecting({ bidId: b.id, name, priceMinor: b.price_minor })}
                              accessibilityRole="button"
                              accessibilityLabel={`Select ${name}'s quote of ${rupees(b.price_minor / 100)}`}
                              style={({ pressed }) => ({
                                flexDirection: 'row',
                                alignItems: 'center',
                                gap: 6,
                                paddingVertical: 10,
                                paddingHorizontal: 16,
                                borderRadius: 999,
                                backgroundColor: t.colors.accent,
                                transform: [{ scale: pressed ? 0.96 : 1 }],
                              })}
                            >
                              <Icon name="check" size={14} color={t.colors.onAccent} strokeWidth={2.4} />
                              <RNText style={tx('800', 13, t.colors.onAccent)}>Choose this offer</RNText>
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
        )}
      </ScrollView>
      </SwipeTabs>

      {primary ? (
        <View style={{ paddingHorizontal: 20, paddingBottom: 16, paddingTop: 6 }}>
          <PrimaryButton label={primary.label} onPress={primary.onPress} disabled={row.act === 'compare' && bids.length === 0} />
        </View>
      ) : null}

      <BottomSheet visible={menu} onClose={() => setMenu(false)} title="Task options">
        <MenuRow icon="copy" label="Create similar" sub="Start a new post from this one" onPress={() => { setMenu(false); go('aiPost', { similar: task }); }} />
        {assignment ? (
          <MenuRow icon="chat" label="Message the worker" onPress={() => { setMenu(false); go('chat', { taskId: task.id, title: task.title }); }} />
        ) : null}
        {row.cancellable ? (
          <MenuRow
            icon="close"
            label="Close task"
            sub="Everything you paid comes back, fee included"
            danger
            onPress={() => {
              setMenu(false);
              setConfirmClose(true);
            }}
          />
        ) : null}
      </BottomSheet>

      <ConfirmDialog
        visible={confirmClose}
        danger
        icon="close"
        title="Close this task?"
        message={
          task.funded_at
            ? `“${task.title}” will be cancelled and the worker taken off it. Everything you paid, service fee included, goes back to your wallet. This can’t be undone.`
            : `“${task.title}” will be taken down and workers can no longer send offers for it. This can’t be undone.`
        }
        confirmLabel="Yes, close task"
        cancelLabel="Keep it"
        busy={closing}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() => void close()}
      />

      <ConfirmDialog
        visible={selecting !== null}
        icon="check"
        title={selecting ? `Select ${selecting.name}?` : ''}
        message={
          selecting
            ? `${rupees(Math.round(selecting.priceMinor * (1 + FEES.POSTER_SERVICE_FEE_PCT)) / 100)} (the offer plus the ${Math.round(FEES.POSTER_SERVICE_FEE_PCT * 100)}% service fee) is taken from your wallet and locked in this task until it is done. If the task is cancelled or not completed, all of it comes back. Phone numbers are shared once the work starts.`
            : ''
        }
        confirmLabel="Choose and pay from wallet"
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
