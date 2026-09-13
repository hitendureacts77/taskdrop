import { View, Pressable, Text as RNText, StyleSheet } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { fontFamilyFor } from '../theme';
import { Icon, type IconName } from './Icon';

/** Design's 5-tab bar: Home · Search · Orders(Bids/Requests) · Wallet · Profile. */
export function BottomTabBar() {
  const t = useTheme();
  const { screen, go } = useNav();
  const { mode } = useMode();

  const tabs: Array<{ key: ScreenName; icon: IconName; label: string }> = [
    { key: 'home', icon: 'home', label: 'Home' },
    { key: 'search', icon: 'search', label: 'Search' },
    { key: 'orders', icon: 'orders', label: mode === 'worker' ? 'Bids' : 'Requests' },
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
