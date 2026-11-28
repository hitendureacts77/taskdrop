import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { Avatar, Screen, cardSurface } from '../components/ui';
import { EmptyState, Shimmer, TopBar, timeAgo } from '../components/kit';
import { Icon } from '../components/Icon';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { myRegulars, type Regular } from '../data/api';
import { useLayout } from '../lib/layout';
import { RowCard } from '../components/RowCard';
import { CONTENT_INSET } from '../navigation/DesktopPage';
import { useActions } from '../providers/AppStateProvider';
import { NotifyHelperSheet, type NotifyHelper } from '../components/NotifyHelperSheet';

/**
 * The people this poster hired for finished jobs (Regulars, migration 134):
 * notify one about a task (owner, 27 Nov 2026: it replaced "Book again"). They get one notification
 * with the link; the task stays open to everyone and nothing is reserved for them.
 */
export function RegularsScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const { desktop } = useLayout();
  const { flash } = useActions();
  const [list, setList] = useState<Regular[] | null>(null);
  const [notify, setNotify] = useState<NotifyHelper | null>(null);
  const sheet = <NotifyHelperSheet helper={notify} onClose={() => setNotify(null)} flash={flash} />;

  useEffect(() => {
    let alive = true;
    void myRegulars().then((r) => alive && setList(r));
    return () => {
      alive = false;
    };
  }, []);

  // Desktop: the regulars are rows on one centred card, "Notify about a task" at the right end of each row.
  if (desktop && list !== null && list.length > 0) {
    return (
      <Screen padded={false}>
        <TopBar title="My regulars" subtitle="People you liked working with, one tap away" onBack={back} />
        <ScrollView contentContainerStyle={{ paddingTop: 8, paddingBottom: 28, paddingHorizontal: CONTENT_INSET }}>
          <RowCard>
            {list.map((r) => (
              <View key={r.profile.id} style={{ padding: 16 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                  <Pressable
                    onPress={() => go('publicProfile', { userId: r.profile.id, role: 'worker' })}
                    accessibilityRole="button"
                    accessibilityLabel={`${r.profile.display_name}, open profile`}
                    style={{ flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 }}
                  >
                    <Avatar name={r.profile.display_name} size={48} />
                    <View style={{ flex: 1 }}>
                      <RNText style={tx('800', 15, t.colors.ink)}>{r.profile.display_name}</RNText>
                      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                        {r.jobs} job{r.jobs === 1 ? '' : 's'} with you
                        {r.categories.length ? ` · ${r.categories.slice(0, 2).join(', ')}` : ''}
                        {r.lastAt ? ` · ${timeAgo(r.lastAt)}` : ''}
                      </RNText>
                    </View>
                    <Icon name="heart" size={18} color={t.colors.signal} />
                  </Pressable>
                  <Pressable
                    onPress={() => setNotify({ id: r.profile.id, name: r.profile.display_name })}
                    accessibilityRole="button"
                    accessibilityLabel={`Notify ${r.profile.display_name} about a task`}
                    style={({ pressed }) => ({
                      minWidth: 160,
                      paddingHorizontal: 24,
                      height: 42,
                      borderRadius: 999,
                      backgroundColor: t.colors.accentSoft,
                      alignItems: 'center',
                      justifyContent: 'center',
                      opacity: pressed ? 0.8 : 1,
                    })}
                  >
                    <RNText style={tx('800', 13, t.colors.accentDeep)}>Notify about a task</RNText>
                  </Pressable>
                </View>
                <RNText style={tx('400', 11, t.colors.muted, { marginTop: 8, marginLeft: 60 })}>
                  They get a notification with the link. Your task stays open to everyone.
                </RNText>
              </View>
            ))}
          </RowCard>
        </ScrollView>
        {sheet}
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <TopBar title="My regulars" subtitle="People you liked working with, one tap away" onBack={back} />
      <ScrollView
        contentContainerStyle={
          desktop
            ? { paddingHorizontal: CONTENT_INSET, paddingBottom: 28 }
            : { paddingHorizontal: 20, paddingBottom: 28, width: '100%', maxWidth: 680, alignSelf: 'center' }
        }
      >
        {list === null ? (
          <Shimmer height={120} />
        ) : list.length === 0 ? (
          <EmptyState
            icon="heart"
            title="No regulars yet"
            body="Everyone you hire for a finished job shows up here, so you can tell them about your next task."
            actionLabel="Post a task"
            onAction={() => go('aiPost')}
          />
        ) : (
          list.map((r, i) => (
            <FadeIn key={r.profile.id} translateY={10} delay={Math.min(i, t.motion.staggerMax) * t.motion.stagger}>
              <View style={{ ...cardSurface(t, 18), padding: 15, marginTop: 12 }}>
                <Pressable
                  onPress={() => go('publicProfile', { userId: r.profile.id, role: 'worker' })}
                  accessibilityRole="button"
                  accessibilityLabel={`${r.profile.display_name}, open profile`}
                  style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}
                >
                  <Avatar name={r.profile.display_name} size={48} />
                  <View style={{ flex: 1 }}>
                    <RNText style={tx('800', 15, t.colors.ink)}>{r.profile.display_name}</RNText>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })} numberOfLines={1}>
                      {r.jobs} job{r.jobs === 1 ? '' : 's'} with you
                      {r.categories.length ? ` · ${r.categories.slice(0, 2).join(', ')}` : ''}
                      {r.lastAt ? ` · ${timeAgo(r.lastAt)}` : ''}
                    </RNText>
                  </View>
                  <Icon name="heart" size={18} color={t.colors.signal} />
                </Pressable>
                <Pressable
                  onPress={() => setNotify({ id: r.profile.id, name: r.profile.display_name })}
                  accessibilityRole="button"
                  accessibilityLabel={`Notify ${r.profile.display_name} about a task`}
                  style={({ pressed }) => ({
                    marginTop: 12,
                    height: 42,
                    borderRadius: 999,
                    backgroundColor: t.colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: pressed ? 0.8 : 1,
                  })}
                >
                  <RNText style={tx('800', 13, t.colors.accentDeep)}>Notify about a task</RNText>
                </Pressable>
                <RNText style={tx('400', 11, t.colors.muted, { marginTop: 8, textAlign: 'center' })}>
                  They get a notification with the link. Your task stays open to everyone.
                </RNText>
              </View>
            </FadeIn>
          ))
        )}
      </ScrollView>
      {sheet}
    </Screen>
  );
}
