import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';
import { showStagingUi, STAGING_CARD_SEEN_KEY } from '../lib/environment';
import { loadIntroSeen, saveIntroSeen } from '../lib/intro';
import { shouldShowWalkthrough } from '../lib/walkthrough';
import { useAppConfig } from './AppGate';

/**
 * Opens "How TaskDrop works" once per device after sign-in (owner, 26 Nov: sign-in first, then the walkthrough).
 * Mounted once next to StagingWelcome. Renders nothing; the walkthrough is the `intro` screen.
 */
export function WalkthroughHost() {
  const { userId } = useAuth();
  const { screen, go } = useNav();
  const { environment } = useAppConfig();
  const [seen, setSeen] = useState<boolean | null>(null);
  const [stagingClear, setStagingClear] = useState(false);
  // Bumped while the tester card is still open on Home, so closing it is noticed without leaving the screen.
  const [recheck, setRecheck] = useState(0);

  // Read again on every screen change: the tester card may just have been closed, or the walkthrough just seen.
  useEffect(() => {
    let live = true;
    void loadIntroSeen().then((v) => live && setSeen(v));
    if (!showStagingUi(environment)) setStagingClear(true);
    else
      AsyncStorage.getItem(STAGING_CARD_SEEN_KEY)
        .then((v) => live && setStagingClear(v === '1'))
        .catch(() => live && setStagingClear(true));
    return () => {
      live = false;
    };
  }, [screen, environment, recheck]);

  const waiting = Boolean(userId) && seen === false && screen === 'home' && !stagingClear;
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => setRecheck((n) => n + 1), 1500);
    return () => clearInterval(id);
  }, [waiting]);

  const show = shouldShowWalkthrough({ signedIn: Boolean(userId), seen, screen, stagingCardClear: stagingClear });
  useEffect(() => {
    if (!show) return;
    setSeen(true);
    void saveIntroSeen();
    go('intro', { replay: true, walk: true });
  }, [show, go]);

  return null;
}
