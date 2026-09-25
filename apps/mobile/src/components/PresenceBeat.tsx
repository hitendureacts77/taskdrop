import { useEffect } from 'react';
import { AppState, Platform } from 'react-native';
import { useAuth } from '../providers/AuthProvider';
import { touchPresence } from '../data/extras';

const BEAT_MS = 60_000;

/** Is the app on screen right now (tab visible / app in the foreground)? */
function inFront(): boolean {
  if (Platform.OS === 'web') return typeof document === 'undefined' || document.visibilityState === 'visible';
  return AppState.currentState === 'active';
}

/**
 * Keeps "Active now" true while TaskDrop is open and in front: writes
 * last_seen_at once a minute, and straight away on coming back. When the app
 * is closed or in the background the beats stop, and others see "Away · N min".
 * Renders nothing.
 */
export function PresenceBeat() {
  const { userId } = useAuth();

  useEffect(() => {
    if (!userId) return;
    const beat = () => {
      if (inFront()) void touchPresence(userId);
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
