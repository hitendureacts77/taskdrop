import { useEffect, useState } from 'react';
import { useReducedMotion } from '../lib/motion';

/**
 * The clock behind the map's intro and ripples (lib/mapMotion.ts). It restarts
 * whenever `key` changes (a new set of areas), ticks about 30 times a second
 * until `endMs`, then slows to about 15 a second only while something ripples,
 * and stops otherwise. Map circles are drawn by the native map, not Animated,
 * so the frames come from here. With Reduce Motion it never ticks: `elapsed`
 * is Infinity (everything already settled) and nothing ripples.
 */
export function useMapClock(key: string, endMs: number, ripples: boolean): { elapsed: number; now: number; still: boolean } {
  const reduced = useReducedMotion();
  const [clock, setClock] = useState(() => ({ key, start: Date.now(), now: Date.now() }));
  const start = clock.key === key ? clock.start : null;

  useEffect(() => {
    if (reduced) return;
    const begin = start ?? Date.now();
    if (start === null) setClock({ key, start: begin, now: begin });
    let id: ReturnType<typeof setTimeout>;
    const step = () => {
      const now = Date.now();
      setClock((c) => (c.key === key ? { ...c, now } : c));
      if (now - begin < endMs) id = setTimeout(step, 33);
      else if (ripples) id = setTimeout(step, 66);
    };
    id = setTimeout(step, 33);
    return () => clearTimeout(id);
    // `start` is read once per key; restarting on every tick would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, endMs, ripples, reduced]);

  if (reduced) return { elapsed: Infinity, now: clock.now, still: true };
  return { elapsed: start === null ? 0 : clock.now - start, now: clock.now, still: false };
}
