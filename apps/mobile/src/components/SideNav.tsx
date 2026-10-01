import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { useSwitchMode } from '../lib/useSwitchMode';
import { countNeedsAttention } from '../data/api';
import { SIDEBAR_WIDTH } from '../lib/layout';
import { Icon, type IconName } from './Icon';
import { tx } from './primitives';

/**
 * The desktop web navigation: what the bottom tab bar and the floating
 * "Post a request" button are on a phone, as a sidebar down the left.
 * Same destinations, same Post/Earn switch, same attention badge.
 */
export function SideNav() {
  const t = useTheme();
  const { screen, go, reset } = useNav();
  const { mode } = useMode();
  const { userId } = useAuth();
  const switchMode = useSwitchMode();
  const worker = mode === 'worker';

  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    countNeedsAttention(userId, worker ? 'worker' : 'poster')
      .then((n) => alive && setWaiting(n))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, worker, screen]);

  const main: { key: ScreenName; icon: IconName; label: string; badge?: number }[] = [
    { key: 'home', icon: 'home', label: 'Home' },
    { key: 'explore', icon: 'compass', label: 'Explore' },
    { key: 'myTasks', icon: 'orders', label: worker ? 'My Work' : 'My Tasks', badge: waiting },
    { key: 'wallet', icon: 'wallet', label: 'Wallet' },
    { key: 'inbox', icon: 'chat', label: 'Messages' },
    { key: 'notifications', icon: 'bell', label: 'Notifications' },
    { key: 'profile', icon: 'user', label: 'Profile' },
  ];
  const lower: { key: ScreenName; icon: IconName; label: string }[] = [
    { key: 'account', icon: 'settings', label: 'Settings' },
    { key: 'help', icon: 'help', label: 'Help & support' },
  ];

  const accent = worker ? t.colors.purpleDeep : t.colors.accent;

  const item = (it: { key: ScreenName; icon: IconName; label: string; badge?: number }) => {
    const on = screen === it.key;
    return (
      <Pressable
        key={it.key}
        onPress={() => (['home', 'explore', 'myTasks', 'wallet', 'profile'].includes(it.key) ? reset(it.key) : go(it.key))}
        accessibilityRole="link"
        accessibilityState={{ selected: on }}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 13,
          paddingVertical: 11,
          paddingHorizontal: 14,
          borderRadius: 14,
          backgroundColor: on ? t.colors.accentSoft : hovered || pressed ? t.colors.surface2 : 'transparent',
        })}
      >
        <Icon name={it.icon} size={21} color={on ? t.colors.accentDeep : t.colors.text} strokeWidth={on ? 2 : 1.7} />
        <RNText style={tx(on ? '800' : '600', 15, on ? t.colors.ink : t.colors.text, { flex: 1 })}>{it.label}</RNText>
        {it.badge ? (
          <View style={{ minWidth: 22, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 999, backgroundColor: accent, alignItems: 'center' }}>
            <RNText style={tx('800', 11, '#FFFFFF')}>{it.badge > 9 ? '9+' : it.badge}</RNText>
          </View>
        ) : null}
      </Pressable>
    );
  };

  return (
    <View
      style={{
        width: SIDEBAR_WIDTH,
        height: '100%',
        backgroundColor: t.colors.surface,
        borderRightWidth: 1,
        borderRightColor: t.colors.line,
      }}
    >
      <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 24, flexGrow: 1 }} showsVerticalScrollIndicator={false}>
        <Pressable onPress={() => reset('home')} accessibilityRole="link" accessibilityLabel="TaskDrop home" style={{ paddingHorizontal: 8 }}>
          <RNText style={tx('800', 26, t.colors.ink, { letterSpacing: -0.9 })}>
            taskdrop<RNText style={tx('800', 26, accent)}>.</RNText>
          </RNText>
        </Pressable>

        {/* Post / Earn — the same switch the phone header carries. */}
        <View style={{ flexDirection: 'row', backgroundColor: t.colors.surface2, borderRadius: 14, padding: 4, marginTop: 22 }}>
          {(['poster', 'worker'] as const).map((m) => {
            const on = mode === m;
            return (
              <Pressable
                key={m}
                onPress={() => void switchMode(m)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={{
                  flex: 1,
                  paddingVertical: 9,
                  borderRadius: 11,
                  alignItems: 'center',
                  backgroundColor: on ? (m === 'poster' ? t.colors.accent : t.colors.purpleDeep) : 'transparent',
                }}
              >
                <RNText style={tx('800', 13, on ? '#FFFFFF' : t.colors.muted)}>{m === 'poster' ? 'Hire' : 'Earn'}</RNText>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={() => go(worker ? 'listing' : 'aiPost')}
          accessibilityRole="button"
          style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 14,
            paddingVertical: 13,
            borderRadius: 14,
            backgroundColor: accent,
            opacity: hovered ? 0.92 : 1,
            transform: [{ scale: pressed ? 0.98 : 1 }],
          })}
        >
          <Icon name="plus" size={18} color="#FFFFFF" strokeWidth={2.4} />
          <RNText style={tx('800', 15, '#FFFFFF')}>{worker ? 'Offer a service' : 'Post a request'}</RNText>
        </Pressable>

        <View style={{ marginTop: 22, gap: 2 }}>{main.map(item)}</View>

        <View style={{ flex: 1, minHeight: 24 }} />
        <View style={{ borderTopWidth: 1, borderTopColor: t.colors.line, paddingTop: 12, gap: 2 }}>{lower.map(item)}</View>
      </ScrollView>
    </View>
  );
}
