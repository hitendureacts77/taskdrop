/**
 * When Explore asks for location. Pure rules plus a once-per-launch flag, so
 * the screen and the tests share one answer.
 */

/** 'prompt' = never asked / can still ask. */
export type LiveStatus =
  | 'idle'
  | 'checking'
  | 'prompt'
  | 'granted'
  | 'denied'
  | 'blocked'
  | 'services-off'
  | 'error';

let asked = false;

/** Once per app launch: whether Explore already showed the location sheet. */
export function locationAskedThisLaunch(): boolean {
  return asked;
}

export function markLocationAsked(): void {
  asked = true;
}

/** Test hook: forget that the sheet was shown. */
export function resetLocationAsked(): void {
  asked = false;
}

/** Should the sheet open? */
export function shouldAskForLocation(s: {
  status: LiveStatus;
  askedThisLaunch: boolean;
  lookingElsewhere: boolean;
}): boolean {
  if (s.askedThisLaunch || s.lookingElsewhere) return false;
  return (
    s.status === 'denied' ||
    s.status === 'blocked' ||
    s.status === 'services-off' ||
    s.status === 'prompt'
  );
}
