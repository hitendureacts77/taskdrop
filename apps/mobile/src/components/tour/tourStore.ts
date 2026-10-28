import AsyncStorage from '@react-native-async-storage/async-storage';
import { offersEarningSide, TOUR_SEEN_KEY, tourPathFor, type TourPath } from '../../lib/tour';

/**
 * What the tour is doing right now, outside React so the onboarding screen and
 * the account menu can start it without a provider in between. TourHost reads it.
 *
 *   pendingIntent  onboarding just finished; offer the tour once when Home is up
 *   run            the tour is on screen
 */
export type TourRun = { path: TourPath; withEarning: boolean };
type State = { pendingIntent: string | null; run: TourRun | null };

let state: State = { pendingIntent: null, run: null };
const listeners = new Set<() => void>();
const set = (next: State) => {
  state = next;
  listeners.forEach((l) => l());
};

export const subscribeTour = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const getTourState = () => state;

/** Onboarding finished: offer the tour once, on Home. Does nothing if this device has seen it. */
export function requestTourOffer(intent: string): void {
  set({ ...state, pendingIntent: intent });
}

export function clearTourOffer(): void {
  if (state.pendingIntent !== null) set({ ...state, pendingIntent: null });
}

/** Start the tour (from the offer, or "Take the app tour" in the account menu). */
export function startTour(path: TourPath, withEarning = false): void {
  set({ pendingIntent: null, run: { path, withEarning } });
}

/** Start from the onboarding answer. */
export function startTourFor(intent: string): void {
  startTour(tourPathFor(intent), offersEarningSide(intent));
}

export function endTour(): void {
  set({ ...state, run: null });
}

/** This device has been offered the tour; it is not offered again by itself. */
export function markTourSeen(): void {
  AsyncStorage.setItem(TOUR_SEEN_KEY, '1').catch(() => {
    /* the tour is simply offered again next time */
  });
}

/** null while unknown. If storage cannot be read the tour is treated as seen: never nag. */
export async function readTourSeen(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(TOUR_SEEN_KEY)) === '1';
  } catch {
    return true;
  }
}
