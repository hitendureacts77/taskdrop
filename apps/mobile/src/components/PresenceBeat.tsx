import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '../providers/AuthProvider';
import { touchPresence } from '../data/extras';
import { inFront } from '../lib/inFront';
import { initMapSharing, nextSpot, releaseSpot, resetMapSharing } from '../lib/useMapSpot';

const BEAT_MS = 60_000;

/**
 * Keeps "Active now" true while TaskDrop is open and in front: writes
 * last_seen_at once a minute, and straight away on coming back. When the app
 * is closed or in the background the beats stop, and others see "Away · N min".
 * If the person chose "Show my spot to my people", the beat also carries their
 * snapped map cell (never an exact position); with sharing off it carries nothing extra.
 * Renders nothing.
 */
export function PresenceBeat() {
  const { userId } = useAuth();

  useEffect(() => {
    if (!userId) {
      resetMapSharing();
      return;
    }
    // Restore the saved choice (never prompts for permission).
    void initMapSharing();
    const beat = () => {
      if (!inFront()) return;
      const spot = nextSpot();
      void touchPresence(userId, spot).then((sent) => {
        if (spot && !sent) releaseSpot();
      });
    };
    beat();
    const id = setInterval(beat, BEAT_MS);

    let offWeb = () => {};
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', beat);
      offWeb = () => document.removeEventListener('visibilitychange', beat);
    }
    const sub = AppState.addEventListener('change', (s) => s === 'active' && beat());

    return () => {
      clearInterval(id);
      offWeb();
      sub.remove();
    };
  }, [userId]);

  return null;
}
