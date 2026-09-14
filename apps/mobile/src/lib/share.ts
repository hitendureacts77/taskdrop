import { Platform, Share, Linking } from 'react-native';
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

export type ShareTargetId = 'whatsapp' | 'telegram' | 'x' | 'facebook' | 'email' | 'sms' | 'instagram';

export type ShareTarget = {
  id: ShareTargetId;
  label: string;
  /** Two letters, because bundling seven brand logos for this is not worth it. */
  glyph: string;
  hint: string;
};

/**
 * The apps we can hand a link to directly.
 *
 * Instagram is in this list and behaves differently on purpose: it has no
 * public way to receive a link from another app — no share intent, no prefilled
 * DM, nothing. Every app that appears to "share to Instagram" is really
 * copying to the clipboard and asking you to paste. So that is what this does,
 * and it says so, rather than opening instagram:// and leaving someone staring
 * at an empty compose box wondering where their link went.
 */
export const SHARE_TARGETS: ShareTarget[] = [
  { id: 'whatsapp', label: 'WhatsApp', glyph: 'WA', hint: 'Send in a chat' },
  { id: 'instagram', label: 'Instagram', glyph: 'IG', hint: 'Copies — paste in a story or DM' },
  { id: 'telegram', label: 'Telegram', glyph: 'TG', hint: 'Send in a chat' },
  { id: 'x', label: 'X', glyph: 'X', hint: 'Post it' },
  { id: 'facebook', label: 'Facebook', glyph: 'FB', hint: 'Post it' },
  { id: 'sms', label: 'Message', glyph: 'SMS', hint: 'Text it to someone' },
  { id: 'email', label: 'Email', glyph: '@', hint: 'Send as an email' },
];

/** The URL that hands this link to that app, or null when there is not one. */
function targetUrl(id: ShareTargetId, item: Shareable): string | null {
  const text = encodeURIComponent(`${item.message}`);
  const url = encodeURIComponent(item.url);
  const both = encodeURIComponent(`${item.message}
${item.url}`);

  switch (id) {
    case 'whatsapp':
      // wa.me works on the web and opens the app on a phone, so one URL covers
      // both instead of branching on a scheme that web cannot open.
      return `https://wa.me/?text=${both}`;
    case 'telegram':
      return `https://t.me/share/url?url=${url}&text=${text}`;
    case 'x':
      return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
    case 'facebook':
      return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
    case 'sms':
      // iOS wants &body, Android wants ?body. This form works on both.
      return Platform.OS === 'ios' ? `sms:&body=${both}` : `sms:?body=${both}`;
    case 'email':
      return `mailto:?subject=${encodeURIComponent(item.title)}&body=${both}`;
    case 'instagram':
      // Deliberately none. See the note on SHARE_TARGETS.
      return null;
  }
}

/** Hand the link to one named app. Instagram copies, because it must. */
export async function shareTo(id: ShareTargetId, item: Shareable): Promise<ShareOutcome> {
  if (id === 'instagram') return copyLink(item.url);
  const url = targetUrl(id, item);
  if (!url) return copyLink(item.url);

  try {
    if (Platform.OS === 'web') {
      // A new tab, so the app is not navigated away from mid-task.
      window.open(url, '_blank', 'noopener,noreferrer');
      return 'shared';
    }
    const ok = await Linking.canOpenURL(url);
    if (!ok) return copyLink(item.url);
    await Linking.openURL(url);
    return 'shared';
  } catch {
    return copyLink(item.url);
  }
}

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
