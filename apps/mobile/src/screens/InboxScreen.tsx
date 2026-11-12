import { useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, TextInput } from 'react-native';
import { Screen, cardSurface } from '../components/ui';
import { Icon } from '../components/Icon';
import { EmptyState, LoadFailed, Shimmer, TopBar, timeAgo } from '../components/kit';
import { FadeIn, tx } from '../components/primitives';
import { useTheme, ring } from '../providers/ThemeProvider';
import { ScreenScope, useFocusTick, useNav } from '../providers/NavProvider';
import { useLayout } from '../lib/layout';
import { ChatScreen } from './ChatScreen';
import { listThreads, type Thread } from '../data/extras';
import { useAuth } from '../providers/AuthProvider';
import { GuestScreen } from '../components/GuestBits';
import { reportError } from '../lib/errors';

/**
 * Messages: every task conversation this person is in, newest first. A
 * thread opens on the task's own chat page, which is where replies happen.
 */
export function InboxScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { guest } = useAuth();
  const focusTick = useFocusTick();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  // True when the last load failed (offline, server hiccup): an empty list is then
  // "could not load", not "no messages".
  const [failed, setFailed] = useState(false);
  const [q, setQ] = useState('');
  // Desktop (W6): the inbox on the left and the open conversation beside it.
  // A phone keeps opening the conversation as its own page.
  const { desktop } = useLayout();
  const [openId, setOpenId] = useState<string | null>(null);
  // Bumped by "Try again" to run the load once more.
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    if (guest) return;
    let alive = true;
    listThreads()
      .then((r) => {
        if (!alive) return;
        setThreads(r);
        setFailed(false);
      })
      .catch((e) => {
        if (!alive) return;
        reportError(e, 'inbox.load');
        // Keep whatever is already on screen; with nothing yet, show the retry card.
        setThreads((prev) => prev ?? []);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [guest, focusTick, retry]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!threads || !needle) return threads;
    return threads.filter((x) => (x.title + ' ' + x.lastBody).toLowerCase().includes(needle));
  }, [threads, q]);

  const split = desktop && (threads?.length ?? 0) > 0;
  // Nothing opens until a thread is picked: opening one marks it read.
  const open = split ? (threads!.find((x) => x.taskId === openId) ?? null) : null;

  if (guest) {
    return (
      <GuestScreen
        title="Messages"
        reason="chat"
        icon="chat"
        heading="Messages need an account"
        body="Chats open once you hire someone, or someone hires you."
      />
    );
  }

  const list = (
    <>
      <TopBar title="Messages" subtitle="Open a thread to read and reply" onBack={back} />
      <View {...ring}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginHorizontal: 20,
          ...cardSurface(t, 14),
          paddingHorizontal: 12,
        }}
      >
        <Icon name="search" size={16} color={t.colors.muted} />
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder="Search tasks or messages"
          placeholderTextColor={t.colors.muted}
          style={tx('400', 14, t.colors.ink, { flex: 1, paddingVertical: 11 })}
        />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        {shown === null ? (
          [0, 1, 2].map((i) => <Shimmer key={i} height={64} style={{ marginTop: 12 }} />)
        ) : shown.length === 0 && failed && (threads?.length ?? 0) === 0 ? (
          <LoadFailed onRetry={() => setRetry((n) => n + 1)} />
        ) : shown.length === 0 && q.trim() ? (
          <EmptyState icon="search" title={`No matches for “${q.trim()}”`} body="Try a different word, or clear the search." />
        ) : shown.length === 0 ? (
          <EmptyState
            icon="chat"
            title="No messages yet"
            body="A conversation opens here as soon as you hire someone, or someone hires you."
          />
        ) : (
          shown.map((th, i) => (
            <FadeIn key={th.taskId} duration={280} delay={Math.min(i, 8) * 30}>
              <Pressable
                onPress={() => (split ? setOpenId(th.taskId) : go('chat', { taskId: th.taskId, title: th.title }))}
                accessibilityRole="button"
                accessibilityState={split ? { selected: open?.taskId === th.taskId } : undefined}
                style={({ pressed, hovered }: { pressed: boolean; hovered?: boolean }) => ({
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'center',
                  paddingVertical: 13,
                  paddingHorizontal: split ? 12 : 0,
                  borderRadius: split ? 16 : 0,
                  borderBottomWidth: split ? 0 : 1,
                  borderBottomColor: t.colors.line,
                  marginTop: split ? 4 : 0,
                  backgroundColor:
                    split && open?.taskId === th.taskId ? t.colors.accentSoft : split && hovered ? t.colors.surface2 : 'transparent',
                  opacity: pressed ? 0.7 : 1,
                })}
              >
                <View style={{ width: 42, height: 42, borderRadius: 999, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="chat" size={18} color={t.colors.accentDeep} />
                </View>
                <View style={{ flex: 1 }}>
                  <View style={{ flexDirection: 'row' }}>
                    <RNText style={tx('700', 14, t.colors.ink, { flex: 1 })} numberOfLines={1}>{th.title}</RNText>
                    <RNText style={tx('400', 11, t.colors.muted)}>{timeAgo(th.lastAt)}</RNText>
                  </View>
                  <RNText
                    style={tx(th.lastBody ? '400' : '600', 12, th.lastBody ? t.colors.muted : t.colors.accentDeep, { marginTop: 3 })}
                    numberOfLines={1}
                  >
                    {th.lastBody ? (th.lastFromMe ? 'You: ' : '') + th.lastBody : 'No messages yet · say hello'}
                  </RNText>
                </View>
              </Pressable>
            </FadeIn>
          ))
        )}
      </ScrollView>
    </>
  );

  if (split) {
    return (
      <Screen padded={false}>
        <View style={{ flex: 1, flexDirection: 'row' }}>
          <View style={{ width: 360, borderRightWidth: 1, borderRightColor: t.colors.line }}>{list}</View>
          <View style={{ flex: 1, minWidth: 0 }}>
            {open ? (
              <ScreenScope key={open.taskId} params={{ taskId: open.taskId, title: open.title }} focus={0}>
                <ChatScreen />
              </ScreenScope>
            ) : (
              <EmptyState icon="chat" title="Messages" body="Open a thread to read and reply" style={{ flex: 1, justifyContent: 'center' }} />
            )}
          </View>
        </View>
      </Screen>
    );
  }
  return <Screen padded={false}>{list}</Screen>;
}
