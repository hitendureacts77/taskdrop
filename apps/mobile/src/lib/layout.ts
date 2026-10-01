import { Platform, useWindowDimensions } from 'react-native';

/**
 * Phone layout or desktop layout, from one codebase.
 *
 * Android and iOS are always the phone layout. On the web it depends on the
 * window: a phone browser (or a narrow window) gets exactly the app, and a
 * desktop browser gets the desktop layout — sidebar, wide content, grids,
 * dialogs instead of bottom sheets. Resizing the window switches live.
 */

/** From this browser width up, the web build lays out for a desktop. */
export const DESKTOP_MIN_WIDTH = 1024;
export const SIDEBAR_WIDTH = 248;

/** Content width for feeds and lists (Home, Explore, My Tasks, Wallet). */
export const WIDE_CONTENT = 1120;
/** Content width for reading and forms (a task, settings, chat). */
export const NARROW_CONTENT = 760;

export type Layout = {
  desktop: boolean;
  width: number;
  height: number;
  /** How many cards fit side by side in a feed at this width. */
  columns: 1 | 2 | 3;
};

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const desktop = Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
  const main = desktop ? width - SIDEBAR_WIDTH : width;
  const columns: Layout['columns'] = !desktop ? 1 : main >= 1180 ? 3 : 2;
  return { desktop, width, height, columns };
}

/** Plain check, for code that runs outside a component. */
export function isDesktopWidth(width: number): boolean {
  return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
