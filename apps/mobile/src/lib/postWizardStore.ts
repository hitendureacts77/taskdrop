import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { adopt, isStale, validateSnapshot, type WizardSnapshot } from './postWizard';

/**
 * Where the half-made post (lib/postWizard.ts) is kept: on this device
 * (AsyncStorage, which is localStorage on the web, like lib/drafts.ts), plus a
 * copy in memory so the posting screen comes back on the same frame when it is
 * mounted again in the same page session. One snapshot per device; whose it is
 * is inside it (`owner`).
 */

const KEY = 'taskdrop.postWizard.v1';

let memory: WizardSnapshot | null = null;
/** Bumped by every save and clear, so a slow read never brings back something newer writes replaced. */
let generation = 0;

export async function saveWizard(s: WizardSnapshot): Promise<void> {
  memory = s;
  generation++;
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Not kept on the device: the copy in memory still covers this page session.
  }
}

/** The copy in memory, without reading the device (null after a reload until loadWizard runs). */
export function peekWizard(): WizardSnapshot | null {
  return memory;
}

/** The copy in memory, else the one on the device. A stale or unreadable one is removed. */
export async function loadWizard(): Promise<WizardSnapshot | null> {
  if (memory) return memory;
  const gen = generation;
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(KEY);
  } catch {
    return null;
  }
  if (gen !== generation) return memory;
  const s = raw ? validateSnapshot(raw) : null;
  if (!s || isStale(s)) {
    if (raw) void AsyncStorage.removeItem(KEY).catch(() => {});
    return null;
  }
  memory = s;
  return s;
}

export async function clearWizard(): Promise<void> {
  memory = null;
  generation++;
  resumeAskedAt = 0;
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Left behind: it is refused for anyone but its owner and dropped after a week.
  }
}

/** Signed in on this device: a guest's half-made post becomes this account's. Others are left alone. */
export async function adoptGuestWizard(userId: string): Promise<void> {
  if (memory) {
    const next = adopt(memory, userId);
    if (next !== memory) await saveWizard(next);
    return;
  }
  const s = await loadWizard();
  if (s) {
    const next = adopt(s, userId);
    if (next !== s) await saveWizard(next);
  }
}

// ------------------------------------------------------- post when back --

/**
 * A tiny signal meaning "the account now exists: post the request". It is
 * what the guest pop-up runs after sign-in (lib/guest.ts runPendingAfterSignIn),
 * and the posting screen, once it is back, takes it. Not kept across a reload:
 * after one, the screen opens on Review and waits for the tap.
 */
let resumeAskedAt = 0;
let resumeVersion = 0;
const listeners = new Set<() => void>();
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function requestResumeSubmit(): void {
  resumeAskedAt = Date.now();
  resumeVersion++;
  listeners.forEach((l) => l());
}

/** True once per request, and only for a minute after it was made. */
export function takeResumeSubmit(): boolean {
  const fresh = resumeAskedAt > 0 && Date.now() - resumeAskedAt < 60_000;
  resumeAskedAt = 0;
  return fresh;
}

/** Changes whenever a request is made; put it in an effect's dependencies, then takeResumeSubmit(). */
export function useResumeSignal(): number {
  return useSyncExternalStore(subscribe, () => resumeVersion, () => resumeVersion);
}
