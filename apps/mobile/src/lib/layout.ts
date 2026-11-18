import { Platform, useWindowDimensions } from 'react-native';

/**
 * Phone, tablet or desktop layout, from one codebase. Laid out by width,
 * never by platform -- except that Android and iOS are always the phone
 * layout, as before. On the web:
 *
 *   < 600       phone: single column, bottom tab bar and the drop button
 *   600 – 1023  tablet: a slim icon rail on the left, content up to 720,
 *               two-column grids, sheets as centred dialogs
 *   ≥ 1024      desktop: the full side menu, the page scaled up with the
 *               window (desktopScale), and fluid columns with a gutter
 *
 * Resizing the window switches live.
 */

/** From this browser width up, the web build lays out for a desktop. */
export const DESKTOP_MIN_WIDTH = 1024;
/** From this browser width up (and below desktop), the tablet rail layout. */
export const TABLET_MIN_WIDTH = 600;
export const SIDEBAR_WIDTH = 264;
export const RAIL_WIDTH = 84;

/** Content width on a tablet. */
export const TABLET_CONTENT = 720;

/**
 * Desktop columns (docs/design/desktop-fit/PLAN.md, Q1). FULL fills the area
 * beside the menu (maps); FEED, READ and FORM fill it less a gutter, up to a cap.
 * READ and FORM keep a small cap on purpose: line length, one form at a time.
 * FEED stops at 1280 (docs/design/desktop-web/PLAN.md, 4.1): a web page's content width, so the page header and
 * the cards below it line up on a big monitor instead of stretching edge to edge (1680 before).
 */
export type ColumnClass = 'full' | 'feed' | 'read' | 'form';
export const FEED_MAX = 1280;
export const READ_MAX = 960;
export const FORM_MAX = 760;
export const GUTTER_MIN = 24;
export const GUTTER_MAX = 40;
/** The narrowest a card in a feed grid may get. */
export const CARD_MIN = 290;
/** Two panes side by side once the feed column is this wide. */
export const TWO_PANE_MIN = 940;

/**
 * Desktop scale (PLAN.md, Q2): the whole page grows with the window through
 * CSS zoom on <html> (lib/desktopScale.web.ts), so text, controls, spacing and
 * icons grow together. Never below 1, never above SCALE_MAX, and never so much
 * that the design height drops under SCALE_MIN_HEIGHT.
 */
export const SCALE_MAX = 1.35;
const SCALE_STEP_WIDTH = 3200;
const SCALE_MIN_HEIGHT = 650;

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Firefox before 126 has no `zoom`: there the page stays at 1.
const zoomWorks =
  Platform.OS === 'web' && typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1.1');

/** The desktop scale for a browser window of this real size (CSS px). */
export function desktopScaleFor(width: number, height: number): number {
  const byWidth = clamp(1, 1 + (width - DESKTOP_MIN_WIDTH) / SCALE_STEP_WIDTH, SCALE_MAX);
  return Math.max(1, Math.round(Math.min(byWidth, height / SCALE_MIN_HEIGHT) * 100) / 100);
}

export type Layout = {
  desktop: boolean;
  /** Web, 600–1023 wide: the icon-rail layout. */
  tablet: boolean;
  /** The window in layout px: on a desktop that is the real window divided by `scale`. */
  width: number;
  height: number;
  /** How much the desktop page is zoomed (1 everywhere else). */
  scale: number;
  /** Space each side of a desktop column (0 off desktop). */
  gutter: number;
  /** How wide a column of this class is, in layout px. */
  contentWidth: (cls: ColumnClass) => number;
  /** Desktop with room for two panes side by side. */
  twoPane: boolean;
  /** How many cards fit side by side in a feed at this width. */
  columns: 1 | 2 | 3 | 4;
};

export function useLayout(): Layout {
  const win = useWindowDimensions();
  const web = Platform.OS === 'web';
  const desktop = web && win.width >= DESKTOP_MIN_WIDTH;
  const tablet = web && !desktop && win.width >= TABLET_MIN_WIDTH;
  const scale = desktop && zoomWorks ? desktopScaleFor(win.width, win.height) : 1;
  const width = win.width / scale;
  const height = win.height / scale;
  if (desktop) {
    const main = width - SIDEBAR_WIDTH;
    const gutter = clamp(GUTTER_MIN, Math.round(0.025 * main), GUTTER_MAX);
    const contentWidth = (cls: ColumnClass) =>
      cls === 'full' ? main : Math.min(main - 2 * gutter, cls === 'feed' ? FEED_MAX : cls === 'read' ? READ_MAX : FORM_MAX);
    const feed = contentWidth('feed');
    const columns = clamp(1, Math.floor((feed + 16) / (CARD_MIN + 16)), 4) as Layout['columns'];
    return { desktop, tablet, width, height, scale, gutter, contentWidth, twoPane: feed >= TWO_PANE_MIN, columns };
  }
  const main = tablet ? Math.min(width - RAIL_WIDTH, TABLET_CONTENT) : width;
  const contentWidth = (cls: ColumnClass) => (tablet && cls === 'full' ? width - RAIL_WIDTH : main);
  const columns: Layout['columns'] = tablet && main >= 640 ? 2 : 1;
  return { desktop, tablet, width, height, scale, gutter: 0, contentWidth, twoPane: false, columns };
}

/** Plain check, for code that runs outside a component. */
export function isDesktopWidth(width: number): boolean {
  return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
