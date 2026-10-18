/**
 * Links that open the app (taskdrop://auth-callback after Google sign-in, an
 * email link) are read by AuthProvider itself through expo-linking. They are
 * not pages, so Expo Router would otherwise answer them with "unmatched
 * route". Send them all to the first tab and leave the rest to the app.
 */
export function redirectSystemPath(): string {
  return '/';
}
