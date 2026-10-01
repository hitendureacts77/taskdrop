import { useCallback, useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, RefreshControl } from 'react-native';
import { Screen } from '../components/ui';
import { Icon, type IconName } from '../components/Icon';
import { EmptyState, Shimmer, TopBar, UnderlineTabs, timeAgo } from '../components/kit';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import {
  listNotifications,
  markNotificationsRead,
  notificationSides,
  subscribeToNotifications,
  type Notification,
  type NotificationSide,
} from '../data/extras';
import { attachPosters, getTask, listMyAssignments } from '../data/api';
import { openPostedTask, openRow, workerAssignmentRow } from '../lib/taskRows';
import { taskToFeedRow } from '../lib/openTask';
import { useApp } from '../providers/AppStateProvider';

const ICON: Record<string, IconName> = {
  quote: 'tag',
  picked: 'check',
  funded: 'lock',
  started: 'play',
  submitted: 'flag',
  revision: 'refresh',
  released: 'wallet',
  cancelled: 'close',
  dispute: 'gavel',
  reopened: 'refresh',
  message: 'chat',
  support: 'help',
  referral: 'gift',
  auto_locked: 'bolt',
};


/**
 * Everything that has happened that needs this person. Rows are written by
 * database triggers (migration 048) when a quote arrives, a task changes
 * state, a message comes in or support replies -- so nothing here is made up
 * on the client.
 *
 * Each side sees its own alerts: in Earn, what happened on work you quoted on
 * or are doing; in Post, what happened on your requests. Tapping one opens
 * that post.
 */
export function NotificationsScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { userId } = useAuth();
  const { mode, setMode } = useMode();
  const { flash, setOpenTask, startedOf } = useApp();
  const [tab, setTab] = useState(0);
  const [all, setAll] = useState<Notification[] | null>(null);
  const [sides, setSides] = useState<Map<string, NotificationSide>>(new Map());
  const [opening, setOpening] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const list = await listNotifications(80);
    setSides(await notificationSides(list));
    setAll(list);
  }, []);

  useEffect(() => {
    void load().catch(() => setAll([]));
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    return subscribeToNotifications(userId, (n) => {
      void notificationSides([n]).then((m) => setSides((cur) => new Map([...cur, ...m])));
      setAll((cur) => [n, ...(cur ?? [])]);
    });
  }, [userId]);

  // Only this side's alerts (and the ones that belong to both).
  const rows = all === null ? null : all.filter((n) => {
    const side = sides.get(n.id) ?? 'both';
    return side === 'both' || side === mode;
  });
  const setRows = setAll;

  const refresh = async () => {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  };

  const unread = (rows ?? []).filter((r) => !r.read_at);
  const shown = tab === 0 ? unread : (rows ?? []);

  const markAll = async () => {
    try {
      // This side only: the other side's unread alerts stay unread.
      const ids = unread.map((r) => r.id);
      await markNotificationsRead(ids);
      const now = new Date().toISOString();
      setRows((cur) => (cur ?? []).map((r) => (ids.includes(r.id) ? { ...r, read_at: r.read_at ?? now } : r)));
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not mark them read');
    }
  };

  const open = async (n: Notification) => {
    if (!n.read_at) {
      void markNotificationsRead([n.id]).catch(() => {});
      setRows((cur) => (cur ?? []).map((r) => (r.id === n.id ? { ...r, read_at: new Date().toISOString() } : r)));
    }
    if (n.ticket_id) return go('ticket', { ticketId: n.ticket_id });
    if (n.kind === 'referral') return go('wallet');
    if (!n.task_id || !userId) return;
    if (n.kind === 'message') return go('chat', { taskId: n.task_id });
    setOpening(n.id);
    try {
      const task = await getTask(n.task_id).catch(() => null);
      if (!task) return flash('That task is no longer available');
      // Your own request: its page, with quotes, progress and the worker.
      if (task.poster_id === userId) {
        setMode('poster');
        return openPostedTask(task, go);
      }
      // Work you're doing: straight to where it stands (start, in progress,
      // waiting on approval...). Otherwise the post itself.
      setMode('worker');
      const mine = (await listMyAssignments(userId).catch(() => [])).find((a) => a.task_id === task.id);
      if (mine) return openRow(workerAssignmentRow(mine), { go, flash, setOpenTask, startedOf });
      const [withPoster] = await attachPosters([task]);
      go('taskDetail', { row: taskToFeedRow(withPoster!) });
    } finally {
      setOpening(null);
    }
  };

  return (
    <Screen padded={false}>
      <TopBar
        title="Notifications"
        onBack={back}
        right={
          unread.length > 0 ? (
            <Pressable onPress={() => void markAll()} hitSlop={8} accessibilityRole="button">
              <RNText style={tx('700', 13, t.colors.accentDeep)}>Mark all read</RNText>
            </Pressable>
          ) : undefined
        }
      />
      <RNText style={tx('500', 12, t.colors.muted, { paddingHorizontal: 20, marginBottom: 6 })}>
        {mode === 'worker' ? 'Alerts about work you sent an offer for or are doing' : 'Alerts about the tasks you posted'}
      </RNText>
      <UnderlineTabs tabs={[`Unread (${unread.length})`, 'All']} active={tab} onPick={setTab} />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={t.colors.accent} />}
      >
        {rows === null ? (
          [0, 1, 2].map((i) => <Shimmer key={i} height={64} style={{ marginTop: 12 }} />)
        ) : shown.length === 0 ? (
          <EmptyState
            icon="bell"
            title={tab === 0 ? 'No unread notifications' : 'No notifications yet'}
            body={tab === 0 ? 'You’re all caught up. New ones will appear here.' : 'Offers, payments and messages show up here.'}
          />
        ) : (
          shown.map((n, i) => (
            <FadeIn key={n.id} duration={280} delay={Math.min(i, 8) * 30}>
              <Pressable
                onPress={() => void open(n)}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: 12,
                  marginTop: 10,
                  padding: 13,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: n.read_at ? t.colors.line : t.colors.accentBorder,
                  backgroundColor: n.read_at ? t.colors.surface : t.colors.accentSoft,
                  opacity: pressed || opening === n.id ? 0.6 : 1,
                })}
              >
                <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={ICON[n.kind] ?? 'bell'} size={16} color={t.colors.accentDeep} strokeWidth={2} />
                </View>
                <View style={{ flex: 1 }}>
                  <RNText style={tx(n.read_at ? '600' : '800', 13, t.colors.ink)}>{n.title}</RNText>
                  {n.body ? (
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3, lineHeight: 17 })} numberOfLines={2}>
                      {n.body}
                    </RNText>
                  ) : null}
                  <RNText style={tx('400', 11, t.colors.muted, { marginTop: 5 })}>{timeAgo(n.created_at)}</RNText>
                </View>
                {!n.read_at ? <View style={{ width: 8, height: 8, borderRadius: 999, backgroundColor: t.colors.accent, marginTop: 4 }} /> : null}
              </Pressable>
            </FadeIn>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
