import { useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import { getMapSharing } from '../data/extras';
import { inFront, onBackInFront } from './inFront';
import { locationPermission } from './location';
import {
  BEAT_EVERY_MS,
  SPOT_TTL_MS,
  shouldBeat,
  snapCell,
  type Cell,
  type LastBeat,
} from './mapSpot';

/**
 * "Show my spot to my people" (design D20), the device half.
 *
 * Privacy rules kept here:
 *  - Only the FOREGROUND location permission is ever asked for, and only when the person turns
 *    sharing on (setSharing(true)). Never at start-up, never background permission.
 *  - The position is read only while sharing is on AND the app is in front.
 *  - The raw position is snapped to the 0.005-degree grid (lib/mapSpot.ts) the moment it is read.
 *    The raw numbers are never stored in the module state, never returned, never logged; only the
 *    snapped cell leaves this file.
 *
 * Saving the choice on the server (extras.setMapSharing / clearMapSpot) is the caller's job: call
 * setSharing(true) first and save only when it answers 'on'; on turning off, call setSharing(false)
 * and then setMapSharing(false) (the server deletes the spot).
 */

type State = {
  sharing: boolean;
  /** The latest snapped cell, or null before the first read. */
  cell: Cell | null;
  /** When `cell` was read (ms). */
  readAt: number;
};

let state: State = { sharing: false, cell: null, readAt: 0 };
/** What the last beat sent, for the throttle (shouldBeat). */
let lastBeat: LastBeat = null;
/** The value of lastBeat before the most recent nextSpot() commit, so a skipped send can be undone. */
let beforeCommit: LastBeat = null;

const listeners = new Set<() => void>();
/** The hook's snapshot: a new object only when something the UI shows changed. */
let snapshot: { sharing: boolean; cell: Cell | null } = { sharing: false, cell: null };

function publish(next: Partial<State>): void {
  state = { ...state, ...next };
  if (snapshot.sharing !== state.sharing || snapshot.cell !== state.cell) {
    snapshot = { sharing: state.sharing, cell: state.cell };
    listeners.forEach((l) => l());
  }
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Is sharing on, and which cell is the person in? Re-renders when either changes. */
export function useMapSharing(): { sharing: boolean; cell: Cell | null } {
  return useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
}

/** Is sharing on right now (non-reactive, for plain code)? */
export const isSharing = (): boolean => state.sharing;

// --------------------------------------------------------------- reading ----

const READ_TIMEOUT_MS = 15_000;
let reading = false;
let timer: ReturnType<typeof setInterval> | null = null;
let offFront: (() => void) | null = null;

async function readOnce(): Promise<void> {
  if (!state.sharing || !inFront() || reading) return;
  reading = true;
  try {
    const pos = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), READ_TIMEOUT_MS)),
    ]);
    // Sharing may have been switched off while waiting: drop the reading unseen.
    if (!pos || !state.sharing) return;
    const cell = snapCell(pos.coords.latitude, pos.coords.longitude);
    if (cell) publish({ cell, readAt: Date.now() });
  } catch {
    // No fix this time (permission taken away, services off, timeout). Keep the old cell; it goes
    // stale by itself. Nothing is logged: errors here must never carry a position.
  } finally {
    reading = false;
  }
}

function startReading(): void {
  if (timer) return;
  void readOnce();
  timer = setInterval(() => void readOnce(), BEAT_EVERY_MS);
  offFront = onBackInFront(() => {
    // Back in front after a while: refresh at once if the cell is old.
    if (Date.now() - state.readAt >= BEAT_EVERY_MS) void readOnce();
  });
}

function stopReading(): void {
  if (timer) clearInterval(timer);
  timer = null;
  offFront?.();
  offFront = null;
}

// ---------------------------------------------------------------- control ---

export type SharingResult =
  | 'on'
  | 'off'
  /** The person said no to the location prompt (they can be asked again later). */
  | 'denied'
  /** Location is blocked for TaskDrop; only device or browser settings can undo it. */
  | 'blocked'
  /** Location is switched off for the whole device. */
  | 'services-off'
  | 'unavailable';

/**
 * Turn sharing on or off on this device.
 * On: asks the FOREGROUND permission if it is not granted yet (this is the only place that ever
 * asks), then starts reading. Answers 'on', or why not; when it does not answer 'on', sharing stays off.
 * Off: stops reading and forgets the cell at once.
 */
export async function setSharing(on: boolean): Promise<SharingResult> {
  if (!on) {
    stopReading();
    lastBeat = null;
    beforeCommit = null;
    publish({ sharing: false, cell: null, readAt: 0 });
    return 'off';
  }
  if (state.sharing) return 'on';
  try {
    const have = await locationPermission();
    if (!have.granted) {
      if (!have.canAskAgain) return 'blocked';
      const asked = await Location.requestForegroundPermissionsAsync();
      if (!asked.granted) return asked.canAskAgain ? 'denied' : 'blocked';
    }
    try {
      if (!(await Location.hasServicesEnabledAsync())) return 'services-off';
    } catch {
      // Not reliable on every platform; not a reason to stop.
    }
  } catch {
    return 'unavailable';
  }
  publish({ sharing: true });
  startReading();
  return 'on';
}

/**
 * After sign-in: restore the saved choice from the server. If it was on AND the foreground
 * permission is already granted, sharing resumes quietly. This NEVER shows a permission prompt;
 * with no permission the device stays off until the person turns it on again in settings.
 * Returns whether sharing is on afterwards.
 */
export async function initMapSharing(): Promise<boolean> {
  const saved = await getMapSharing();
  if (!saved?.share_live) {
    await setSharingQuietly(false);
    return false;
  }
  const have = await locationPermission();
  if (!have.granted) {
    await setSharingQuietly(false);
    return false;
  }
  if (!state.sharing) {
    publish({ sharing: true });
    startReading();
  }
  return true;
}

/** Sign-out or account switch: stop reading and forget everything. */
export function resetMapSharing(): void {
  void setSharingQuietly(false);
}

async function setSharingQuietly(on: boolean): Promise<void> {
  if (!on && (state.sharing || timer)) await setSharing(false);
}

// ------------------------------------------------------------------- beat ---

/**
 * The cell to send with the next presence beat, or null (sharing off, app not in front, no fresh
 * reading yet, or sent too recently: see shouldBeat). Returning a cell counts it as sent. If the
 * send was then skipped, call releaseSpot() so the next beat tries again.
 */
export function nextSpot(): Cell | null {
  if (!state.sharing || !inFront() || !state.cell) return null;
  const now = Date.now();
  // A reading older than the spot lifetime is not "where I am" any more.
  if (now - state.readAt >= SPOT_TTL_MS) return null;
  if (!shouldBeat(lastBeat, state.cell, now)) return null;
  beforeCommit = lastBeat;
  lastBeat = { cell: state.cell, at: now };
  return { lat: state.cell.lat, lng: state.cell.lng };
}

/** Undo the last nextSpot() when its request was not made (throttled), so the spot is not skipped. */
export function releaseSpot(): void {
  lastBeat = beforeCommit;
}
