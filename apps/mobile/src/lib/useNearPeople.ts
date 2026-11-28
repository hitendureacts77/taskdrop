import { useEffect, useState } from 'react';
import type { NearbyWorker } from '../data/extras';
import { activeFirst } from '../components/mapPins';
import { readNearPeople } from './nearReads';
import type { MyArea } from './useMyArea';

/** Hire Home's one distance for every helper figure (the helpers card, the live pill and the desktop panel). */
export const NEAR_PEOPLE_KM = 5;

/**
 * The helpers within NEAR_PEOPLE_KM of the area, active ones first: null while reading (or with no area known yet),
 * [] when there is none or the read failed. One shared read, so two places asking get the same answer.
 */
export function useNearPeople(area: MyArea | null, loaded: boolean): { list: NearbyWorker[] | null; now: number } {
  const [state, setState] = useState<{ list: NearbyWorker[] | null; now: number }>({ list: null, now: Date.now() });
  const lat = area?.lat;
  const lng = area?.lng;

  useEffect(() => {
    if (lat == null || lng == null) {
      setState({ list: loaded ? [] : null, now: Date.now() });
      return;
    }
    let alive = true;
    setState((s) => ({ ...s, list: null }));
    const at = Date.now();
    void readNearPeople({ lat, lng }, NEAR_PEOPLE_KM)
      .then((r) => alive && setState({ list: activeFirst(r, at), now: at }))
      .catch(() => alive && setState({ list: [], now: at }));
    return () => {
      alive = false;
    };
  }, [lat, lng, loaded]);

  return state;
}
