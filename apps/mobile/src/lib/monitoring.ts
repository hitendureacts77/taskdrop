import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { setErrorReporter } from './errors';

/**
 * Crash reporting to Sentry, switched on by EXPO_PUBLIC_SENTRY_DSN.
 *
 * A Sentry DSN is designed to be public (it only allows sending events), so it
 * is fine in the bundle. Without one, or in development, nothing is sent and
 * errors are only printed to the console.
 *
 * Uses the official @sentry/react-native SDK: JavaScript failures on web and
 * phones, plus native crashes (Java/Obj-C) on installed Android and iOS builds.
 * Native crash capture needs a build that includes the SDK; Expo Go does not.
 *
 * `reportError` (lib/errors.ts) stays the single entry point for the rest of
 * the app. This file only decides where those reports go.
 *
 * What is sent: the error's type, message and stack, which part of the app
 * caught it, the platform and the app version. `sendDefaultPii` is off, so no
 * IP address, phone number or email; no request arguments.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** Expected failures (offline, a refused request) are not crashes and are not sent. */
const IGNORED_CONTEXTS = new Set(['api']);

/** Turn on in release builds that have a DSN. Development just logs. */
const ENABLED = !__DEV__ && DSN.length > 0;

/** Call once at startup, before the app registers. */
export function installMonitoring(): void {
  if (ENABLED) {
    Sentry.init({
      dsn: DSN,
      environment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT || 'production',
      release: Constants.expoConfig?.version ?? undefined,
      sendDefaultPii: false,
      // About 10% of sessions are traced for performance; errors are never sampled.
      tracesSampleRate: 0.1,
      // Session replay can capture what is on screen, so it stays off.
      enableLogs: false,
    });
    Sentry.setTag('os', Platform.OS);
  }

  setErrorReporter((err, context) => {
    if (__DEV__) console.warn(`[error${context ? `:${context}` : ''}]`, err);
    if (!ENABLED || (context && IGNORED_CONTEXTS.has(context))) return;
    try {
      const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
      Sentry.captureException(e, {
        level: context === 'fatal' ? 'fatal' : 'error',
        tags: { context: context ?? 'unknown' },
      });
    } catch {
      /* reporting must never become the crash */
    }
  });
}

/** Wrap the root component so Sentry can trace startup and screen renders. */
export const withMonitoring = Sentry.wrap;
