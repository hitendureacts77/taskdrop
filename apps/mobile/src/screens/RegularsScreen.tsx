import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { Avatar, Screen, cardSurface } from '../components/ui';
import { EmptyState, Shimmer, TopBar, timeAgo } from '../components/kit';
import { Icon } from '../components/Icon';
import { FadeIn, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { myRegulars, type Regular } from '../data/api';

/**
 * The people this poster hired for finished jobs (Regulars, migration 134):
 * book one again, and they get the first 10 minutes to send an offer.
 */
export function RegularsScreen() {
  const t = useTheme();
  const { back, go } = useNav();
  const [list, setList] = useState<Regular[] | null>(null);

  useEffect(() => {
    let alive = true;
    void myRegulars().then((r) => alive && setList(r));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Screen padded={false}>
      <TopBar title="My regulars" subtitle="People you liked working with, one tap away" onBack={back} />
      <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 28, width: '100%', maxWidth: 680, alignSelf: 'center' }}>
        {list === null ? (
          <Shimmer height={120} />
        ) : list.length === 0 ? (
          <EmptyState
            icon="heart"
            title="No regulars yet"
            body="Everyone you hire for a finished job shows up here, so you can book them again."
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
                      {r.lastAt ? ` · last ${timeAgo(r.lastAt)}` : ''}
                    </RNText>
                  </View>
                  <Icon name="heart" size={18} color={t.colors.signal} />
                </Pressable>
                <Pressable
                  onPress={() => go('aiPost', { preferWorker: { id: r.profile.id, name: r.profile.display_name } })}
                  accessibilityRole="button"
                  accessibilityLabel={`Book ${r.profile.display_name} again`}
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
                  <RNText style={tx('800', 13, t.colors.accentDeep)}>Book again</RNText>
                </Pressable>
                <RNText style={tx('400', 11, t.colors.muted, { marginTop: 8, textAlign: 'center' })}>
                  They get the first 10 minutes to send an offer, then everyone can.
                </RNText>
              </View>
            </FadeIn>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}
