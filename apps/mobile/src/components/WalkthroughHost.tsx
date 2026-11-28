import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';
import { showStagingUi, STAGING_CARD_SEEN_KEY } from '../lib/environment';
import { loadIntroSeen } from '../lib/intro';
import { shouldShowWalkthrough, stagingCardIsClear, walkSeenKey } from '../lib/walkthrough';
import { useAppConfig } from './AppGate';

/**
 * Opens "How TaskDrop works" by itself on Home, once for each person on each device: the first start as a guest, a
 * brand-new account's first sign-in, and an account's first sign-in on this device (owner, 27 + 28 Nov; never on the
 * sign-in page). Renders nothing; the walkthrough is the `intro` screen.
 *
 * It must sit INSIDE AgeGate, next to the screens (App.tsx, NativeRoot): AgeGate swaps the screens out while it
 * checks a signed-in person's age, and on a phone that unmounts the native stack, so an open sent then was lost.
 * The "seen" mark is written by IntroScreen once it is really on screen, never here, so a lost open simply tries
 * again on the next visit to Home.
 */
export function WalkthroughHost() {
  const { userId, guest } = useAuth();
  const entered = Boolean(userId) || guest;
  const seenKey = walkSeenKey({ userId, guest });
  const { screen, go } = useNav();
  const { environment } = useAppConfig();
  const [seen, setSeen] = useState<boolean | null>(null);
  // What this device remembers about the tester card (null until read). Whether the card still blocks is worked out below.
  const [storedSeen, setStoredSeen] = useState<boolean | null>(null);
  // Bumped while the tester card is still open on Home, so closing it is noticed without leaving the screen.
  const [recheck, setRecheck] = useState(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read again on every screen change and sign-in change: the tester card may just have been closed, or the
  // walkthrough just seen (or another person just came in).
  useEffect(() => {
    let live = true;
    setSeen(null);
    if (seenKey) void loadIntroSeen(seenKey).then((v) => live && setSeen(v));
    AsyncStorage.getItem(STAGING_CARD_SEEN_KEY)
      .then((v) => live && setStoredSeen(v === '1'))
      .catch(() => live && setStoredSeen(true));
    return () => {
      live = false;
    };
  }, [screen, environment, recheck, seenKey]);

  // The tester card is only ever shown to a signed-in person (StagingWelcome), so a guest has none to wait for.
  const stagingClear = stagingCardIsClear({ stagingUi: showStagingUi(environment), signedIn: Boolean(userId), storedSeen });

  const waiting = entered && seen === false && screen === 'home' && !stagingClear;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setRecheck((n) => n + 1), 1500);
    return () => clearInterval(id);
  }, [waiting]);

  // At most two tries per person per app run, so a store that cannot write can never make it open again and again.
  const tries = useRef<Record<string, number>>({});
  const show = shouldShowWalkthrough({ entered, seen, screen, stagingCardClear: stagingClear, tries: tries.current[seenKey ?? ''] ?? 0 });
  useEffect(() => {
    if (!show) return;
    // Not again from this Home visit; IntroScreen writes the stored mark when it opens.
    setSeen(true);
    const k = seenKey ?? '';
    tries.current[k] = (tries.current[k] ?? 0) + 1;
    try {
      go('intro', { replay: true });
    } catch {
      // The phone navigator was not ready: nothing was stored, so it tries again below.
    }
    // Read the stored mark again shortly: if the open was dropped (still on Home, nothing stored), it opens again.
    // (Not cleared when `show` turns false, which happens at once; only when this host goes away.)
    if (retry.current) clearTimeout(retry.current);
    retry.current = setTimeout(() => setRecheck((n) => n + 1), 2000);
  }, [show, go, seenKey]);
  useEffect(() => () => {
    if (retry.current) clearTimeout(retry.current);
  }, []);

  return null;
}
