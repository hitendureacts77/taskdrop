import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { setErrorReporter } from './errors';

/**
 * Crash reporting to Sentry, switched on by EXPO_PUBLIC_SENTRY_DSN.
 *
 * A Sentry DSN is designed to be public (it only allows sending events), so it
 * is fine in the bundle. Without one, nothing is sent and errors are only
 * printed in development.
 *
 * This speaks Sentry's envelope format directly instead of adding the SDK, so
 * it needs no native rebuild and works the same on web and phones. It covers
 * every JavaScript failure the app catches (screen crashes, unhandled errors,
 * failed promises). A crash inside native code is outside its reach.
 *
 * What is sent: the error's type, message and stack, which part of the app
 * caught it, the platform and the app version. No user data, no request
 * arguments.
 */

const DSN = process.env.EXPO_PUBLIC_SENTRY_DSN ?? '';

/** Expected failures (offline, a refused request) are not crashes and are not sent. */
const IGNORED_CONTEXTS = new Set(['api']);

/** At most this many events a minute, and the same message at most once a minute. */
const MAX_PER_MINUTE = 10;
let windowStart = 0;
let sentInWindow = 0;
const recent = new Map<string, number>();

function parseDsn(dsn: string): { url: string } | null {
  const m = /^https:\/\/([^@]+)@([^/]+)\/(\d+)$/.exec(dsn.trim());
  if (!m) return null;
  const [, key, host, project] = m;
  return { url: `https://${host}/api/${project}/envelope/?sentry_key=${key}&sentry_version=7` };
}

function eventId(): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
  return s;
}

function allowed(fingerprint: string, now: number): boolean {
  if (now - windowStart > 60_000) {
    windowStart = now;
    sentInWindow = 0;
  }
  const last = recent.get(fingerprint);
  if (last && now - last < 60_000) return false;
  if (sentInWindow >= MAX_PER_MINUTE) return false;
  sentInWindow++;
  recent.set(fingerprint, now);
  if (recent.size > 100) recent.clear();
  return true;
}

function send(url: string, err: unknown, context: string | undefined): void {
  const e = err instanceof Error ? err : new Error(typeof err === 'string' ? err : 'Non-error thrown');
  const now = Date.now();
  if (!allowed(`${context}:${e.name}:${e.message}`, now)) return;
  const id = eventId();
  const event = {
    event_id: id,
    timestamp: now / 1000,
    platform: 'javascript',
    level: context === 'fatal' ? 'fatal' : 'error',
    environment: __DEV__ ? 'development' : 'production',
    release: Constants.expoConfig?.version ?? undefined,
    tags: { context: context ?? 'unknown', os: Platform.OS },
    exception: { values: [{ type: e.name, value: e.message }] },
    extra: { stack: e.stack ?? null },
  };
  const body = [
    JSON.stringify({ event_id: id, sent_at: new Date(now).toISOString() }),
    JSON.stringify({ type: 'event' }),
    JSON.stringify(event),
  ].join('\n');
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-sentry-envelope' }, body }).catch(() => {});
}

/** Call once at startup. Development keeps printing to the console as before. */
export function installMonitoring(): void {
  const target = __DEV__ ? null : parseDsn(DSN);
  setErrorReporter((err, context) => {
    if (__DEV__) console.warn(`[error${context ? `:${context}` : ''}]`, err);
    if (!target || (context && IGNORED_CONTEXTS.has(context))) return;
    try {
      send(target.url, err, context);
    } catch {
      /* reporting must never become the crash */
    }
  });
}
