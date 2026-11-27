import { useEffect, useRef } from 'react';
import { Animated, Easing } from 'react-native';
import { LOOP_NATIVE } from '../../lib/motion';

/**
 * A 0..1 value that loops linearly, like a CSS `animation: x <ms> infinite` with an animation-delay.
 * The delay is a phase shift (the value starts `delayMs` of the way before the end), so an element that
 * is invisible at 0% and 100% simply appears later in the first pass. When `still` is set (Reduce Motion)
 * the value is parked at `stillAt` and nothing runs.
 */
export function useCycle(ms: number, delayMs: number, still: boolean, stillAt: number) {
  const v = useRef(new Animated.Value(still ? stillAt : 1 - delayMs / ms)).current;
  useEffect(() => {
    if (still) {
      v.setValue(stillAt);
      return;
    }
    v.setValue(1 - delayMs / ms);
    const run = () => {
      v.setValue(0);
      return Animated.loop(Animated.timing(v, { toValue: 1, duration: ms, easing: Easing.linear, useNativeDriver: LOOP_NATIVE }));
    };
    let loop: Animated.CompositeAnimation | null = null;
    const first = Animated.timing(v, { toValue: 1, duration: delayMs, easing: Easing.linear, useNativeDriver: LOOP_NATIVE });
    first.start(({ finished }) => {
      if (!finished) return;
      loop = run();
      loop.start();
    });
    return () => {
      first.stop();
      loop?.stop();
    };
  }, [v, ms, delayMs, still, stillAt]);
  return v;
}
