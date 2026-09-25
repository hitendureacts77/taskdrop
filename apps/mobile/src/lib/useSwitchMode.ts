import { useCallback } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useMode, type Mode } from '../providers/ModeProvider';
import { useNav } from '../providers/NavProvider';
import { getProfile } from '../data/api';

/**
 * Switch between Post and Earn. The account and @username are shared, but
 * earning needs a worker profile: the first switch to Earn opens worker
 * setup instead, and only a finished worker profile turns Earn on.
 */
export function useSwitchMode(): (m: Mode) => Promise<void> {
  const { userId } = useAuth();
  const { setMode } = useMode();
  const { go } = useNav();

  return useCallback(
    async (m: Mode) => {
      if (m === 'worker' && userId) {
        const p = await getProfile(userId).catch(() => null);
        if (p && !p.worker_onboarded_at) {
          go('workerSetup');
          return;
        }
      }
      setMode(m);
    },
    [userId, setMode, go],
  );
}
