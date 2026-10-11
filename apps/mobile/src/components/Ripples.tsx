import { useEffect, useRef } from 'react';
import { Animated, Easing, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { LOOP_NATIVE, useReducedMotion } from '../lib/motion';

/** The TaskDrop droplet with its check, as on the splash screen. */
export function Drop({ size, fill, tick }: { size: number; fill: string; tick: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 2.5c4.2 4.5 6.6 7.7 6.6 10.8A6.6 6.6 0 0 1 12 20a6.6 6.6 0 0 1-6.6-6.7C5.4 10.2 7.8 7 12 2.5Z"
        fill={fill}
      />
      <Path d="M9.2 13.1l2.2 2.3 4-4.6" stroke={tick} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}

/**
 * A drop landing in water: rings spreading out from the logo. It is the idea
 * of the app in one picture -- a request goes out to the people around you.
 * Concentric rings are the brand's one decoration (SYS-Brand: "The ripple").
 */
export function Ripples({
  color,
  size,
  count = 3,
  duration = 3000,
  borderWidth = 1.5,
  from = 0.22,
  peak = 0.6,
  style,
}: {
  color: string;
  size: number;
  count?: number;
  duration?: number;
  borderWidth?: number;
  /** Scale a ring starts at. */
  from?: number;
  /** Opacity a ring starts at. */
  peak?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const values = useRef(Array.from({ length: count }, () => new Animated.Value(0))).current;
  useEffect(() => {
    if (reduced) {
      // Still rings, evenly spaced: the picture without the movement.
      values.forEach((v, i) => v.setValue((i + 1) / (count + 1)));
      return;
    }
    const loops: Animated.CompositeAnimation[] = [];
    // Each ring starts a beat after the last and then keeps its own rhythm,
    // so they stay evenly spaced instead of drifting into step.
    const timers = values.map((v, i) =>
      setTimeout(() => {
        const loop = Animated.loop(
          Animated.timing(v, { toValue: 1, duration, easing: Easing.out(Easing.quad), useNativeDriver: LOOP_NATIVE }),
        );
        loops.push(loop);
        loop.start();
      }, (i * duration) / count),
    );
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [values, reduced, duration, count]);
  return (
    <>
      {values.map((v, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: size,
              height: size,
              borderRadius: size,
              borderWidth,
              borderColor: color,
              opacity: v.interpolate({ inputRange: [0, 1], outputRange: [peak, 0] }),
              transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }],
            },
            style,
          ]}
        />
      ))}
    </>
  );
}
