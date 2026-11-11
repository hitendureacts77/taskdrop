import { useCallback, useEffect, useRef, useState } from 'react';
import {
  askToTurnOnLocation,
  locationPermission,
  LocationError,
  resolveCurrentPlace,
} from './location';
import type { LiveStatus } from './locationAsk';

export type LivePlace = { lat: number; lng: number; label: string };

const FRESH_MS = 5 * 60_000;
let cache: { place: LivePlace; at: number } | null = null;

function failureStatus(e: unknown): LiveStatus {
  if (e instanceof LocationError) {
    if (e.kind === 'denied' || e.kind === 'blocked' || e.kind === 'services-off') return e.kind;
  }
  return 'error';
}

/**
 * The device's live position for Explore. Reads quietly when permission is
 * already granted; asks only when locate() is called.
 */
export function useLivePlace(active: boolean): {
  live: LivePlace | null;
  status: LiveStatus;
  /** Asks (system dialog), reads the position. Never throws. Resolves the place, or null with status set. */
  locate: () => Promise<LivePlace | null>;
} {
  const [live, setLive] = useState<LivePlace | null>(null);
  const [status, setStatus] = useState<LiveStatus>('idle');
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  const read = useCallback(async (): Promise<LivePlace> => {
    const p = await resolveCurrentPlace({
      onPartial: (at) => {
        if (alive.current) setLive((cur) => cur ?? { lat: at.lat, lng: at.lng, label: 'Your location' });
      },
    });
    const place: LivePlace = { lat: p.lat as number, lng: p.lng as number, label: p.label };
    cache = { place, at: Date.now() };
    return place;
  }, []);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    void (async () => {
      const fresh = cache && Date.now() - cache.at < FRESH_MS ? cache.place : null;
      if (fresh) {
        setLive(fresh);
        setStatus('granted');
      }
      const perm = await locationPermission();
      if (cancelled || !alive.current) return;
      if (!perm.granted) {
        if (!fresh) setStatus(perm.canAskAgain ? 'prompt' : 'blocked');
        return;
      }
      if (!fresh) setStatus('checking');
      try {
        const place = await read();
        if (cancelled || !alive.current) return;
        setLive(place);
        setStatus('granted');
      } catch (e) {
        if (cancelled || !alive.current) return;
        // A cached or partial fix still stands; only report failure with nothing to show.
        if (!fresh) setStatus((s) => (s === 'checking' ? failureStatus(e) : s));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [active, read]);

  const locate = useCallback(async (): Promise<LivePlace | null> => {
    const attempt = async (): Promise<LivePlace> => {
      const place = await read();
      return place;
    };
    try {
      if (alive.current) setStatus('checking');
      let place: LivePlace;
      try {
        place = await attempt();
      } catch (e) {
        if (e instanceof LocationError && e.kind === 'services-off') {
          if ((await askToTurnOnLocation()) === 'enabled') {
            place = await attempt();
          } else {
            throw e;
          }
        } else {
          throw e;
        }
      }
      if (alive.current) {
        setLive(place);
        setStatus('granted');
      }
      return place;
    } catch (e) {
      if (alive.current) setStatus(failureStatus(e));
      return null;
    }
  }, [read]);

  return { live, status, locate };
}
