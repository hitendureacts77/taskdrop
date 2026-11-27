import { useEffect, useRef, useState } from 'react';
import { promotedLive, type PromotedLive } from '../data/api';

/** How long the filtered set must stay the same before the auction is asked (each ask can charge the winners). */
const SETTLE_MS = 600;

/**
 * The auction for the top places, run when a list opens: 'request' for the Earn side (promoted tasks), 'service'
 * for the Hire side (promoted services). Every returned row is a live promotion to badge; `top` ones lift.
 *
 * `taskIds` is the list the viewer is looking at after their filters: only those can win. An empty list does not
 * call at all. It asks once per open and again only when that set or the place really changes (debounced), never
 * per render or keystroke. Empty while loading, for guests and when nothing is promoted: screens render as normal.
 */
export function usePromotedLive(
  kind: 'request' | 'service',
  near: { lat: number; lng: number; radiusKm?: number } | null,
  opts: { surface: 'list' | 'home' | 'map' | 'search'; taskIds?: readonly string[]; enabled?: boolean },
): PromotedLive[] {
  const [rows, setRows] = useState<PromotedLive[]>([]);
  const lat = near?.lat ?? null;
  const lng = near?.lng ?? null;
  const radiusKm = near?.radiusKm ?? null;
  const { surface, taskIds, enabled = true } = opts;
  const idsKey = taskIds ? [...taskIds].sort().join(',') : '*';
  const idsRef = useRef(taskIds);
  idsRef.current = taskIds;
  const off = !enabled || (taskIds !== undefined && taskIds.length === 0);
  useEffect(() => {
    if (off) {
      setRows((r) => (r.length === 0 ? r : []));
      return;
    }
    let alive = true;
    const timer = setTimeout(() => {
      const ids = idsRef.current;
      void promotedLive(kind, lat !== null && lng !== null ? { lat, lng, radiusKm: radiusKm ?? undefined } : null, {
        surface,
        ...(ids ? { taskIds: [...ids] } : {}),
      })
        .then((r) => alive && setRows(Array.isArray(r) ? r : []))
        .catch(() => {});
    }, SETTLE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [kind, lat, lng, radiusKm, surface, idsKey, off]);
  return rows;
}
