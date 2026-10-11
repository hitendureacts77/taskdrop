import { Platform, useWindowDimensions } from 'react-native';

/**
 * Phone, tablet or desktop layout, from one codebase. Laid out by width,
 * never by platform -- except that Android and iOS are always the phone
 * layout, as before. On the web:
 *
 *   < 600       phone: single column, bottom tab bar and the drop button
 *   600 – 1023  tablet: a slim icon rail on the left, content up to 720,
 *               two-column grids, sheets as centred dialogs
 *   ≥ 1024      desktop: the full side menu, content up to 1120
 *
 * Resizing the window switches live.
 */

/** From this browser width up, the web build lays out for a desktop. */
export const DESKTOP_MIN_WIDTH = 1024;
/** From this browser width up (and below desktop), the tablet rail layout. */
export const TABLET_MIN_WIDTH = 600;
export const SIDEBAR_WIDTH = 264;
export const RAIL_WIDTH = 84;

/** Content width for feeds and lists (Home, Explore, My Tasks, Wallet). */
export const WIDE_CONTENT = 1120;
/** Content width for reading and forms (a task, settings, chat). */
export const NARROW_CONTENT = 760;
/** Content width on a tablet. */
export const TABLET_CONTENT = 720;

export type Layout = {
  desktop: boolean;
  /** Web, 600–1023 wide: the icon-rail layout. */
  tablet: boolean;
  width: number;
  height: number;
  /** How many cards fit side by side in a feed at this width. */
  columns: 1 | 2 | 3;
};

export function useLayout(): Layout {
  const { width, height } = useWindowDimensions();
  const web = Platform.OS === 'web';
  const desktop = web && width >= DESKTOP_MIN_WIDTH;
  const tablet = web && !desktop && width >= TABLET_MIN_WIDTH;
  const main = desktop ? width - SIDEBAR_WIDTH : tablet ? Math.min(width - RAIL_WIDTH, TABLET_CONTENT) : width;
  const columns: Layout['columns'] = desktop ? (main >= 1180 ? 3 : 2) : tablet && main >= 640 ? 2 : 1;
  return { desktop, tablet, width, height, columns };
}

/** Plain check, for code that runs outside a component. */
export function isDesktopWidth(width: number): boolean {
  return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
