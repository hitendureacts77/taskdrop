import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, RefreshControl } from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import {
  Badge,
  BottomSheet,
  EmptyState,
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
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import {
  cancelTask,
  getTaskDetail,
  listBidsForTask,
  refundEscrow,
  type Bid,
  type Profile,
  type TaskDetail,
} from '../data/api';
import { openRow, posterRow } from '../lib/taskRows';
import { statusBadge } from './MyTasksScreen';
import { formatDeadline } from '../components/DateTimeSheet';
import { FEES } from '@taskdrop/rules';

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
  const { flash, setOpenTask, startedOf } = useApp();
  const taskId = typeof params.taskId === 'string' ? params.taskId : null;
  const [detail, setDetail] = useState<TaskDetail | null | undefined>(undefined);
  const [bids, setBids] = useState<(Bid & { profiles: Profile | null })[]>([]);
  const [tab, setTab] = useState(0);
  const [menu, setMenu] = useState(false);
  const [closing, setClosing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

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
    ...(assignment ? [{ at: assignment.created_at, title: 'Quote accepted', body: worker?.display_name ? `${worker.display_name} was picked` : undefined, icon: 'check' as IconName }] : []),
    ...(task.funded_at ? [{ at: task.funded_at, title: 'Escrow funded', body: formatINR(escrow) + ' held safely', icon: 'lock' as IconName }] : []),
    ...(task.started_at ? [{ at: task.started_at, title: 'Work started', icon: 'play' as IconName }] : []),
    ...(task.work_done_at ? [{ at: task.work_done_at, title: 'Work submitted', body: 'Review it and release the payment', icon: 'flag' as IconName }] : []),
    ...(task.completed_at ? [{ at: task.completed_at, title: 'Completed', body: 'Payment released to the worker', icon: 'trophy' as IconName }] : []),
    ...(task.status === 'CANCELLED' ? [{ at: task.updated_at, title: 'Task closed', icon: 'close' as IconName }] : []),
    ...(task.status === 'DISPUTED' ? [{ at: task.updated_at, title: 'Dispute opened', body: 'Our team is looking at it', icon: 'gavel' as IconName }] : []),
  ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());

  const primary: { label: string; onPress: () => void } | null =
    row.act === 'compare'
      ? { label: bids.length ? `Compare ${bids.length} quote${bids.length === 1 ? '' : 's'}` : 'Waiting for quotes', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
      : row.act === 'pay'
        ? { label: `Pay ${formatINR(escrow)} into escrow`, onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
        : row.act === 'confirm'
          ? { label: 'Review the work and release', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
          : row.act === 'active'
            ? { label: 'Track the work', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
            : row.act === 'review'
              ? { label: 'Rate the worker', onPress: () => openRow(row, { go, flash, setOpenTask, startedOf }) }
              : null;

  const close = async () => {
    setClosing(true);
    try {
      await cancelTask(task.id);
      setMenu(false);
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
        <Badge label={task.assignment_mode === 'auto' ? 'Auto-accept' : 'Bid-based'} tone="neutral" />
      </View>
      <View style={{ marginTop: 10 }}>
        <UnderlineTabs tabs={['Overview', 'Work']} active={tab} onPick={setTab} />
      </View>

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
              <RNText style={tx('400', 13, t.colors.text, { marginTop: 10, lineHeight: 20 })}>{task.description || '—'}</RNText>
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
                  <RNText style={tx('800', 15, t.colors.ink)}>Milestones ({milestones.length})</RNText>
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
              {detailRow('Quotes', String(bids.length))}
              {detailRow('Budget', rupees(task.benchmark_minor / 100))}
              {task.locked_minor ? detailRow('Accepted quote', rupees(task.locked_minor / 100)) : null}
              {detailRow(
                'Your escrow',
                task.funded_at ? `${formatINR(escrow)} held` : assignment ? `${formatINR(escrow)} due` : 'Paid when you accept a quote',
              )}
              {task.due_at ? detailRow('Target date', formatDeadline(new Date(task.due_at)) + (left ? ` · ${left}` : '')) : null}
              {detailRow('Category', categoryLabel(task))}
              {task.difficulty ? detailRow('Difficulty', task.difficulty.charAt(0).toUpperCase() + task.difficulty.slice(1)) : null}
              {detailRow('Assignment', task.assignment_mode === 'auto' ? 'Auto-accept' : 'Review bids')}
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
                <EmptyState icon="users" title="No quotes yet" body="Workers nearby will see your task. You’ll get a notification when a quote comes in." />
              ) : (
                bids.slice(0, 5).map((b, i) => (
                  <FadeIn key={b.id} duration={300} delay={i * 50}>
                    <View style={card}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <RNText style={tx('700', 14, t.colors.ink, { flex: 1 })}>{b.profiles?.display_name ?? 'Worker'}</RNText>
                        <RNText style={tx('800', 16, t.colors.accentDeep)}>{rupees(b.price_minor / 100)}</RNText>
                      </View>
                      {b.message ? (
                        <RNText style={tx('400', 12, t.colors.text, { marginTop: 6, lineHeight: 18 })} numberOfLines={4}>{b.message}</RNText>
                      ) : null}
                      <RNText style={tx('400', 11, t.colors.muted, { marginTop: 6 })}>
                        {b.profiles && b.profiles.worker_rating_count > 0 ? `★ ${Number(b.profiles.worker_rating_avg).toFixed(1)} · ` : ''}
                        {timeAgo(b.created_at)}
                      </RNText>
                    </View>
                  </FadeIn>
                ))
              )
            ) : !worker ? (
              <EmptyState icon="briefcase" title="No one is on this task" />
            ) : null}
          </>
        )}
      </ScrollView>

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
          <MenuRow icon="close" label={closing ? 'Closing…' : 'Close task'} sub="Escrow, if paid, is refunded minus any fine" danger onPress={() => void close()} />
        ) : null}
      </BottomSheet>
    </Screen>
  );
}
