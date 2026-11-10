import { useEffect, useMemo, useState } from 'react';
import { myBidTaskIds } from '../data/api';

/**
 * Which tasks the signed-in worker has already sent an offer on, so a card can say "Edit offer" instead of
 * "Apply". One offer per task is enforced by the server; this is only the label.
 *
 * Kept per account in memory for the life of the app: ids already known are not asked again, and an offer
 * sent from the sheet is noted at once (noteMyOffer), so the card flips without waiting for a reload.
 */

const known = new Map<string, Set<string>>();
/** Ids asked about that came back without an offer, so a list is not re-asked for the same cards. */
const checked = new Map<string, Set<string>>();
const listeners = new Set<() => void>();
let currentUser: string | null = null;

const emit = () => listeners.forEach((fn) => fn());

/** Remember that this account now has an offer on the task. */
export function noteMyOffer(userId: string | null | undefined, taskId: string): void {
  if (!userId) return;
  let set = known.get(userId);
  if (!set) known.set(userId, (set = new Set()));
  if (!set.has(taskId)) {
    set.add(taskId);
    emit();
  }
}

const EMPTY: ReadonlySet<string> = new Set();
/** Sample cards carry ids like "w1"; only real tasks can have an offer. */
const UUID = /^[0-9a-f-]{36}$/i;

export function useMyOffers(userId: string | null, taskIds: readonly string[], enabled = true): ReadonlySet<string> {
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const fn = () => setVersion((v) => v + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  // A different account on this device starts clean.
  useEffect(() => {
    if (currentUser !== null && currentUser !== userId) {
      known.delete(currentUser);
      checked.delete(currentUser);
    }
    currentUser = userId;
  }, [userId]);

  const key = taskIds.join('|');
  useEffect(() => {
    if (!enabled || !userId || !key) return;
    let seen = checked.get(userId);
    if (!seen) checked.set(userId, (seen = new Set()));
    const unseen = key.split('|').filter((id) => UUID.test(id) && !seen!.has(id));
    if (unseen.length === 0) return;
    let alive = true;
    void (async () => {
      for (let i = 0; i < unseen.length; i += 100) {
        const batch = unseen.slice(i, i + 100);
        const mine = await myBidTaskIds(batch);
        if (!alive) return;
        let mark = known.get(userId);
        if (!mark) known.set(userId, (mark = new Set()));
        for (const id of batch) seen!.add(id);
        for (const id of mine) mark.add(id);
      }
      if (alive) setVersion((v) => v + 1);
    })();
    return () => {
      alive = false;
    };
  }, [enabled, userId, key]);

  return useMemo(() => (enabled && userId ? new Set(known.get(userId)) : EMPTY), [enabled, userId, version]);
}
