import React, { useEffect, useRef } from 'react';
import { Pressable, Animated, type TextStyle, type ViewStyle, type StyleProp } from 'react-native';
import { fontFamilyFor } from '../theme';

/**
 * The three helpers every ported screen needs.
 *
 * These were copy-pasted into two dozen screen files during the port from
 * docs/design/. The timings and press scales here are the design's own — don't
 * tune them without changing the design first.
 */

/** Shorthand for the design's {font-weight, size, color, ...rest} text styles. */
export function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

/** Scale-down press feedback, matching the markup's style-active="{{press}}". */
export function Pressy({
  onPress,
  scaleTo = 0.96,
  style,
  children,
}: {
  onPress?: () => void;
  scaleTo?: number;
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, { transform: [{ scale: pressed ? scaleTo : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Fades + slides content in on mount, ~ the markup's tdFade/tdIn keyframes.
 * Runs once on mount by design — re-running it on every prop change would make
 * list rows flicker as their data refreshes. Stops the animation on unmount.
 */
export function FadeIn({
  children,
  duration = 260,
  delay = 0,
  translateY = 0,
  style,
}: {
  children: React.ReactNode;
  duration?: number;
  delay?: number;
  translateY?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(translateY)).current;
  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, delay, useNativeDriver: true }),
      Animated.timing(ty, { toValue: 0, duration, delay, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: ty }] }]}>
      {children}
    </Animated.View>
  );
}
