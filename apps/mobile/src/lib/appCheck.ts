/**
 * Firebase App Check token for the `api` function (Android, Play Integrity).
 *
 * Needs the native module @react-native-firebase/app-check, which only exists in
 * an installed build made with the Firebase config (GOOGLE_SERVICES_JSON, see
 * app.config.js and docs/APP_CHECK.md). In Expo Go, a dev build without it, or
 * when anything fails, no header is sent and the app works as before. The server
 * is in monitor mode: it records the token and refuses nothing, so a failure
 * here must never reach the person. The module loads on first use. iOS
 * (App Attest) is future scope, so on iOS this stays empty. The web version is
 * appCheck.web.ts.
 */
import { Platform } from 'react-native';

type Ready = {
  getToken: typeof import('@react-native-firebase/app-check').getToken;
  instance: import('@react-native-firebase/app-check').AppCheck;
};
let started: Promise<Ready | null> | null = null;

function start() {
  started ??= (async () => {
    try {
      const [{ getApp }, lib] = await Promise.all([
        import('@react-native-firebase/app'),
        import('@react-native-firebase/app-check'),
      ]);
      const provider = new lib.ReactNativeFirebaseAppCheckProvider();
      provider.configure({ android: { provider: 'playIntegrity' } });
      const instance = await lib.initializeAppCheck(getApp(), { provider, isTokenAutoRefreshEnabled: true });
      return { getToken: lib.getToken, instance };
    } catch {
      return null;
    }
  })();
  return started;
}

export async function appCheckHeaders(): Promise<Record<string, string>> {
  // A debug build has no Play Integrity identity and no registered debug token.
  if (Platform.OS !== 'android' || __DEV__) return {};
  try {
    const ready = await start();
    if (!ready) return {};
    // Never wait long for it: a slow token must not slow the app down.
    const result = await Promise.race([
      ready.getToken(ready.instance, false),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return result?.token ? { 'X-Firebase-AppCheck': result.token } : {};
  } catch {
    return {};
  }
}
