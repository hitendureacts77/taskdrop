import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from './AuthProvider';
import { subscribeToNotifications } from '../data/extras';

/**
 * "Something changed on the server" -- one number that goes up.
 *
 * An admin (or the other party, or a webhook) changes data the signed-in person
 * is looking at: a payout is settled, a dispute decided, a refund lands, a fee
 * changes. Every such change writes a notification for that person
 * (migration 076 closed the last gaps), and notifications are delivered live.
 * Each one nudges this counter, so a screen that already refetches when
 * useFocusTick() changes -- wallet, feed, my tasks, profile -- picks the change
 * up without anyone pulling to refresh.
 *
 * It also goes up when the app returns to the foreground (on the web that is
 * the tab becoming visible again), which covers a connection that dropped while
 * the app was in the background.
 *
 * Bursts are coalesced: one admin action can write several notifications, and
 * that should cost one refetch, not several.
 */
const SyncCtx = createContext(0);

const COALESCE_MS = 400;

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const [version, setVersion] = useState(0);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!userId) return;

    const bump = () => {
      if (pending.current) return;
      pending.current = setTimeout(() => {
        pending.current = null;
        setVersion((v) => v + 1);
      }, COALESCE_MS);
    };

    const unsubscribe = subscribeToNotifications(userId, bump);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') bump();
    });

    return () => {
      unsubscribe();
      appState.remove();
      if (pending.current) {
        clearTimeout(pending.current);
        pending.current = null;
      }
    };
  }, [userId]);

  return <SyncCtx.Provider value={version}>{children}</SyncCtx.Provider>;
}

/** Goes up by one each time the server says something changed for this person. */
export function useSyncVersion(): number {
  return useContext(SyncCtx);
}
