import { useEffect } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { ownerMatches, resumable } from '../lib/postWizard';
import { loadWizard } from '../lib/postWizardStore';

/** Screens to wait out before deciding: the way in. */
const WAIT: ScreenName[] = ['splash', 'welcome', 'signup'];

/**
 * The app opened already signed in -- Google's round trip reloads the web app, or the page was
 * reloaded by hand -- shortly after "Post my request" was pressed as a guest: open the posting
 * screen again, on Review, with everything put back (lib/postWizard). It is not posted by itself.
 *
 * Decided once per app start. Sign-in within the same page session is handled by the posting
 * screen itself, and a new account's setup by OnboardingScreen (it opens the post when done).
 * Mounted inside the age gate, so it only runs once the 18+ check has passed.
 */
// Per app start, not per mount: the age gate can unmount and mount this again after a sign-in.
let startedSignedIn: boolean | null = null;
let decided = false;

export function ResumePost() {
  const { session } = useAuth();
  const { screen, go } = useNav();
  // Only an app that started with a session: a sign-in later in this page session is not a restart.
  if (startedSignedIn === null) startedSignedIn = Boolean(session);

  useEffect(() => {
    if (decided) return;
    if (!startedSignedIn || !session) {
      decided = true;
      return;
    }
    if (WAIT.includes(screen)) return;
    decided = true;
    if (screen === 'setup' || screen === 'aiPost') return;
    const userId = session.user.id;
    void loadWizard().then((s) => {
      if (s && resumable(s) && ownerMatches(s, userId)) go('aiPost', { resume: true });
    });
  }, [session, screen, go]);

  return null;
}
