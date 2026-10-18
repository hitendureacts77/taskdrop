import { useEffect, useRef } from 'react';
import { Pressable, Animated, Easing, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { LOOP_NATIVE, useReducedMotion } from '../lib/motion';

/**
 * The drop button (SYS-Components "Drop button (floating post)"): the brand
 * drop with a plus, floating above the tab bar on Home. It takes the mode's
 * colour -- deep jade on Hire, blue on Earn -- and bobs gently. Posts a
 * request on Hire, offers a service on Earn, as the pill it replaces did.
 */
export function CreateFab({ bottom = 100 }: { bottom?: number }) {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();
  const reduced = useReducedMotion();
  const worker = mode === 'worker';

  const rise = useRef(new Animated.Value(0)).current;
  const bob = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const anim = Animated.spring(rise, { toValue: 1, useNativeDriver: true, friction: 7, tension: 70 });
    anim.start();
    if (reduced) return () => anim.stop();
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: LOOP_NATIVE }),
        Animated.timing(bob, { toValue: 0, duration: 1600, easing: Easing.inOut(Easing.sin), useNativeDriver: LOOP_NATIVE }),
      ]),
    );
    loop.start();
    return () => {
      anim.stop();
      loop.stop();
    };
  }, [rise, bob, reduced]);

  return (
    <Animated.View
      style={{
        position: 'absolute',
        right: 18,
        bottom,
        opacity: rise,
        transform: [
          { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [30, 0] }) },
          { translateY: bob.interpolate({ inputRange: [0, 1], outputRange: [0, -5] }) },
        ],
      }}
    >
      <Pressable
        onPress={() => go(worker ? 'listing' : 'aiPost')}
        accessibilityRole="button"
        accessibilityLabel={worker ? 'Offer a service' : 'Post a request'}
        hitSlop={6}
        style={({ pressed }) => ({
          width: 62,
          height: 76,
          alignItems: 'center',
          justifyContent: 'center',
          // The shadow follows the drop's shape: a CSS drop-shadow on the web,
          // the layer's own alpha on iOS. (Android elevation would draw a box.)
          ...(Platform.OS === 'web'
            ? ({ filter: `drop-shadow(0 12px 14px ${t.colors.btn}73)` } as object)
            : Platform.OS === 'ios'
              ? { shadowColor: t.colors.btn, shadowOpacity: 0.45, shadowRadius: 14, shadowOffset: { width: 0, height: 10 } }
              : null),
          transform: [{ scale: pressed ? 0.92 : 1 }],
        })}
      >
        <Svg width={62} height={76} viewBox="0 0 62 76">
          <Path
            d="M31 2C43 16 56 31 56 47A25 25 0 0 1 6 47C6 31 19 16 31 2Z"
            fill={t.colors.btn}
          />
          <Path d="M31 36v22M20 47h22" stroke={t.colors.onBtn} strokeWidth={4} strokeLinecap="round" />
        </Svg>
      </Pressable>
    </Animated.View>
  );
}
