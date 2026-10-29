/**
 * Whether what the app read a moment ago can still stand.
 *
 * Tabs refresh quietly when they come back into view, and the header and the
 * tab bar recount their badges on every screen change. Coming back a few
 * seconds after leaving, with nothing changed since, asked the server for
 * exactly what was already on screen: a whole Home, a dozen reads, for a peek
 * at one task.
 *
 * "Nothing changed" is something the app can know. Every change this person
 * makes goes through a write (lib/gateway.ts), and every change someone else
 * makes for them arrives as a live ping (lib/live.ts, SyncProvider). So an
 * answer is reused while it is under FRESH_FOR_MS old and no write, ping or
 * sign-in has happened since. After any of those, or half a minute, the
 * server is asked again, exactly as before.
 *
 * No React Native imports on purpose, so this can be tested from Node.
 */
export const FRESH_FOR_MS = 30_000;

let changes = 0;

/** Something may have changed: this person wrote, the server pinged, or someone signed in or out. */
export function noteChange(): void {
  changes += 1;
}

/** When something was read, and how many changes the app had seen by then. */
export type Stamp = { at: number; changes: number };

export function stamp(now = Date.now()): Stamp {
  return { at: now, changes };
}

/** Read under FRESH_FOR_MS ago, with no change since. */
export function isFresh(s: Stamp | null | undefined, now = Date.now()): boolean {
  if (!s || s.changes !== changes) return false;
  const age = now - s.at;
  return age >= 0 && age < FRESH_FOR_MS;
}

const recent = new Map<string, { stamp: Stamp; answer: Promise<unknown> }>();

/** The last answer for `key` while it is fresh, otherwise a new one from `ask`. A failed ask is never kept. */
export function reuseWhileFresh<T>(key: string, ask: () => Promise<T>, now = Date.now()): Promise<T> {
  const hit = recent.get(key);
  if (hit && isFresh(hit.stamp, now)) return hit.answer as Promise<T>;
  const answer = ask();
  const entry = { stamp: stamp(now), answer };
  recent.set(key, entry);
  answer.catch(() => {
    if (recent.get(key) === entry) recent.delete(key);
  });
  return answer;
}
