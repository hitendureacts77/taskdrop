import { Platform, useWindowDimensions } from 'react-native';
import { isNativeWide, nativeColumns, nativeContentWidth, TABLET_CONTENT, TABLET_MIN_WIDTH } from './widthClass';

export { TABLET_CONTENT, TABLET_MIN_WIDTH };

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
export const SIDEBAR_WIDTH = 240;
export const RAIL_WIDTH = 84;


/**
 * Desktop columns (docs/design/desktop-fit/PLAN.md, Q1). FULL fills the area
 * beside the menu (maps); FEED, READ and FORM fill it less a gutter, up to a cap.
 * READ and FORM keep a small cap on purpose: line length, one form at a time.
 * FEED stops at 1760 (was 1280, docs/design/desktop-web/PLAN.md, 4.1): with the 0.92 page zoom (task 1.19 S) a
 * 1280 cap left ~280 px empty beside the menu on a 1920 px screen. 1760 fills a 1920 screen less the gutter and
 * still stops the page stretching edge to edge on bigger monitors. ListPage (LIST_MAX) and Wallet use the same cap.
 */
export type ColumnClass = 'full' | 'feed' | 'read' | 'form';
export const FEED_MAX = 1760;
export const READ_MAX = 960;
export const FORM_MAX = 760;
export const GUTTER_MIN = 24;
export const GUTTER_MAX = 40;
/** The narrowest a card in a feed grid may get. */
export const CARD_MIN = 290;
/** Two panes side by side once the feed column is this wide. */
export const TWO_PANE_MIN = 940;

/**
 * Desktop scale: the whole page is sized through CSS zoom on <html>
 * (lib/desktopScale.web.ts), so text, controls, spacing and icons move together.
 *
 * Owner, 26 Nov (task 1.19 S): text on desktop felt too big next to sites like
 * Upwork (14 px body, 16 px paragraphs). The page now draws at SCALE_MIN (0.92,
 * so the 14 px menu reads as about 13 px) up to a 1920 px wide window, then grows
 * gently to SCALE_MAX on very wide monitors. Before, it grew from 1 to 1.35.
 * A short window never zooms above height / SCALE_MIN_HEIGHT, and never below
 * SCALE_MIN. Phones, tablets and the Android app are not touched (scale 1).
 */
export const SCALE_MIN = 0.92;
export const SCALE_MAX = 1.05;
const SCALE_FLAT_UNTIL = 1920;
const SCALE_STEP_WIDTH = 6400;
const SCALE_MIN_HEIGHT = 650;

const clamp = (lo: number, v: number, hi: number) => Math.min(hi, Math.max(lo, v));

// Firefox before 126 has no `zoom`: there the page stays at 1.
const zoomWorks =
  Platform.OS === 'web' && typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('zoom', '1.1');

/** The desktop scale for a browser window of this real size (CSS px). */
export function desktopScaleFor(width: number, height: number): number {
  const byWidth = clamp(SCALE_MIN, SCALE_MIN + (width - SCALE_FLAT_UNTIL) / SCALE_STEP_WIDTH, SCALE_MAX);
  return Math.max(SCALE_MIN, Math.round(Math.min(byWidth, height / SCALE_MIN_HEIGHT) * 100) / 100);
}

export type Layout = {
  desktop: boolean;
  /** Web, 600–1023 wide: the icon-rail layout. */
  tablet: boolean;
  /** A native app screen 600 wide or more (tablet, opened foldable, split-screen): content held to 720, two columns, bottom tabs stay. */
  nativeWide: boolean;
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
    return { desktop, tablet, nativeWide: false, width, height, scale, gutter, contentWidth, twoPane: feed >= TWO_PANE_MIN, columns };
  }
  const nativeWide = isNativeWide(web, win.width);
  if (nativeWide) {
    // An Android tablet, opened foldable or split-screen (task 1.14): no rail, the bottom tabs stay.
    const held = nativeContentWidth(width);
    const contentWidth = (cls: ColumnClass) => (cls === 'full' ? width : held);
    return { desktop, tablet, nativeWide, width, height, scale, gutter: 0, contentWidth, twoPane: false, columns: nativeColumns(width) };
  }
  const main = tablet ? Math.min(width - RAIL_WIDTH, TABLET_CONTENT) : width;
  const contentWidth = (cls: ColumnClass) => (tablet && cls === 'full' ? width - RAIL_WIDTH : main);
  const columns: Layout['columns'] = tablet && main >= 640 ? 2 : 1;
  return { desktop, tablet, nativeWide, width, height, scale, gutter: 0, contentWidth, twoPane: false, columns };
}

/** Plain check, for code that runs outside a component. */
export function isDesktopWidth(width: number): boolean {
  return Platform.OS === 'web' && width >= DESKTOP_MIN_WIDTH;
}
