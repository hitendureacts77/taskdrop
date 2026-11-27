// Pure (no react-native), so node tests can import it. Task 1.14 level 1: one width rule for every device.

/** From this width up (and below desktop) a screen is a "tablet": web gets the icon rail, a native app gets centred content. */
export const TABLET_MIN_WIDTH = 600;
/** Content width on a tablet. */
export const TABLET_CONTENT = 720;
/** A tablet-width native screen is two columns once the held content is this wide. */
export const TWO_COLUMN_MIN = 640;

/**
 * An Android (or iOS) screen 600 wide or more: a tablet, an opened foldable, split-screen on a big screen. The five
 * bottom tabs stay (changing the app's navigation is level 2); the content is held to TABLET_CONTENT in the middle
 * and feeds show two columns. Always false on the web, which has its own tablet and desktop layouts, and under 600
 * (every phone), so the phone layout never changes.
 */
export function isNativeWide(web: boolean, width: number): boolean {
  return !web && width >= TABLET_MIN_WIDTH;
}

/** The held content width of a native wide screen. */
export function nativeContentWidth(width: number): number {
  return Math.min(width, TABLET_CONTENT);
}

/** Columns in a feed on a native wide screen. */
export function nativeColumns(width: number): 1 | 2 {
  return nativeContentWidth(width) >= TWO_COLUMN_MIN ? 2 : 1;
}
