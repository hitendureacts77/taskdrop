/**
 * The website's cookie / crash-report choice. Web only: the Android app does not use this.
 *
 * Stored in localStorage under `taskdrop.consent.v1` as { analytics, at, v: 1 }. Nothing here touches
 * the DOM or React Native, so it can be tested on its own. Every storage access is wrapped, so a
 * browser that blocks storage simply behaves as "essential only" and shows the bar each visit.
 */

export const CONSENT_KEY = 'taskdrop.consent.v1';

export type Consent = { analytics: boolean; at: string; v: 1 };

type Store = Pick<Storage, 'getItem' | 'setItem'>;

function defaultStore(): Store | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Turns stored text into a choice, or null when it is missing or not ours. */
export function parseConsent(raw: string | null | undefined): Consent | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Partial<Consent> | null;
    if (!o || typeof o !== 'object' || o.v !== 1 || typeof o.analytics !== 'boolean') return null;
    return { analytics: o.analytics, at: typeof o.at === 'string' ? o.at : '', v: 1 };
  } catch {
    return null;
  }
}

/** The saved choice, or null if the person has not chosen yet (or storage is unavailable). */
export function readConsent(store: Store | null = defaultStore()): Consent | null {
  try {
    return parseConsent(store?.getItem(CONSENT_KEY));
  } catch {
    return null;
  }
}

type Listener = (c: Consent | null) => void;
const listeners = new Set<Listener>();
// Kept in memory too, so a choice made while storage is blocked still holds for this visit.
let memory: Consent | null = null;

/** The current choice: memory first (set this visit), then storage. */
export function currentConsent(store: Store | null = defaultStore()): Consent | null {
  return memory ?? readConsent(store);
}

/** Whether optional crash reporting is allowed right now. */
export function analyticsAllowed(store: Store | null = defaultStore()): boolean {
  return currentConsent(store)?.analytics === true;
}

/** Saves the choice and tells everyone listening. Returns what was saved. */
export function writeConsent(analytics: boolean, store: Store | null = defaultStore(), now: Date = new Date()): Consent {
  const c: Consent = { analytics, at: now.toISOString(), v: 1 };
  memory = c;
  try {
    store?.setItem(CONSENT_KEY, JSON.stringify(c));
  } catch {
    /* storage blocked: the choice still holds until the page is closed */
  }
  for (const l of [...listeners]) {
    try {
      l(c);
    } catch {
      /* one bad listener must not stop the rest */
    }
  }
  return c;
}

/** Calls `fn` whenever the choice changes. Returns the way to stop. */
export function subscribeConsent(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** For tests only: forget the in-memory choice and listeners. */
export function resetConsentForTests(): void {
  memory = null;
  listeners.clear();
}
