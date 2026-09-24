import { useEffect, useMemo, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, TextInput } from 'react-native';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { EmptyState, Shimmer, TopBar, timeAgo } from '../components/kit';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { listThreads, type Thread } from '../data/extras';

/**
 * Messages: every task conversation this person is in, newest first. A
 * thread opens on the task's own chat page, which is where replies happen.
 */
export function InboxScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const [threads, setThreads] = useState<Thread[] | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    listThreads()
      .then((r) => alive && setThreads(r))
      .catch(() => alive && setThreads([]));
    return () => {
      alive = false;
    };
  }, []);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!threads || !needle) return threads;
    return threads.filter((x) => (x.title + ' ' + x.lastBody).toLowerCase().includes(needle));
  }, [threads, q]);

  return (
    <Screen padded={false}>
      <TopBar title="Messages" subtitle="Open a thread to read and reply" onBack={back} />
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          marginHorizontal: 20,
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
          placeholder="Search tasks or messages"
          placeholderTextColor={t.colors.muted}
          style={tx('400', 14, t.colors.ink, { flex: 1, paddingVertical: 11 })}
        />
      </View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}>
        {shown === null ? (
          [0, 1, 2].map((i) => <Shimmer key={i} height={64} style={{ marginTop: 12 }} />)
        ) : shown.length === 0 ? (
          <EmptyState
            icon="chat"
            title="No messages yet"
            body="Threads appear here when you chat with someone about a task."
          />
        ) : (
          shown.map((th, i) => (
            <FadeIn key={th.taskId} duration={280} delay={Math.min(i, 8) * 30}>
              <Pressable
                onPress={() => go('chat', { taskId: th.taskId, title: th.title })}
                accessibilityRole="button"
                style={({ pressed }) => ({
                  flexDirection: 'row',
                  gap: 12,
                  alignItems: 'center',
                  paddingVertical: 13,
                  borderBottomWidth: 1,
                  borderBottomColor: t.colors.line,
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
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })} numberOfLines={1}>
                    {th.lastFromMe ? 'You: ' : ''}
                    {th.lastBody}
                  </RNText>
                </View>
              </Pressable>
            </FadeIn>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
