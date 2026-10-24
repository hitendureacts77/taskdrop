import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Sentry from '@sentry/react-native';
import { apiFailureKind, setErrorReporter, type RawError } from './errors';

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

/** Turn on in release builds that have a DSN. Development just logs. */
const ENABLED = !__DEV__ && DSN.length > 0;

/**
 * Share of sessions recorded as a replay. 5% by default; a build can set
 * EXPO_PUBLIC_SENTRY_REPLAY_RATE (0 to 1) to change it. The preview build sets 1,
 * so a replay shows up at once while testing. Anything else falls back to 5%.
 */
function replaySessionRate(): number {
  const raw = process.env.EXPO_PUBLIC_SENTRY_REPLAY_RATE;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : 0.05;
}

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
      // Lines written with `log` below show up under Sentry > Explore > Logs,
      // next to any crash they led to.
      enableLogs: true,
      // Counters written with `count` below, under Sentry > Explore > Metrics.
      enableMetrics: true,
      // Of the traced sessions, half also record where the time went (phones only).
      profilesSampleRate: 0.5,
      // Session replay: 5% of sessions (see replaySessionRate), and every
      // session that hits an error. Everything on screen is masked (text,
      // pictures, icons), so a replay shows the layout and the taps, never a
      // name, address or amount. Phones only; the web build has no replay.
      replaysSessionSampleRate: replaySessionRate(),
      replaysOnErrorSampleRate: 1.0,
      integrations:
        Platform.OS === 'web'
          ? []
          : [Sentry.mobileReplayIntegration({ maskAllText: true, maskAllImages: true, maskAllVectors: true })],
    });
    Sentry.setTag('os', Platform.OS);
  }

  setErrorReporter((err, context) => {
    if (__DEV__) console.warn(`[error${context ? `:${context}` : ''}]`, err);
    if (!ENABLED) return;
    if (context === 'api') {
      reportApiFailure(err as RawError);
      return;
    }
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

/**
 * A failed call to the server. Offline, signed-out and on-purpose refusals
 * (not enough money, a duplicate) are normal, so they only count in Metrics.
 * Anything else is a bug worth seeing: it becomes a warning-level issue with
 * the status and error code, grouped by them, and without the message text
 * (database messages can quote values).
 */
function reportApiFailure(err: RawError): void {
  try {
    const kind = apiFailureKind(err);
    if (kind !== 'unexpected') {
      Sentry.metrics.count('api.failed', 1, { attributes: { kind } });
      return;
    }
    const code = err.code ?? 'none';
    const status = err.status ?? 0;
    Sentry.captureException(new Error(`API call failed (status ${status}, code ${code})`), {
      level: 'warning',
      tags: { context: 'api', code, status: String(status) },
      fingerprint: ['api-failure', code, String(status)],
    });
  } catch {
    /* reporting must never become the crash */
  }
}

/** Who is signed in, by id only: never a phone number, email or name. Call with null on sign-out. */
export function setMonitoringUser(id: string | null): void {
  if (!ENABLED) return;
  try {
    Sentry.setUser(id ? { id } : null);
  } catch {
    /* best effort */
  }
}

type Attributes = Record<string, string | number | boolean | null | undefined>;

function write(level: 'info' | 'warn' | 'error', message: string, attributes?: Attributes): void {
  if (__DEV__) console[level === 'info' ? 'log' : level](`[${level}] ${message}`, attributes ?? '');
  if (!ENABLED) return;
  try {
    const clean: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(attributes ?? {})) if (v !== null && v !== undefined) clean[k] = v;
    Sentry.logger[level](message, clean);
  } catch {
    /* logging must never become the crash */
  }
}

/**
 * A line in Sentry's Logs, for the moments that explain a problem in
 * production: a payment that did not open, a request the server refused, a
 * sign-in that failed. Not for every tap or every request.
 *
 *   log.info('payment opened', { purpose: 'escrow' });
 *   log.warn('request refused', { op, code });
 *   log.error('upload failed', { step: 'attach' });
 *
 * Keep the message a fixed sentence and put the changing parts in attributes,
 * so lines group and search. Never put a phone number, email, name, address,
 * token or message text in either: ids, codes and counts only.
 */
export const log = {
  info: (message: string, attributes?: Attributes) => write('info', message, attributes),
  warn: (message: string, attributes?: Attributes) => write('warn', message, attributes),
  error: (message: string, attributes?: Attributes) => write('error', message, attributes),
};

/**
 * A counter in Sentry's Metrics, for the numbers you would watch on a
 * dashboard: tasks posted, payments started, sign-ins. Same rule as `log`:
 * fixed names, small attribute values (a purpose, a kind), nothing personal.
 *
 *   count('task.posted');
 *   count('payment.link_opened', { purpose: 'escrow' });
 */
export function count(name: string, attributes?: Record<string, string | number | boolean>): void {
  if (!ENABLED) return;
  try {
    Sentry.metrics.count(name, 1, attributes ? { attributes } : undefined);
  } catch {
    /* metrics must never become the crash */
  }
}

/** Open Sentry's "report a bug" form (the person's note, optionally a screenshot). */
export function showBugReport(): void {
  if (!ENABLED) return;
  try {
    Sentry.showFeedbackWidget();
  } catch {
    /* best effort */
  }
}

/** Whether bug reports can be sent (a release build with Sentry on). */
export const bugReportsAvailable = ENABLED;

/** Wrap the root component so Sentry can trace startup and screen renders. */
export const withMonitoring = Sentry.wrap;
