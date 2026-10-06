import { useEffect, useRef } from 'react';
import { useNav } from '../providers/NavProvider';
import { clearIncomingPage, incomingPage } from '../lib/links';

/**
 * A public page linked from outside (?page=copyright, terms, privacy) opens
 * over wherever the app starts, so Back still lands somewhere -- signed out,
 * that is the splash and then the way in. It sits outside AgeGate and
 * ScreenHost on purpose: those pages must open even for an account the age
 * check is still holding back. Renders nothing.
 */
export function PublicPageLink() {
  const { go } = useNav();
  const handled = useRef(false);
  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const page = incomingPage();
    if (!page) return;
    clearIncomingPage();
    go(page);
  }, [go]);
  return null;
}
