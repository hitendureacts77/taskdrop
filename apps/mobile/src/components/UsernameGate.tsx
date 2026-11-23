import { useEffect, useRef } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';
import { getProfile } from '../data/api';
import { GATE_FREE_SCREENS, gateShouldOpen, hasUsername } from '../lib/username';

/** Accounts this app run has seen with a username: never asked about again (a username cannot be removed). */
const known = new Set<string>();

/** Called once a username is saved, so the gate does not reopen over a profile read from before the save. */
export function markUsernameSet(userId: string): void {
  known.add(userId);
}

/**
 * Plan 1.18 (decision 51): a signed-in account with no username always ends on the "Pick a username" page, whatever
 * the way in (an old account, setup left half-way, a guest who backed out of the account setup). Checked on every
 * change of screen until the account is known to have one; sign-in pages, setup and the public pages are left alone
 * (lib/username.ts). The server refuses posting, offers, chat and money without one too. Renders nothing.
 */
export function UsernameGate() {
  const { session } = useAuth();
  const { screen, go } = useNav();
  const userId = session?.user.id ?? null;
  // One page at a time: set while the gate is being opened, cleared once it is in front.
  const opening = useRef(false);

  useEffect(() => {
    opening.current = false;
  }, [userId]);

  useEffect(() => {
    if (screen === 'pickUsername') opening.current = false;
    if (!userId || known.has(userId) || opening.current || GATE_FREE_SCREENS.includes(screen)) return;
    let alive = true;
    void getProfile(userId)
      .then((p) => {
        if (hasUsername(p)) {
          known.add(userId);
          return;
        }
        if (!alive || opening.current || !gateShouldOpen(screen, p)) return;
        opening.current = true;
        go('pickUsername');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [userId, screen, go]);

  return null;
}
