import { Linking, Platform } from 'react-native';

/**
 * Web only: the Plan B payment page opens in its own tab. Browsers block a tab opened after a wait, so the
 * tab is claimed inside the tap (before asking the server) and filled once the checkout is known.
 * Native builds use the in-app PaymentSheet instead, and these do nothing.
 */
export function claimCheckoutWindow(): Window | null {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;
  try {
    return window.open('', '_blank');
  } catch {
    return null;
  }
}

export async function fillCheckoutWindow(w: Window | null, checkout: { url?: string; html?: string }): Promise<void> {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return;
  try {
    if (checkout.url) {
      if (w && !w.closed) w.location.href = checkout.url;
      else await Linking.openURL(checkout.url);
    } else if (checkout.html) {
      if (w && !w.closed) {
        w.document.open();
        w.document.write(checkout.html);
        w.document.close();
      } else {
        const blob = new Blob([checkout.html], { type: 'text/html' });
        await Linking.openURL(URL.createObjectURL(blob));
      }
    }
  } catch {
    /* the screen keeps waiting and offers "Open payment page again" */
  }
}

export function dropCheckoutWindow(w: Window | null): void {
  try {
    if (w && !w.closed) w.close();
  } catch {
    /* already gone */
  }
}
