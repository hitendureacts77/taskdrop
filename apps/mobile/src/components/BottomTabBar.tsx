import { useEffect, useState } from 'react';
import { View, Pressable, Text as RNText, StyleSheet } from 'react-native';
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
        alignItems: 'center',
        backgroundColor: t.colors.surface,
        borderTopColor: t.colors.line,
        borderTopWidth: StyleSheet.hairlineWidth,
        paddingTop: 12,
        paddingHorizontal: 14,
        paddingBottom: 20,
      }}
    >
      {tabs.map((tab) => {
        const active = screen === tab.key;
        const color = active ? t.colors.ink : t.colors.muted;
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
              gap: 5,
              paddingVertical: 4,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <View
              style={{
                transform: [{ translateY: active ? -2 : 0 }, { scale: active ? 1.06 : 1 }],
              }}
            >
              <Icon name={tab.icon} size={23} color={color} strokeWidth={1.7} />
              {tab.key === 'myTasks' && waiting > 0 && (
                <View
                  style={{
                    position: 'absolute',
                    top: -4,
                    right: -9,
                    minWidth: 16,
                    height: 16,
                    borderRadius: 999,
                    paddingHorizontal: 4,
                    backgroundColor: t.colors.accent,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText
                    style={{
                      fontSize: 10,
                      color: t.colors.onAccent,
                      fontFamily: fontFamilyFor('800'),
                    }}
                  >
                    {waiting > 9 ? '9+' : waiting}
                  </RNText>
                </View>
              )}
            </View>
            <RNText style={{ fontSize: 9, color, fontFamily: fontFamilyFor('600') }}>
              {tab.label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}
