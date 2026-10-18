import type { ScreenName } from '../providers/navTypes';

/**
 * Where the app opens: the tabs when someone is signed in, otherwise the
 * splash (or worker setup, for a sign-in that is not finished). Decided once
 * at start-up and used once, by the tabs layout, so a later trip back to the
 * tabs is never redirected again.
 */
let target: ScreenName | null | undefined;

export function decideStart(next: ScreenName | null): void {
  if (target === undefined) target = next;
}

export function takeStart(): ScreenName | null {
  const t = target ?? null;
  target = null;
  return t;
}
