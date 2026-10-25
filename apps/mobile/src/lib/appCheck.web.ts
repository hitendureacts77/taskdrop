/**
 * Firebase App Check token for the `api` function (web, reCAPTCHA Enterprise).
 *
 * Off until the build has the Firebase web config and the reCAPTCHA Enterprise
 * site key (EXPO_PUBLIC_FIREBASE_API_KEY, _APP_ID, _PROJECT_ID, _SENDER_ID and
 * EXPO_PUBLIC_RECAPTCHA_SITE_KEY; docs/APP_CHECK.md). With any of them missing
 * no header is sent and the app works as before. The server is in monitor
 * mode: it records the token and refuses nothing, so a failure here must never
 * reach the person. The SDK loads on first use, so it costs nothing until the
 * keys exist.
 */
// Each value is written out as process.env.EXPO_PUBLIC_*: Expo only inlines that
// exact form at build time, not an aliased `const env = process.env`.
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_SENDER_ID,
};
const siteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY;
const configured = Boolean(config.apiKey && config.appId && config.projectId && config.messagingSenderId && siteKey);

type AppCheckModule = typeof import('@firebase/app-check');
let started: Promise<{ lib: AppCheckModule; instance: import('@firebase/app-check').AppCheck } | null> | null = null;

function start() {
  started ??= (async () => {
    try {
      const [{ initializeApp }, lib] = await Promise.all([import('@firebase/app'), import('@firebase/app-check')]);
      const app = initializeApp(config);
      const instance = lib.initializeAppCheck(app, {
        provider: new lib.ReCaptchaEnterpriseProvider(siteKey!),
        isTokenAutoRefreshEnabled: true,
      });
      return { lib, instance };
    } catch {
      return null;
    }
  })();
  return started;
}

export async function appCheckHeaders(): Promise<Record<string, string>> {
  if (!configured) return {};
  try {
    const ready = await start();
    if (!ready) return {};
    // Never wait long for it: a slow token must not slow the app down.
    const result = await Promise.race([
      ready.lib.getToken(ready.instance, false),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return result?.token ? { 'X-Firebase-AppCheck': result.token } : {};
  } catch {
    return {};
  }
}
