import { useEffect, useState } from 'react';
import { useReducedMotion } from '../lib/motion';
import { epochLive } from '../lib/pinMotion';

/**
 * True for `windowMs` after `key` changes (and after mount), then false. Pins that mount while it is true play
 * their intro or burst once (PinMotion reads it only at mount); pins that arrive later, because the map was
 * moved, just appear. It re-renders twice per epoch, never per frame. Always false under reduced motion.
 */
export function usePinEpoch(key: string, windowMs: number): boolean {
  const reduced = useReducedMotion();
  const [ep, setEp] = useState(() => ({ key, until: Date.now() + windowMs }));
  let cur = ep;
  if (ep.key !== key) {
    cur = { key, until: Date.now() + windowMs };
    setEp(cur);
  }
  const [, tick] = useState(0);
  useEffect(() => {
    const left = cur.until - Date.now();
    if (left <= 0) return;
    const id = setTimeout(() => tick((n) => n + 1), left + 16);
    return () => clearTimeout(id);
  }, [cur]);
  return epochLive(Date.now(), cur.until, reduced);
}
