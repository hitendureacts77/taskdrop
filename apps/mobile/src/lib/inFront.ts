import { AppState, Platform } from 'react-native';

/** Is the app on screen right now (tab visible / app in the foreground)? */
export function inFront(): boolean {
  if (Platform.OS === 'web') return typeof document === 'undefined' || document.visibilityState === 'visible';
  return AppState.currentState === 'active';
}

/** Call `fn` each time the app comes back in front. Returns a stop function. */
export function onBackInFront(fn: () => void): () => void {
  let offWeb = () => {};
  if (Platform.OS === 'web' && typeof document !== 'undefined') {
    const onVisible = () => {
      if (document.visibilityState === 'visible') fn();
    };
    document.addEventListener('visibilitychange', onVisible);
    offWeb = () => document.removeEventListener('visibilitychange', onVisible);
  }
  const sub = AppState.addEventListener('change', (s) => s === 'active' && fn());
  return () => {
    offWeb();
    sub.remove();
  };
}
