import { useEffect, useState } from 'react';
import { promotedLive, type PromotedLive } from '../data/api';

/**
 * Live promotions near a point: 'request' for the Earn side (promoted tasks), 'service' for the Hire side
 * (promoted services). Empty while loading, for guests and when nothing is promoted: screens render as normal.
 */
export function usePromotedLive(
  kind: 'request' | 'service',
  near: { lat: number; lng: number; radiusKm?: number } | null,
  enabled = true,
): PromotedLive[] {
  const [rows, setRows] = useState<PromotedLive[]>([]);
  const lat = near?.lat ?? null;
  const lng = near?.lng ?? null;
  const radiusKm = near?.radiusKm ?? null;
  useEffect(() => {
    if (!enabled) {
      setRows([]);
      return;
    }
    let alive = true;
    void promotedLive(kind, lat !== null && lng !== null ? { lat, lng, radiusKm: radiusKm ?? undefined } : null)
      .then((r) => alive && setRows(Array.isArray(r) ? r : []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [kind, lat, lng, radiusKm, enabled]);
  return rows;
}
