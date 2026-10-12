import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { countNeedsAttention } from '../data/api';
import { RAIL_WIDTH, SIDEBAR_WIDTH } from '../lib/layout';
import { Icon, type IconName } from './Icon';
import { ModeSwitch } from './ModeSwitch';
import { Drop } from './Ripples';
import { tx } from './primitives';

/**
 * The wide-screen navigation: what the bottom tab bar and the floating drop
 * button are on a phone, as a menu down the left. Same destinations, same
 * Hire/Earn switch, same attention badge. On a desktop it is the full menu
 * (logo, switch, "Post a request", labelled items); on a tablet it folds into
 * a slim icon rail.
 */
export function SideNav({ rail = false }: { rail?: boolean }) {
  const t = useTheme();
  const { screen, go, reset } = useNav();
  const { mode } = useMode();
  const { userId } = useAuth();
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

  const item = (it: { key: ScreenName; icon: IconName; label: string; badge?: number }) => {
    const on = screen === it.key;
    return (
      <Pressable
        key={it.key}
        onPress={() => (['home', 'explore', 'myTasks', 'wallet', 'profile'].includes(it.key) ? reset(it.key) : go(it.key))}
        accessibilityRole="link"
        accessibilityLabel={it.badge ? `${it.label}, ${it.badge} needing attention` : it.label}
        accessibilityState={{ selected: on }}
        style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: rail ? 'center' : 'flex-start',
          gap: 12,
          height: 44,
          paddingHorizontal: rail ? 0 : 12,
          borderRadius: 12,
          backgroundColor: on ? t.colors.accentSoft : hovered || pressed ? t.colors.surface2 : 'transparent',
        })}
      >
        <View>
          <Icon name={it.icon} size={20} color={on ? t.colors.accentDeep : t.colors.text} strokeWidth={on ? 2 : 1.8} />
          {rail && it.badge ? (
            <View
              style={{
                position: 'absolute',
                top: -5,
                right: -8,
                minWidth: 16,
                height: 16,
                paddingHorizontal: 3,
                borderRadius: 999,
                backgroundColor: t.colors.signalDeep,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx('800', 9, '#FFFFFF')}>{it.badge > 9 ? '9+' : it.badge}</RNText>
            </View>
          ) : null}
        </View>
        {rail ? null : (
          <>
            <RNText style={tx(on ? '700' : '600', 14, on ? t.colors.accentDeep : t.colors.text, { flex: 1 })}>{it.label}</RNText>
            {it.badge ? (
              <View
                style={{
                  minWidth: 20,
                  height: 20,
                  paddingHorizontal: 6,
                  borderRadius: 10,
                  backgroundColor: t.colors.goldSoft,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RNText style={tx('800', 11, t.colors.goldInk)}>{it.badge > 9 ? '9+' : it.badge}</RNText>
              </View>
            ) : null}
          </>
        )}
      </Pressable>
    );
  };

  const post = (
    <Pressable
      onPress={() => go(worker ? 'listing' : 'aiPost')}
      accessibilityRole="button"
      accessibilityLabel={worker ? 'Offer a service' : 'Post a request'}
      style={({ hovered, pressed }: { hovered?: boolean; pressed: boolean }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        height: 48,
        width: rail ? 48 : undefined,
        alignSelf: rail ? 'center' : 'stretch',
        borderRadius: 14,
        backgroundColor: t.colors.btn,
        opacity: hovered ? 0.93 : 1,
        shadowColor: t.colors.btn,
        shadowOpacity: t.isDark ? 0 : 0.35,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 8 },
        transform: [{ scale: pressed ? 0.97 : hovered ? 1.01 : 1 }],
      })}
    >
      <Icon name="plus" size={18} color={t.colors.onBtn} strokeWidth={2.4} />
      {rail ? null : <RNText style={tx('700', 14, t.colors.onBtn)}>{worker ? 'Offer a service' : 'Post a request'}</RNText>}
    </Pressable>
  );

  return (
    <View
      style={{
        width: rail ? RAIL_WIDTH : SIDEBAR_WIDTH,
        height: '100%',
        backgroundColor: t.colors.surface,
        borderRightWidth: 1,
        borderRightColor: t.colors.line,
      }}
    >
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: rail ? 10 : 18, paddingVertical: rail ? 18 : 24, flexGrow: 1, gap: rail ? 14 : 18 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable
          onPress={() => reset('home')}
          accessibilityRole="link"
          accessibilityLabel="TaskDrop home"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: rail ? 0 : 6, alignSelf: rail ? 'center' : 'flex-start' }}
        >
          <Drop size={rail ? 30 : 28} fill={t.colors.accent} tick={t.isDark ? t.colors.bg : '#FFFFFF'} />
          {rail ? null : (
            <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.7 })}>
              taskdrop<RNText style={tx('800', 22, t.colors.accent)}>.</RNText>
            </RNText>
          )}
        </Pressable>

        {/* Hire / Earn -- the same switch the phone header carries. */}
        {rail ? (
          <View style={{ alignSelf: 'center' }}>
            <ModeSwitch stacked />
          </View>
        ) : (
          <ModeSwitch full />
        )}

        {post}

        <View style={{ gap: 4 }}>{main.map(item)}</View>

        <View style={{ flex: 1, minHeight: 12 }} />
        <View style={{ borderTopWidth: 1, borderTopColor: t.colors.line, paddingTop: 12, gap: 4 }}>{lower.map(item)}</View>
      </ScrollView>
    </View>
  );
}
