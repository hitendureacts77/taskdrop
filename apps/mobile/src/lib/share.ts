import { Platform, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';

/**
 * Sharing a task, in the one place that knows how each platform does it.
 *
 * We deliberately do not hardcode WhatsApp/Instagram/etc. Which apps a person
 * can share to depends on what they have installed, and only the operating
 * system knows that — so we hand off to the OS share sheet, which lists exactly
 * the apps that are there. Hardcoding a list would show apps the user doesn't
 * have and miss the ones they do.
 *
 *   Android/iOS -> React Native's Share opens the native sheet.
 *   Web         -> navigator.share() opens the same sheet where the browser
 *                  supports it (Android Chrome, Safari); otherwise we copy.
 *
 * Copy-to-clipboard is always available as the fallback that works everywhere.
 */

export type Shareable = {
  title: string;
  /** One line describing what's being shared. */
  message: string;
  url: string;
};

export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'failed';

function webShareAvailable(): boolean {
  return (
    Platform.OS === 'web' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'
  );
}

/** True when this device can offer more than a plain copy. */
export function canOpenShareSheet(): boolean {
  return Platform.OS !== 'web' || webShareAvailable();
}

export async function copyLink(url: string): Promise<ShareOutcome> {
  try {
    await Clipboard.setStringAsync(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Open the OS share sheet, falling back to the clipboard when there isn't one. */
export async function shareLink(item: Shareable): Promise<ShareOutcome> {
  const body = `${item.message}\n${item.url}`;

  if (Platform.OS === 'web') {
    if (webShareAvailable()) {
      try {
        await navigator.share({ title: item.title, text: item.message, url: item.url });
        return 'shared';
      } catch (e) {
        // The user closing the sheet throws AbortError; that isn't a failure.
        if (e instanceof Error && e.name === 'AbortError') return 'dismissed';
        return copyLink(item.url);
      }
    }
    return copyLink(item.url);
  }

  try {
    const res = await Share.share({ title: item.title, message: body }, { dialogTitle: item.title });
    return res.action === Share.dismissedAction ? 'dismissed' : 'shared';
  } catch {
    return copyLink(item.url);
  }
}
