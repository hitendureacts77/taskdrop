/**
 * The memory of signed photo links (lib/media.ts), kept per person (plan task 3.5b, hole H69).
 *
 * Signing mints a new token each time, and a new token is a new URL, so a link is reused until
 * shortly before it expires. Every key starts with the signed-in person (or the guest marker), and the
 * whole memory is emptied with the app's others on sign-in, sign-out, an account switch or an account
 * deletion (lib/freshness.ts). While nobody is known yet, nothing is kept.
 *
 * No imports at all on purpose, so this can be tested from Node: lib/media.ts builds the one memory
 * with lib/freshness.ts's person, wipe count and wipe hook (makeLinkMemory).
 */
export type LinkSize = 'thumb' | 'card' | 'full';

/** What a link memory needs from lib/freshness.ts. */
export type LinkMemoryDeps = {
  personKey: () => string | null;
  wipeCount: () => number;
  onForget: (fn: () => void) => unknown;
};

/** What to hand back when a link signed earlier arrives: a wipe in between means it is not kept. */
export type Keeper = (path: string, url: string, now?: number) => void;

export function makeLinkMemory({ personKey, wipeCount, onForget }: LinkMemoryDeps) {
  const signed = new Map<string, { url: string; at: number }>();
  const pending = new Map<string, Promise<string | null>>();

  onForget(() => {
    signed.clear();
    pending.clear();
  });

  /** The key for one picture at one size for the person signed in now, or null while nobody is known. */
  function linkKey(path: string, size: LinkSize): string | null {
    const who = personKey();
    return who === null ? null : `${who}|${size}|${path}`;
  }

  /** A link for this person still under `reuseMs` old, or null. */
  function cachedLink(path: string, size: LinkSize, reuseMs: number, now = Date.now()): string | null {
    const key = linkKey(path, size);
    if (key === null) return null;
    const hit = signed.get(key);
    return hit && now - hit.at < reuseMs && now >= hit.at ? hit.url : null;
  }

  /** A keeper for links asked for now, at `size`, for the person signed in now. */
  function keeperFor(size: LinkSize): Keeper {
    const wipesAtStart = wipeCount();
    const who = personKey();
    return (path, url, now = Date.now()) => {
      if (who === null || wipeCount() !== wipesAtStart || personKey() !== who) return;
      signed.set(`${who}|${size}|${path}`, { url, at: now });
    };
  }

  /** One signing in flight per person, picture and size: a second ask joins the first. */
  function joinPending(key: string | null, start: () => Promise<string | null>): Promise<string | null> {
    if (key === null) return start();
    const inFlight = pending.get(key);
    if (inFlight) return inFlight;
    const p = start().finally(() => {
      if (pending.get(key) === p) pending.delete(key);
    });
    pending.set(key, p);
    return p;
  }

  /** How many links are remembered (for tests). */
  function linkCount(): number {
    return signed.size;
  }

  return { linkKey, cachedLink, keeperFor, joinPending, linkCount };
}
