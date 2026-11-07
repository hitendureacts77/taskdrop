/**
 * Where the splash leads. A device that has never shown the intro (a fresh
 * install) goes to it first; every later start, and every return from signing
 * out, goes straight to the sign-in page. Pure, so it can be tested without
 * the device's storage.
 */
export function afterSplash(introSeen: boolean): 'intro' | 'welcome' {
  return introSeen ? 'welcome' : 'intro';
}

/**
 * What the intro's two buttons do. The first-run intro asks for the account
 * (large) or lets the person look around first (small). Opened again from
 * "How TaskDrop works", a guest is still offered the account, and a signed-in
 * person just gets "Done".
 */
export type IntroMode = 'first' | 'guest-replay' | 'member-replay';

export function introMode(a: { replay: boolean; signedIn: boolean }): IntroMode {
  if (!a.replay) return 'first';
  return a.signedIn ? 'member-replay' : 'guest-replay';
}
