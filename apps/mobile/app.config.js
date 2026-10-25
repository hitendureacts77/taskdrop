// Layered on top of app.json. The only thing added here is the Google Maps key
// for installed Android builds, read from the environment so it never has to
// be committed. Expo Go is a separate app and ignores this (the map picker
// shows tiles there instead).
//
// The key has to go through react-native-maps' own config plugin. That plugin
// runs on every build, and when it is not handed a key it *removes* the
// manifest entry -- so setting `android.config.googleMaps.apiKey` alone left
// installed builds with a blank map.
//
// It also adds the Sentry plugin, which uploads source maps and debug symbols
// during native builds so crash stacks are readable. It needs SENTRY_AUTH_TOKEN
// in the build environment (apps/mobile/.env.local on this machine, an EAS
// secret for EAS builds); without one the upload is skipped and the build
// still succeeds.
const SENTRY = {
  url: 'https://sentry.io/',
  organization: 'hitendu',
  project: 'taskdrop',
};

module.exports = ({ config }) => {
  // Deliberately not EXPO_PUBLIC_: that prefix inlines the value into the JS
  // bundle. This one is only read here, at build time, for the Android manifest
  // (an EAS secret for EAS builds, apps/mobile/.env on this machine).
  //
  // Plugin options are copied into the public app config (Constants.expoConfig),
  // which the web bundle includes, so the key is only handed over when this is a
  // native Android build: an EAS Android build, or a local command naming android
  // (`expo run:android`, `expo prebuild --platform android`). A web export never
  // gets it, even if the variable happens to be set in that environment.
  const androidBuild = process.env.EAS_BUILD_PLATFORM === 'android' || process.argv.some((a) => /android/i.test(a));
  const mapsKey = androidBuild ? process.env.EXPO_GOOGLE_MAPS_API_KEY : undefined;
  const plugins = (config.plugins ?? []).filter((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    return name !== '@sentry/react-native/expo' && !(mapsKey && name === 'react-native-maps');
  });
  plugins.push(['@sentry/react-native/expo', SENTRY]);
  if (mapsKey) plugins.push(['react-native-maps', { androidGoogleMapsApiKey: mapsKey }]);
  // Push on Android needs the Firebase app's google-services.json. It is kept out
  // of git: on EAS it is a file environment variable (GOOGLE_SERVICES_JSON, whose
  // value is the path to the file); on this machine point it at a local file.
  // Without it the build still succeeds and push does not work (docs/FCM.md).
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  const android = googleServicesFile ? { ...config.android, googleServicesFile } : config.android;
  // App Check on Android (Play Integrity) goes through React Native Firebase.
  // Its app plugin throws when there is no google-services.json, so it is only
  // added to an Android build that has the file; any other build (web export,
  // Expo Go, no secret) skips it and sends no App Check header (docs/APP_CHECK.md).
  // Its app-check plugin only edits the iOS AppDelegate, so it is left out until iOS.
  if (androidBuild && googleServicesFile) plugins.push('@react-native-firebase/app');
  return { ...config, android, plugins };
};
