import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import { useFocusTick } from '../providers/NavProvider';
import { getProfile, updateProfile } from '../data/api';
import { guestAreaFromPicked } from './guestArea';
import { readGuestArea, saveGuestArea } from './guestAreaStore';
import type { PickedPlace } from '../components/LocationSheet';
import { areaFromProfile, onAreaChange, peekArea, rememberArea, sameArea } from './areaCache';

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
  // Starts from the area Home already read this session (P1-12 / P1-13), so the map does not wait or ask again.
  const [area, setArea] = useState<MyArea | null>(() => peekArea(userId ?? 'guest') ?? null);
  const [loaded, setLoaded] = useState(() => peekArea(userId ?? 'guest') !== undefined);

  useEffect(() => {
    let alive = true;
    if (!userId) {
      // A guest has no profile: the area lives on the device, and is known at once.
      readGuestArea()
        .then((saved) => {
          if (!alive) return;
          rememberArea('guest', saved);
          setArea((cur) => (sameArea(cur, saved) ? cur : saved));
        })
        .catch(() => {})
        .finally(() => alive && setLoaded(true));
      return () => {
        alive = false;
      };
    }
    getProfile(userId)
      .then((p) => {
        if (!alive) return;
        setLoaded(true);
        const next = areaFromProfile(p);
        rememberArea(userId, next);
        setArea((cur) => (sameArea(cur, next) ? cur : next));
      })
      .catch(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [userId, tick]);

  // An area picked anywhere else (Home's area bar, the location sheet) shows here at once (owner, 28 Nov: the
  // pill kept saying "Live near you" and the helpers card "Set your area" until the page was opened again).
  useEffect(() => {
    const owner = userId ?? 'guest';
    return onAreaChange((who, next) => {
      if (who !== owner) return;
      setArea((cur) => (sameArea(cur, next) ? cur : next));
      setLoaded(true);
    });
  }, [userId]);

  const choose = useCallback(
    async (picked: PickedPlace) => {
      const next = guestAreaFromPicked(picked);
      if (!next) return flash('Drop a pin on the map to set your area');
      setArea(next);
      rememberArea(userId ?? 'guest', next);
      if (!userId) {
        await saveGuestArea(next);
        return;
      }
      await updateProfile(userId, { locLabel: next.label, locLat: next.lat, locLng: next.lng }).catch((e) =>
        flash(e instanceof Error ? e.message : 'Could not save your area'),
      );
    },
    [userId, flash],
  );

  return { area, loaded, choose };
}
