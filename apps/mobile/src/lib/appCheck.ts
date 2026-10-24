/**
 * Firebase App Check token for the `api` function (monitor mode, Phase 3).
 *
 * Native: not built yet. Android needs Play Integrity through
 * @react-native-firebase/app-check, which adds a native module and a
 * google-services.json, so it arrives with the next APK build once the Firebase
 * app is registered (docs/APP_CHECK.md). Until then the header is simply absent
 * and the server records "missing". The web version is appCheck.web.ts.
 */
export async function appCheckHeaders(): Promise<Record<string, string>> {
  return {};
}
