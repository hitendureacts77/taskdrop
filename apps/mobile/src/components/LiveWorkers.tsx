import { useEffect, useState } from 'react';
import { View, Text as RNText, ScrollView, Pressable } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import type { Profile } from '../data/api';
import { listActiveWorkers } from '../data/extras';
import { presenceOf } from '../lib/presence';
import { AvatarPresence, PresenceDot } from './PresenceDot';
import { SectionTitle } from './kit';
import { tx } from './primitives';

const REFRESH_MS = 60_000;

/**
 * Workers around right now, for a poster: the ones with TaskDrop open show a
 * green dot and "Active now"; the ones who stepped away show how long ago.
 *
 * Re-read every minute while on screen, so someone who closes the app turns
 * to "Away" rather than sitting there looking available. Hidden when nobody
 * has been around in the last half hour.
 */
export function LiveWorkers({ active }: { active: boolean }) {
  const t = useTheme();
  const { go } = useNav();
  const [workers, setWorkers] = useState<Profile[]>([]);

  useEffect(() => {
    if (!active) return;
    let alive = true;
    const load = () => void listActiveWorkers().then((w) => alive && setWorkers(w));
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [active]);

  if (workers.length === 0) return null;
  const onlineCount = workers.filter((w) => presenceOf(w.last_seen_at).online).length;

  return (
    <View style={{ marginTop: 24 }}>
      <SectionTitle
        title="Workers around now"
        icon="users"
        badge={onlineCount > 0 ? `${onlineCount} active` : undefined}
      />
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>
        A green dot means they have TaskDrop open right now
      </RNText>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12, marginHorizontal: -20 }}>
        <View style={{ flexDirection: 'row', gap: 10, paddingHorizontal: 20 }}>
          {workers.map((w) => {
            const name = w.username ? '@' + w.username : w.display_name;
            const p = presenceOf(w.last_seen_at);
            return (
              <Pressable
                key={w.id}
                onPress={() => go('publicProfile', { userId: w.id })}
                accessibilityRole="button"
                accessibilityLabel={`${name}, ${p.label}`}
                style={({ pressed }) => ({
                  width: 136,
                  alignItems: 'center',
                  backgroundColor: t.colors.surface,
                  borderWidth: 1,
                  borderColor: p.online ? t.colors.accentBorder : t.colors.line,
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
                  <AvatarPresence lastSeen={w.last_seen_at} ring={t.colors.surface} />
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
                <View style={{ marginTop: 8 }}>
                  <PresenceDot lastSeen={w.last_seen_at} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}
