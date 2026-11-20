/**
 * "N new" offers on My tasks (D31 v11, boards MyTasks / WebMyTasks), worked out on this device only: the server
 * keeps no record of which offers a poster has looked at, so the app remembers how many offers each open task had
 * when its offers were last opened here, and calls any above that "new". A convenience, not profile data.
 *
 * Pure, so it runs in Node tests; lib/seenOffersStore.ts keeps the record.
 */

/** Task id -> how many offers it had when they were last opened on this device. */
export type SeenOffers = Record<string, number>;

/**
 * New offers per open task. With no record at all yet (first run, or a fresh device) every current offer counts as
 * seen, so nobody opens My tasks to a wall of "new" for offers they looked at long ago; `seed` is then the record
 * to save. A task first seen after that (posted since) has all of its offers new.
 */
export function newOffers(
  counts: ReadonlyMap<string, number>,
  seen: SeenOffers | null,
): { fresh: Map<string, number>; seed: SeenOffers | null } {
  const fresh = new Map<string, number>();
  if (seen === null) {
    const seed: SeenOffers = {};
    counts.forEach((n, id) => {
      seed[id] = n;
    });
    return { fresh, seed };
  }
  counts.forEach((n, id) => {
    const extra = n - (seen[id] ?? 0);
    if (extra > 0) fresh.set(id, extra);
  });
  return { fresh, seed: null };
}

/** The record after a task's offers were opened with `count` of them; tasks no longer open are dropped. */
export function markSeen(seen: SeenOffers | null, taskId: string, count: number, openIds?: ReadonlySet<string>): SeenOffers {
  const next: SeenOffers = {};
  for (const [id, n] of Object.entries(seen ?? {})) {
    if (!openIds || openIds.has(id)) next[id] = n;
  }
  next[taskId] = Math.max(0, Math.floor(count));
  return next;
}

/** "2 new" (or nothing). */
export function newOffersLabel(n: number | undefined): string | null {
  return n && n > 0 ? `${n} new` : null;
}
