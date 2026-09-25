import { useEffect, useRef } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';

/**
 * When a session ends underneath the app -- signed out elsewhere, or a
 * refresh token that expired -- go back to the start instead of leaving the
 * person on a screen whose every request now fails. Renders nothing.
 */
export function SessionWatch() {
  const { session } = useAuth();
  const { reset } = useNav();
  const had = useRef(Boolean(session));

  useEffect(() => {
    if (had.current && !session) reset('splash');
    had.current = Boolean(session);
  }, [session, reset]);

  return null;
}
