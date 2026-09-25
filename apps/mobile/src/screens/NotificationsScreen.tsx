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
import { useActions } from '../providers/AppStateProvider';
import {
  listNotifications,
  markNotificationsRead,
  subscribeToNotifications,
  type Notification,
} from '../data/extras';
import { getTask } from '../data/api';

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

// Which side of the marketplace a notification is about, so opening it puts
// the person in the right mode.
const POSTER_KINDS = new Set(['quote', 'started', 'submitted', 'auto_locked', 'reopened']);
const WORKER_KINDS = new Set(['picked', 'funded', 'revision', 'released']);

/**
 * Everything that has happened that needs this person. Rows are written by
 * database triggers (migration 048) when a quote arrives, a task changes
 * state, a message comes in or support replies -- so nothing here is made up
 * on the client.
 */
export function NotificationsScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { userId } = useAuth();
  const { setMode } = useMode();
  const { flash } = useActions();
  const [tab, setTab] = useState(0);
  const [rows, setRows] = useState<Notification[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => setRows(await listNotifications(80)), []);

  useEffect(() => {
    void load().catch(() => setRows([]));
  }, [load]);

  useEffect(() => {
    if (!userId) return;
    return subscribeToNotifications(userId, (n) => setRows((cur) => [n, ...(cur ?? [])]));
  }, [userId]);

  const refresh = async () => {
    setRefreshing(true);
    await load().catch(() => {});
    setRefreshing(false);
  };

  const unread = (rows ?? []).filter((r) => !r.read_at);
  const shown = tab === 0 ? unread : (rows ?? []);

  const markAll = async () => {
    try {
      await markNotificationsRead();
      const now = new Date().toISOString();
      setRows((cur) => (cur ?? []).map((r) => ({ ...r, read_at: r.read_at ?? now })));
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
    if (!n.task_id) return;
    if (n.kind === 'message') return go('chat', { taskId: n.task_id });
    if (POSTER_KINDS.has(n.kind)) {
      setMode('poster');
      return go('taskManage', { taskId: n.task_id });
    }
    if (WORKER_KINDS.has(n.kind)) setMode('worker');
    const task = await getTask(n.task_id).catch(() => null);
    if (!task) return flash('That task is no longer available');
    if (task.poster_id === userId) {
      setMode('poster');
      return go('taskManage', { taskId: task.id });
    }
    go('myTasks');
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
            body={tab === 0 ? 'You’re all caught up. New ones will appear here.' : 'Quotes, payments and messages show up here.'}
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
                  opacity: pressed ? 0.8 : 1,
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
