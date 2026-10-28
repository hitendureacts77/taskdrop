import { useCallback, useRef } from 'react';
import { Dimensions, type View } from 'react-native';
import type { TourTarget } from '../../lib/tour';

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * The real controls (and the practice views) the tour can light up. Each one
 * registers its View here under the tour's name for it. Several screens can be
 * mounted at once (every tab has its own header), so one name can have many
 * Views; the one that is actually on screen is picked when measuring.
 */
const registry = new Map<TourTarget, Set<View>>();

/**
 * Attach the returned ref to the View to light up. A callback ref, so a View
 * that appears later (the "Choose offer" button shows only once an offer is
 * picked) is registered when it mounts and dropped when it goes.
 */
export function useTourTarget(id: TourTarget) {
  const current = useRef<View | null>(null);
  return useCallback(
    (view: View | null) => {
      if (current.current) registry.get(id)?.delete(current.current);
      current.current = view;
      if (!view) return;
      const set = registry.get(id) ?? new Set<View>();
      set.add(view);
      registry.set(id, set);
    },
    [id],
  );
}

function measure(view: View): Promise<Rect | null> {
  return new Promise((resolve) => {
    try {
      view.measureInWindow((x, y, w, h) => resolve(w > 0 && h > 0 ? { x, y, w, h } : null));
    } catch {
      resolve(null);
    }
  });
}

/** Where the target is in the window right now, or null if none of its Views is visible. */
export async function measureTarget(id: TourTarget): Promise<Rect | null> {
  const { width, height } = Dimensions.get('window');
  for (const view of registry.get(id) ?? []) {
    const r = await measure(view);
    if (r && r.x < width && r.x + r.w > 0 && r.y < height && r.y + r.h > 0) return r;
  }
  return null;
}
