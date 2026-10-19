import { useEffect, useState } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import { countNeedsAttention } from '../data/api';

/**
 * How many things are actually waiting on this person (the badge on My Tasks /
 * My Work). Re-read whenever `refreshOn` changes, which should be the moment
 * the answer can have changed: the screen they just moved to.
 */
export function useWaitingCount(refreshOn: unknown): number {
  const { userId } = useAuth();
  const { mode } = useMode();
  const [waiting, setWaiting] = useState(0);
  useEffect(() => {
    if (!userId) {
      setWaiting(0);
      return;
    }
    let alive = true;
    countNeedsAttention(userId, mode === 'worker' ? 'worker' : 'poster')
      .then((n) => alive && setWaiting(n))
      .catch(() => {
        // The badge is a hint: better none than the last person's or mode's count.
        if (alive) setWaiting(0);
      });
    return () => {
      alive = false;
    };
  }, [userId, mode, refreshOn]);
  return waiting;
}
