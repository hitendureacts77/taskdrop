import { useEffect, useRef } from 'react';
import { Text as RNText, Pressable, Animated } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { fontFamilyFor } from '../theme';

/**
 * Create FAB — docs/design/_design_markup.html lines 1144-1148. A pill anchored
 * above the nav on Home only; label is mode-aware (_design_source.jsx line 944).
 */
export function CreateFab() {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();

  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.timing(rise, { toValue: 1, duration: 340, useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [rise]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        right: 18,
        bottom: 96,
        opacity: rise,
        transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [26, 0] }) }],
      }}
    >
      <Pressable
        onPress={() => go(mode === 'worker' ? 'listing' : 'aiPost')}
        accessibilityRole="button"
        accessibilityLabel={mode === 'worker' ? 'Offer a service' : 'Post a request'}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          backgroundColor: t.colors.accent,
          borderRadius: 999,
          paddingVertical: 14,
          paddingHorizontal: 18,
          shadowColor: t.colors.accent,
          shadowOpacity: 0.4,
          shadowRadius: 26,
          shadowOffset: { width: 0, height: 10 },
          elevation: 8,
          transform: [{ scale: pressed ? 0.96 : 1 }],
        })}
      >
        <RNText style={{ fontSize: 17, lineHeight: 19, color: t.colors.onAccent, fontFamily: fontFamilyFor('700') }}>
          ＋
        </RNText>
        <RNText style={{ fontSize: 14, color: t.colors.onAccent, fontFamily: fontFamilyFor('700') }}>
          {mode === 'worker' ? 'Offer a service' : 'Post a request'}
        </RNText>
      </Pressable>
    </Animated.View>
  );
}
