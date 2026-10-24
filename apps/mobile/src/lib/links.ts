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

/**
 * Where Razorpay sends the payer once a payment goes through, so they land
 * back in TaskDrop instead of staying on Razorpay's receipt page.
 *
 * On the web that is the page the app is served from (a preview deploy returns
 * to itself, not to production). On a phone the checkout is a sheet that
 * closes as soon as it sees this address, so the page never has to load; the
 * production site is the fallback when EXPO_PUBLIC_APP_URL is not set.
 */
export function paymentReturnUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/`;
  return `${appOrigin() ?? 'https://taskdrop.in'}/`;
}

/** Razorpay adds razorpay_payment_link_id (and friends) to the address it returns the payer to. */
export function isPaymentReturn(url: string): boolean {
  return url.startsWith(paymentReturnUrl()) && /[?&]razorpay_payment_link_id=/.test(url);
}

/**
 * Web only. The payment opens in its own tab, and the tab that is waiting for
 * the money notices it by itself. When Razorpay returns the payer here, close
 * this tab so they are back where they started; if the browser will not close
 * it, tidy the address bar and carry on as the app.
 */
export function finishPaymentReturn(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  if (!isPaymentReturn(window.location.href)) return;
  window.close();
  const url = new URL(window.location.href);
  for (const key of [...url.searchParams.keys()]) if (key.startsWith('razorpay_')) url.searchParams.delete(key);
  window.history.replaceState({}, '', url.toString());
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

/** Public pages a link can open directly, signed in or not: ?page=<name>. */
const PUBLIC_PAGES = ['copyright', 'terms', 'privacy', 'support'] as const;
export type PublicPage = (typeof PUBLIC_PAGES)[number];

/** The public page a visitor arrived for, if any. Web only. */
export function incomingPage(): PublicPage | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  const page = new URLSearchParams(window.location.search).get('page');
  return (PUBLIC_PAGES as readonly string[]).includes(page ?? '') ? (page as PublicPage) : null;
}

/** Shareable URL for a public page, e.g. the copyright notice page. */
export function pageUrl(page: PublicPage): string | null {
  const origin = appOrigin();
  return origin ? `${origin}/?page=${page}` : null;
}

/** Drop ?page= from the address bar once it has been handled. */
export function clearIncomingPage(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('page');
  window.history.replaceState({}, '', url.toString());
}

/** Drop ?task= from the address bar once it has been handled. */
export function clearIncomingTask(): void {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('task');
  window.history.replaceState({}, '', url.toString());
}
