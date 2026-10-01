import { useEffect, useRef } from 'react';
import { Animated, Easing, Platform } from 'react-native';
import Svg, { Path } from 'react-native-svg';

/** The TaskDrop droplet, as on the splash screen. */
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
 */
export function Ripples({ color, size }: { color: string; size: number }) {
  const r0 = useRef(new Animated.Value(0)).current;
  const r1 = useRef(new Animated.Value(0)).current;
  const r2 = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const rings = [r0, r1, r2];
    const loops: Animated.CompositeAnimation[] = [];
    // Each ring starts a beat after the last and then keeps its own rhythm,
    // so they stay evenly spaced instead of drifting into step.
    const timers = rings.map((v, i) =>
      setTimeout(() => {
        const loop = Animated.loop(
          // On the web a looped native-driver animation plays once and stops.
          Animated.timing(v, { toValue: 1, duration: 3000, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        );
        loops.push(loop);
        loop.start();
      }, i * 1000),
    );
    return () => {
      timers.forEach(clearTimeout);
      loops.forEach((l) => l.stop());
    };
  }, [r0, r1, r2]);
  return (
    <>
      {[r0, r1, r2].map((v, i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={{
            position: 'absolute',
            width: size,
            height: size,
            borderRadius: size,
            borderWidth: 1.5,
            borderColor: color,
            opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.6, 0] }),
            transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.22, 1] }) }],
          }}
        />
      ))}
    </>
  );
}

