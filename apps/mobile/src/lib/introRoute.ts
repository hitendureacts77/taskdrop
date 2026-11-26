
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
