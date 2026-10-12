import { useEffect, useState } from 'react';
import { View, Pressable, Text as RNText, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { fontFamilyFor } from '../theme';
import { Icon, type IconName } from './Icon';
import { useAuth } from '../providers/AuthProvider';
import { countNeedsAttention } from '../data/api';

/** 5-tab bar: Home · Explore · My Tasks (My Work) · Wallet · Profile. */
export function BottomTabBar() {
  const t = useTheme();
  const { screen, go } = useNav();
  const { mode } = useMode();
  const { userId } = useAuth();
  const insets = useSafeAreaInsets();

  // How many things are actually waiting on this person. Re-read whenever they
  // move around the app, which is the moment the answer can have changed.
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!userId) return;
    let alive = true;
    countNeedsAttention(userId, mode === 'worker' ? 'worker' : 'poster')
      .then((n) => alive && setWaiting(n))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, mode, screen]);


  const tabs: Array<{ key: ScreenName; icon: IconName; label: string }> = [
    { key: 'home', icon: 'home', label: 'Home' },
    { key: 'explore', icon: 'compass', label: 'Explore' },
    { key: 'myTasks', icon: 'orders', label: mode === 'worker' ? 'My Work' : 'My Tasks' },
    { key: 'wallet', icon: 'wallet', label: 'Wallet' },
    { key: 'profile', icon: 'user', label: 'Profile' },
  ];

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        // v2: a frosted bar on the web; a solid surface on native.
        backgroundColor: Platform.OS === 'web' ? (t.isDark ? 'rgba(22,25,28,0.92)' : 'rgba(255,255,255,0.92)') : t.colors.surface,
        ...(Platform.OS === 'web' ? ({ backdropFilter: 'blur(16px)' } as object) : null),
        borderTopColor: t.colors.line,
        borderTopWidth: 1,
        paddingTop: 8,
        paddingHorizontal: 6,
        paddingBottom: Math.max(insets.bottom, 12),
      }}
    >
      {tabs.map((tab) => {
        const active = screen === tab.key;
        const color = active ? t.colors.accentDeep : t.colors.muted;
        return (
          <Pressable
            key={tab.key}
            onPress={() => go(tab.key)}
            accessibilityRole="tab"
            accessibilityLabel={
              tab.key === 'myTasks' && waiting > 0
                ? `${tab.label}, ${waiting} needing attention`
                : tab.label
            }
            accessibilityState={{ selected: active }}
            style={({ pressed }) => ({
              alignItems: 'center',
              flex: 1,
              gap: 4,
              paddingVertical: 2,
              minHeight: 48,
              transform: [{ scale: pressed ? 0.94 : 1 }],
            })}
          >
            <View
              style={{
                paddingVertical: 4,
                paddingHorizontal: 16,
                borderRadius: 12,
                backgroundColor: active ? t.colors.accentSoft : 'transparent',
                transform: [{ translateY: active ? -1 : 0 }],
              }}
            >
              <Icon name={tab.icon} size={22} color={color} strokeWidth={active ? 2 : 1.8} />
              {tab.key === 'myTasks' && waiting > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: 4,
                    minWidth: 18,
                    height: 18,
                    borderRadius: 999,
                    paddingHorizontal: 4,
                    backgroundColor: t.colors.signalDeep,
                    borderWidth: 2,
                    borderColor: t.colors.surface,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText
                    style={{
                      fontSize: 10,
                      color: '#FFFFFF',
                      fontFamily: fontFamilyFor('800'),
                    }}
                  >
                    {waiting > 9 ? '9+' : waiting}
                  </RNText>
                </View>
              )}
            </View>
            <RNText style={{ fontSize: 11, color, fontFamily: fontFamilyFor(active ? '700' : '600') }} numberOfLines={1}>
              {tab.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}
