import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getMoneyMode, type MoneyMode } from '../data/api';
import { useAuth } from '../providers/AuthProvider';
import { useFocusTick } from '../providers/NavProvider';
import { setPlanB } from './moneyFlow';

/**
 * Which money flow is on (migration 195, `my_money_mode`): `wallet` is today's wallet,
 * `plan_b` is pay per task with the payment company holding the money. Kept for the
 * session, shared by every screen, and asked again whenever a screen comes back into
 * view. A failed or signed-out read means `wallet`, so nothing changes by accident.
 * The server decides every money rule either way; this only picks what to draw.
 */
type State = { forUser: string | null; mode: MoneyMode | null; loaded: boolean };

let state: State = { forUser: null, mode: null, loaded: false };
const listeners = new Set<() => void>();
let inflight: Promise<void> | null = null;

function set(next: State) {
  state = next;
  setPlanB(next.mode?.flow === 'plan_b');
  for (const l of listeners) l();
}

async function load(userId: string): Promise<void> {
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const mode = await getMoneyMode();
      if (state.forUser === userId) set({ forUser: userId, mode, loaded: true });
    } catch {
      // Keep what we had; the first failure settles on "wallet" so nothing waits forever.
      if (state.forUser === userId && !state.loaded) set({ forUser: userId, mode: null, loaded: true });
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

export type MoneyModeView = {
  mode: MoneyMode | null;
  /** False until the first answer for this person. */
  loaded: boolean;
  planB: boolean;
  refresh: () => Promise<void>;
};

export function useMoneyMode(): MoneyModeView {
  const { userId, guest } = useAuth();
  const focusTick = useFocusTick();
  const snap = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => void listeners.delete(cb);
    },
    () => state,
    () => state,
  );

  const who = guest ? null : userId ?? null;
  const refresh = useCallback(async () => {
    if (!who) return;
    if (state.forUser !== who) set({ forUser: who, mode: null, loaded: false });
    await load(who);
  }, [who]);

  useEffect(() => {
    if (!who) {
      if (state.forUser !== null) set({ forUser: null, mode: null, loaded: true });
      return;
    }
    void refresh();
  }, [who, focusTick, refresh]);

  const mine = snap.forUser === who;
  const mode = mine ? snap.mode : null;
  return {
    mode,
    loaded: who === null ? true : mine && snap.loaded,
    planB: mode?.flow === 'plan_b',
    refresh,
  };
}
