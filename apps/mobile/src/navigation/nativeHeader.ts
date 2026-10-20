import { createContext } from 'react';
import type { ScreenName } from '../providers/navTypes';

/**
 * Pushed screens that show the system's own header (back arrow, title and a
 * right-hand control) on iOS and Android, in place of the in-page row. TopBar
 * and BackButton (components/kit.tsx) fill it in; the web keeps the in-page row.
 * Left out on purpose: sign-in, onboarding and the AI post (their own close or
 * step controls), and screens that have no back control today.
 */
export const NATIVE_HEADER_SCREENS: readonly ScreenName[] = [
  'account',
  'active',
  'analytics',
  'chat',
  'compare',
  'copyright',
  'disputes',
  'escrow',
  'help',
  'ticket',
  'inbox',
  'listing',
  'myQuotes',
  'notifications',
  'postDetails',
  'pricing',
  'privacy',
  'promote',
  'support',
  'terms',
  'profileEdit',
  'publicProfile',
  'saved',
  'spending',
  'swipe',
  'taskDetail',
  'taskManage',
  'withdraw',
  'workerSetup',
];

/** True under a screen whose header is the system's: Screen then skips its own top inset, the header already clears the status bar. */
export const NativeHeaderCtx = createContext(false);
