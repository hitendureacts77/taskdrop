import { useEffect, useRef } from 'react';
import { useAuth } from '../providers/AuthProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';

/**
 * When a session ends underneath the app -- signed out elsewhere, or a
 * refresh token that expired -- go back to the start instead of leaving the
 * person on a screen whose every request now fails. Also shows the auth
 * layer's one-off notices (e.g. "that Google account already exists").
 * Renders nothing.
 */
export function SessionWatch() {
  const { session, notice, clearNotice } = useAuth();
  const { reset } = useNav();
  const { flash } = useActions();
  const had = useRef(Boolean(session));

  useEffect(() => {
    if (had.current && !session) reset('splash');
    had.current = Boolean(session);
  }, [session, reset]);

  useEffect(() => {
    if (!notice) return;
    flash(notice);
    clearNotice();
  }, [notice, flash, clearNotice]);

  return null;
}
