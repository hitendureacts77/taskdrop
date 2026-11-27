/**
 * Which frame a web screen is drawn in on tablet and desktop widths. Pure, so it can be unit tested.
 *
 * The sign-in screens get the signed-out hero frame (DesktopAuthFrame). The public pages (Terms, Privacy, Copyright,
 * Support) get it too when someone arrives with no account and has not chosen guest mode; anyone inside the app, a
 * guest included (B149), keeps the app's own frame (side menu or icon rail), as on every other page.
 */

/** Screens shown before sign-in. */
export const PRE_AUTH: readonly string[] = ['splash', 'welcome', 'signup', 'setup', 'pickUsername'];
/**
 * Screens drawn edge to edge on tablet and desktop: no sign-in frame, no side menu (task 1.21 row X).
 * "How TaskDrop works" is its own big page, for a first-run guest and a signed-in replay alike.
 */
export const FULL_PAGE: readonly string[] = ['intro'];
/** Pages anyone may read. */
export const PUBLIC: readonly string[] = ['copyright', 'terms', 'privacy', 'support'];

/** True when the screen is drawn in the signed-out hero frame. `inApp`: signed in, or a guest. */
export function usesAuthFrame(screen: string, inApp: boolean): boolean {
  return PRE_AUTH.includes(screen) || (!inApp && PUBLIC.includes(screen));
}

/** True when the screen fills the whole window with its own top bar (no frame, no menu). */
export function usesFullPage(screen: string): boolean {
  return FULL_PAGE.includes(screen);
}
