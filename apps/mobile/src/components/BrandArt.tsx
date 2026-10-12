import { useEffect, useRef } from 'react';
import { Animated, Easing, Text as RNText, View, type StyleProp, type ViewStyle } from 'react-native';
import { light } from '../theme';
import { LOOP_NATIVE, useReducedMotion } from '../lib/motion';
import { Icon, type IconName } from './Icon';
import { Drop } from './Ripples';
import { tx } from './primitives';

/**
 * Illustration pieces for the sign-in screens (ST02, W1): small floating
 * cards that show what goes out when a task drops -- one nearby, one remote --
 * and the drop falling onto ground rings. Pure decoration: hidden from screen
 * readers, still under Reduce Motion.
 */

function useFloat(delay = 0, distance = 8, duration = 3200) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: LOOP_NATIVE }),
        Animated.timing(v, { toValue: 0, duration: duration / 2, easing: Easing.inOut(Easing.sin), useNativeDriver: LOOP_NATIVE }),
      ]),
    );
    const id = setTimeout(() => loop.start(), delay);
    return () => {
      clearTimeout(id);
      loop.stop();
    };
  }, [v, reduced, delay, duration]);
  return v.interpolate({ inputRange: [0, 1], outputRange: [0, -distance] });
}

export function FloatCard({
  icon,
  title,
  sub,
  tone = 'accent',
  delay = 0,
  style,
}: {
  icon: IconName;
  title: string;
  sub: string;
  tone?: 'accent' | 'ai';
  delay?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const y = useFloat(delay);
  // Always the light card: it floats on the jade hero in both themes.
  const soft = tone === 'ai' ? light.aiSoft : light.accentSoft;
  const ink = tone === 'ai' ? light.aiInk : light.accentDeep;
  return (
    <Animated.View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        {
          position: 'absolute',
          flexDirection: 'row',
          alignItems: 'center',
          gap: 9,
          backgroundColor: light.surface,
          borderRadius: 14,
          paddingVertical: 8,
          paddingLeft: 8,
          paddingRight: 12,
          shadowColor: '#000',
          shadowOpacity: 0.18,
          shadowRadius: 18,
          shadowOffset: { width: 0, height: 10 },
          elevation: 6,
          transform: [{ translateY: y }],
        },
        style,
      ]}
    >
      <View style={{ width: 28, height: 28, borderRadius: 999, backgroundColor: soft, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={14} color={ink} strokeWidth={2} />
      </View>
      <View>
        <RNText style={tx('700', 11.5, light.ink)}>{title}</RNText>
        <RNText style={tx('500', 10, light.muted)}>{sub}</RNText>
      </View>
    </Animated.View>
  );
}

/**
 * The landing's drop: it falls, lands on elliptical ground rings that spread
 * out, and falls again (wFall / wRing from the design).
 */
export function FallingDrop({ size = 76 }: { size?: number }) {
  const reduced = useReducedMotion();
  const fall = useRef(new Animated.Value(reduced ? 1 : 0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      fall.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(fall, { toValue: 0, duration: 0, useNativeDriver: LOOP_NATIVE }),
        Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: LOOP_NATIVE }),
        Animated.timing(fall, { toValue: 1, duration: 1050, easing: Easing.bezier(0.55, 0, 1, 0.45), useNativeDriver: LOOP_NATIVE }),
        Animated.timing(ring, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: LOOP_NATIVE }),
        Animated.delay(600),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [fall, ring, reduced]);
  return (
    <View
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: 420, height: 300, alignItems: 'center', justifyContent: 'flex-end' }}
    >
      {[0, 1, 2].map((i) => (
        <Animated.View
          key={i}
          style={{
            position: 'absolute',
            bottom: 10,
            width: 360,
            height: 360,
            borderRadius: 999,
            borderWidth: 1.5,
            borderColor: 'rgba(255,255,255,0.45)',
            opacity: ring.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 0.9 - i * 0.2, 0] }),
            transform: [
              { translateY: 180 },
              { scaleY: 0.3 },
              { scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.15 + i * 0.12, 0.7 + i * 0.3] }) },
              { translateY: -180 },
            ],
          }}
        />
      ))}
      <Animated.View
        style={{
          marginBottom: 40,
          opacity: fall.interpolate({ inputRange: [0, 0.1, 1], outputRange: [0, 1, 1] }),
          transform: [{ translateY: fall.interpolate({ inputRange: [0, 1], outputRange: [-160, 0] }) }],
        }}
      >
        <Drop size={size} fill="rgba(255,255,255,0.88)" tick={light.accentDeep} />
      </Animated.View>
    </View>
  );
}
