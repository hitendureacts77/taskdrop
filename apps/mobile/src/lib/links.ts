import { Platform } from 'react-native';

/**
 * Public links into the app.
 *
 * A shared link has to land somewhere real, so the web build reads ?task=<id>
 * on startup and opens that task (see useDeepLink). Native builds need an
 * absolute origin, which the app can't know on its own — set
 * EXPO_PUBLIC_APP_URL when you deploy, otherwise sharing from a device falls
 * back to the same origin the web build is served from.
 */

export function appOrigin(): string | null {
  const configured = process.env.EXPO_PUBLIC_APP_URL?.trim().replace(/[/]+$/, '');
  if (configured) return configured;
  if (Platform.OS === 'web' && typeof window !== 'undefined') return window.location.origin;
  return null;
}

/** Shareable URL for a task, or null when no public origin is configured. */
export function taskUrl(taskId: string): string | null {
  const origin = appOrigin();
  return origin ? `${origin}/?task=${encodeURIComponent(taskId)}` : null;
}

/** The task id a visitor arrived with, if any. Web only. */
export function incomingTaskId(): string | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const id = new URLSearchParams(window.location.search).get('task');
  return id && /^[0-9a-f-]{36}$/i.test(id) ? id : null;
}

/** Drop ?task= from the address bar once it has been handled. */
export function clearIncomingTask(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('task');
  window.history.replaceState({}, '', url.toString());
}
