import { createContext } from 'react';
import type { ScreenName } from '../providers/navTypes';

/**
 * Pushed screens that show the system's own header (back arrow and title) on
 * iOS and Android, in place of the in-page TopBar row. TopBar fills in the
 * title and the right-hand control; the web keeps the in-page row.
 */
export const NATIVE_HEADER_SCREENS: readonly ScreenName[] = [
  'account',
  'copyright',
  'disputes',
  'help',
  'ticket',
  'inbox',
  'listing',
  'notifications',
  'pricing',
  'privacy',
  'terms',
  'profileEdit',
  'publicProfile',
  'saved',
  'spending',
  'taskManage',
  'workerSetup',
];

/** True under a screen whose header is the system's: Screen then skips its own top inset, the header already clears the status bar. */
export const NativeHeaderCtx = createContext(false);
