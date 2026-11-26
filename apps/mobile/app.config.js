// Layered on top of app.json. The phone map is MapLibre (plan 1.20, D33), which
// needs no map key, so nothing about maps is handled here.
//
// This file adds the Sentry plugin, which uploads source maps and debug symbols
// during native builds so crash stacks are readable. It needs SENTRY_AUTH_TOKEN
// in the build environment (apps/mobile/.env.local on this machine, an EAS
// secret for EAS builds); without one the upload is skipped and the build
// still succeeds.
//
// APP_VARIANT (variant.cjs, plan task 5.0a) decides which TaskDrop this is: today's app (not set),
// the staging app, or production. checkVariant() stops a build that mixes the two copies, and runs
// everywhere this file is read: builds, updates, web exports and `expo start`.
const { applyVariant, checkVariant, sentryProject } = require('./variant.cjs');

const SENTRY = {
  url: 'https://sentry.io/',
  organization: 'hitendu',
  project: 'taskdrop',
};

module.exports = ({ config }) => {
  const androidBuild = process.env.EAS_BUILD_PLATFORM === 'android' || process.argv.some((a) => /android/i.test(a));
  const problems = checkVariant(process.env, { androidBuild });
  if (problems.length) {
    throw new Error(['Build stopped: this build mixes staging and production.', ...problems.map((p) => ` - ${p}`)].join('\n'));
  }
  const plugins = (config.plugins ?? []).filter((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    return name !== '@sentry/react-native/expo';
  });
  plugins.push(['@sentry/react-native/expo', { ...SENTRY, project: sentryProject(process.env) }]);
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
  return applyVariant({ ...config, android, plugins }, process.env);
};
