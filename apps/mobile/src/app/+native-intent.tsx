/**
 * Links that open the app (taskdrop://auth-callback after Google sign-in, an
 * email link) are read by AuthProvider itself through expo-linking. They are
 * not pages, so Expo Router would otherwise answer them with "unmatched
 * route". Opening the app from one starts on the first tab; while the app is
 * already open the link is ignored by the router, so the screen stays put.
 */
export function redirectSystemPath({ initial }: { path: string; initial: boolean }): string | null {
  return initial ? '/' : null;
}
