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

/** Where the time of the last "Not now" is kept, so a refresh or the next launch does not ask again at once. */
export const LOCATION_DISMISSED_KEY = 'taskdrop.locationAsk.dismissedAt.v1';
/** How long a "Not now" holds: long enough that the sheet is not a daily wall, short enough to ask again. */
export const DISMISS_FOR_MS = 3 * 24 * 60 * 60 * 1000;

/** Was the sheet put away within the last three days? (A time in the future, from a wrong clock, does not count.) */
export function dismissedRecently(at: number | null, now: number): boolean {
  return at !== null && Number.isFinite(at) && at <= now && now - at < DISMISS_FOR_MS;
}

/**
 * Should the sheet open? Not while the person has put it away recently: with location blocked its
 * Try again button cannot work, and a sheet over the map on every launch was the first thing a
 * returning person met (round 7).
 */
export function shouldAskForLocation(s: {
  status: LiveStatus;
  askedThisLaunch: boolean;
  lookingElsewhere: boolean;
  /** Pass true while the saved time is still being read: the sheet must not open before it is known. */
  dismissedRecently?: boolean;
}): boolean {
  if (s.askedThisLaunch || s.lookingElsewhere || s.dismissedRecently) return false;
  return (
    s.status === 'denied' ||
    s.status === 'blocked' ||
    s.status === 'services-off' ||
    s.status === 'prompt'
  );
}
