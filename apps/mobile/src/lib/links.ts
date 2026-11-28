import { Platform } from 'react-native';
import type { PublicPage } from '../navigation/webAddress';
import { roughPlace } from './place';
import { STAGING_SITE, taskLink, taskShare, type TaskShare } from './taskShare';

/**
 * Public links into the app.
 *
 * A shared link has to land somewhere real, so the web build opens /task/<id>
 * (and the older ?task=<id>) on startup (providers/NavProvider.tsx). Native builds need an
 * absolute origin, which the app can't know on its own: EXPO_PUBLIC_APP_URL when it is set,
 * otherwise staging's taskdrop.in (task 128: the staging APK has no EXPO_PUBLIC_APP_URL, so a
 * phone made no link at all). A production Android build refuses to start without
 * EXPO_PUBLIC_APP_URL (variant.cjs, plan 5.0a), so production never falls back to staging.
 */

export function appOrigin(): string | null {
  const configured = process.env.EXPO_PUBLIC_APP_URL?.trim().replace(/[/]+$/, '');
  if (configured) return configured;
  if (Platform.OS === 'web') return typeof window !== 'undefined' ? window.location.origin : null;
  return STAGING_SITE;
}

/**
 * Where Razorpay sends the payer once a payment goes through, so they land
 * back in TaskDrop instead of staying on Razorpay's receipt page.
 *
 * On the web that is the page the app is served from (a preview deploy returns
 * to itself, not to production). On a phone the checkout is a sheet that
 * closes as soon as it sees this address, so the page never has to load; taskdrop.in
 * (staging's address) is the fallback when EXPO_PUBLIC_APP_URL is not set. A production
 * Android build refuses to start without EXPO_PUBLIC_APP_URL (variant.cjs, plan 5.0a),
 * so production never falls back to the staging address.
 */
export function paymentReturnUrl(): string {
  if (Platform.OS === 'web' && typeof window !== 'undefined') return `${window.location.origin}/`;
  return `${appOrigin() ?? STAGING_SITE}/`;
}

/** Razorpay adds razorpay_payment_link_id (and friends) to the address it returns the payer to. */
export function isPaymentReturn(url: string): boolean {
  return url.startsWith(paymentReturnUrl()) && /[?&]razorpay_(payment_link_id|payment_id|order_id)=/.test(url);
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

/** Shareable URL for a task: its own website address, <origin>/task/<id>, on every platform. */
export function taskUrl(taskId: string): string | null {
  return taskLink(appOrigin(), taskId);
}

/** What a poster shares for their own task: title, rough area, "Can you help?" and the link (task 128). */
export function taskShareItem(task: { id: string; title: string; loc_label?: string | null }): TaskShare | null {
  return taskShare(task, appOrigin(), roughPlace);
}

/** Shareable URL for a public page, e.g. the copyright notice page. */
export function pageUrl(page: PublicPage): string | null {
  const origin = appOrigin();
  return origin ? `${origin}/?page=${page}` : null;
}

