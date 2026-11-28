import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';
import { showStagingUi, STAGING_CARD_SEEN_KEY } from '../lib/environment';
import { loadIntroSeen, saveIntroSeen } from '../lib/intro';
import { shouldShowWalkthrough, stagingCardIsClear } from '../lib/walkthrough';
import { useAppConfig } from './AppGate';

/**
 * Opens "How TaskDrop works" once per device on Home, right after a new sign-in or "Continue as guest" (owner, 27 Nov:
 * sign-in or guest first, then the walkthrough; never on the sign-in page).
 * Mounted once next to StagingWelcome. Renders nothing; the walkthrough is the `intro` screen.
 */
export function WalkthroughHost() {
  const { userId, guest } = useAuth();
  const entered = Boolean(userId) || guest;
  const { screen, go } = useNav();
  const { environment } = useAppConfig();
  const [seen, setSeen] = useState<boolean | null>(null);
  // What this device remembers about the tester card (null until read). Whether the card still blocks is worked out below.
  const [storedSeen, setStoredSeen] = useState<boolean | null>(null);
  // Bumped while the tester card is still open on Home, so closing it is noticed without leaving the screen.
  const [recheck, setRecheck] = useState(0);

  // Read again on every screen change: the tester card may just have been closed, or the walkthrough just seen.
  useEffect(() => {
    let live = true;
    void loadIntroSeen().then((v) => live && setSeen(v));
    AsyncStorage.getItem(STAGING_CARD_SEEN_KEY)
      .then((v) => live && setStoredSeen(v === '1'))
      .catch(() => live && setStoredSeen(true));
    return () => {
      live = false;
    };
  }, [screen, environment, recheck]);

  // The tester card is only ever shown to a signed-in person (StagingWelcome), so a guest has none to wait for.
  const stagingClear = stagingCardIsClear({ stagingUi: showStagingUi(environment), signedIn: Boolean(userId), storedSeen });

  const waiting = entered && seen === false && screen === 'home' && !stagingClear;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setRecheck((n) => n + 1), 1500);
    return () => clearInterval(id);
  }, [waiting]);

  const show = shouldShowWalkthrough({ entered, seen, screen, stagingCardClear: stagingClear });
  useEffect(() => {
    if (!show) return;
    setSeen(true);
    void saveIntroSeen();
    go('intro', { replay: true });
  }, [show, go]);

  return null;
}
