import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable, Animated } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import type { Profile } from '../data/api';
import { listLiveWorkers } from '../data/extras';
import { SectionTitle } from './kit';
import { tx } from './primitives';

const REFRESH_MS = 60_000;

/**
 * "Available now": workers who marked themselves available and are free for an instant task.
 *
 * Re-read every minute while it is on screen, so someone whose window ran out
 * drops off rather than sitting there looking available. Hidden entirely when
 * nobody is live -- an empty "Live now" row says nothing useful.
 */
export function LiveWorkers({ active }: { active: boolean }) {
  const t = useTheme();
  const { go } = useNav();
  const [workers, setWorkers] = useState<Profile[]>([]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () => void listLiveWorkers().then((w) => alive && setWorkers(w));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);

  // The pulsing dot next to the heading.
  const pulse = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 0.3, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  if (workers.length === 0) return null;

  return (
    <View style={{ marginTop: 24 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Animated.View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: t.colors.accent, opacity: pulse }} />
        <SectionTitle title="Available now" style={{ flex: 1 }} badge={`${workers.length} free`} />
      </View>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>
        Workers free right now for an instant task
      </RNText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -20 }}>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>
          {workers.map((w) => {
            const mins = Math.max(1, Math.round((new Date(w.live_until!).getTime() - Date.now()) / 60000));
            const name = w.username ? '@' + w.username : w.display_name;
            return (
              <Pressable
                key={w.id}
                onPress={() => go('publicProfile', { userId: w.id })}
                accessibilityRole="button"
                accessibilityLabel={`${name}, live for ${mins} more minutes`}
                style={({ pressed }) => ({
                  width: 136,
                  alignItems: 'center',
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: t.colors.accentBorder,
                  borderRadius: 14,
                  padding: 12,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <View>
                  <View
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 999,
                      backgroundColor: t.colors.purpleDeep,
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <RNText style={tx('800', 19, '#FFFFFF')}>{(w.display_name || '?').trim().charAt(0).toUpperCase()}</RNText>
                  </View>
                  <View
                    style={{
                      position: 'absolute',
                      right: 0,
                      bottom: 0,
                      width: 13,
                      height: 13,
                      borderRadius: 999,
                      backgroundColor: t.colors.accent,
                      borderWidth: 2,
                      borderColor: t.colors.surface,
                    }}
                  />
                </View>
                <RNText style={tx('700', 12, t.colors.ink, { marginTop: 8 })} numberOfLines={1}>
                  {name}
                </RNText>
                <RNText style={tx('500', 11, t.colors.goldInk, { marginTop: 3 })}>
                  {w.worker_rating_count > 0 ? `★ ${Number(w.worker_rating_avg).toFixed(1)}` : 'New worker'}
                </RNText>
                {w.skills?.[0] ? (
                  <View style={{ marginTop: 6, backgroundColor: t.colors.surface2, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3, maxWidth: '100%' }}>
                    <RNText style={tx('600', 10, t.colors.text)} numberOfLines={1}>{w.skills[0]}</RNText>
                  </View>
                ) : null}
                <RNText style={tx('700', 11, t.colors.accentDeep, { marginTop: 8 })}>● Live · {mins} min left</RNText>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
