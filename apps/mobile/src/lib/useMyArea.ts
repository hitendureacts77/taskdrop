import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import { useFocusTick } from '../providers/NavProvider';
import { getProfile, updateProfile } from '../data/api';
import type { PickedPlace } from '../components/LocationSheet';

export type MyArea = { label: string; lat: number; lng: number };

/**
 * The area the person chose on their profile (Home's area bar sets the same
 * one): where the Explore maps are centred. Re-read whenever the screen comes
 * back into view. The object stays the same while the point doesn't move, so
 * the lists under a map are not refetched for nothing.
 */
export function useMyArea(): { area: MyArea | null; loaded: boolean; choose: (picked: PickedPlace) => Promise<void> } {
  const { userId } = useAuth();
  const { flash } = useActions();
  const tick = useFocusTick();
  const [area, setArea] = useState<MyArea | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    getProfile(userId)
      .then((p) => {
        if (!alive) return;
        setLoaded(true);
        setArea((cur) => {
          if (p?.loc_lat == null || p?.loc_lng == null) return null;
          if (cur && cur.lat === p.loc_lat && cur.lng === p.loc_lng) return cur;
          return { label: p.loc_label ?? 'Your area', lat: p.loc_lat, lng: p.loc_lng };
        });
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  const choose = useCallback(
    async (picked: PickedPlace) => {
      if (picked.lat === null || picked.lng === null) return flash('Drop a pin on the map to set your area');
      const next = { label: picked.area || picked.label, lat: picked.lat, lng: picked.lng };
      setArea(next);
      if (!userId) return;
      await updateProfile(userId, { locLabel: next.label, locLat: next.lat, locLng: next.lng }).catch((e) =>
        flash(e instanceof Error ? e.message : 'Could not save your area'),
      );
    },
    [userId, flash],
  );

  return { area, loaded, choose };
}
