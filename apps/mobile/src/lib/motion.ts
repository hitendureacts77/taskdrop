import { useEffect, useState } from 'react';
import { AccessibilityInfo, Platform } from 'react-native';

/**
 * Whether the phone (or browser) asks for reduced motion. Every loop and
 * travelling animation in the app checks this: movement becomes a fade, or
 * nothing at all (SYS-Motion: "all of it switches off with Reduce Motion").
 */
let cached = false;

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(cached);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => {
        cached = on;
        if (alive) setReduced(on);
      })
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (on) => {
      cached = on;
      setReduced(on);
    });
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return reduced;
}

/**
 * The web cannot run a looped animation on the native driver (it plays once
 * and stops), so loops pass this instead of `true`.
 */
export const LOOP_NATIVE = Platform.OS !== 'web';
