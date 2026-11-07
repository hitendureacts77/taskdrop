/**
 * The web's "get the Android app" prompts (design D17): the little event that
 * tells the one-time sheet a visitor has just done something worth interrupting
 * after (their first search, or their first look at a task). Harmless on
 * phones: nothing listens there.
 */

const listeners = new Set<() => void>();

/** Call when the visitor runs a search or opens a task. */
export function noteFirstAction(): void {
  for (const l of [...listeners]) l();
}

export function subscribeFirstAction(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Web only: a full page load, so /get opens before any sign-in; also starts the APK download. */
export function goTo(url: string): void {
  if (typeof window !== 'undefined') window.location.assign(url);
}
