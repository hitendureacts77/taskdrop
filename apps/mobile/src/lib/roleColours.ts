/**
 * Which palette the whole app wears.
 *
 * Earn (worker) is always royal blue and Hire (poster) is always jade green,
 * for signed-in people AND guests. Never gate the blue on sign-in alone; never
 * reuse one palette for both sides.
 *
 * Before sign-in (splash, welcome: no session and not a guest) it stays the
 * brand green.
 */
export function usesWorkerColours({
  session,
  guest,
  mode,
}: {
  session: unknown;
  guest: boolean;
  mode: 'worker' | 'poster';
}): boolean {
  return (Boolean(session) || guest) && mode === 'worker';
}
