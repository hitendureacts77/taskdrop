/**
 * Where the website sends people who want the Android app (design D17).
 *
 * `/get` is the one fixed address everything points at (the banner, the sheet,
 * the QR code, anything printed). Later, when the app is on Google Play, only
 * ANDROID_APK_URL changes (to the Play listing); no link anywhere else moves.
 *
 * This file is plain TypeScript with no React Native imports so the unit tests
 * can run it directly. Anything that touches the browser takes it as an
 * argument or is wrapped in try/catch (storage can be blocked or throw).
 */

/** The newest beta build (EAS artifact). */
export const ANDROID_APK_URL = 'https://expo.dev/artifacts/eas/k90BtDJNbV-_yOehTtP2bBTdWK_z449YcDrFV3MRyGE.apk';
/** The app version that file contains. */
export const ANDROID_APP_VERSION = '1.1.0';
/** The fixed address of the download page on the website. */
export const GET_PATH = '/get';

/** How long the top bar stays hidden after the visitor closes it. */
export const BANNER_HIDE_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

const KEY_BANNER_DISMISSED = 'taskdrop.getApp.bannerDismissedAt';
const KEY_SHEET_SHOWN = 'taskdrop.getApp.sheetShown';

/** An Android phone (or tablet) browser. */
export function isAndroidWeb(ua: string | null | undefined): boolean {
  return /\bAndroid\b/i.test(ua ?? '');
}

/**
 * An iPhone or iPad. iPadOS asks for the desktop site and reports a Mac, so a
 * "Macintosh" with a touch screen counts as an iPad (a real Mac has no touch points).
 */
export function isAppleMobile(ua: string | null | undefined, maxTouchPoints = 0): boolean {
  const s = ua ?? '';
  if (/\b(iPhone|iPad|iPod)\b/i.test(s)) return true;
  return /\bMacintosh\b/i.test(s) && maxTouchPoints > 1;
}

/** The download page itself, with or without a trailing slash. */
export function isGetPath(pathname: string | null | undefined): boolean {
  return pathname === GET_PATH || pathname === `${GET_PATH}/`;
}

/**
 * The top bar shows unless it was closed in the last 14 days. A time in the
 * future (a clock that moved, or a damaged value) never hides it.
 */
export function shouldShowBanner(now: number, dismissedAt: number | null | undefined): boolean {
  if (dismissedAt == null || !Number.isFinite(dismissedAt)) return true;
  if (dismissedAt > now) return true;
  return now - dismissedAt >= BANNER_HIDE_DAYS * DAY_MS;
}

/**
 * The one-time sheet: Android browsers only, once per browser, and not while
 * the visitor has said no thanks by closing the top bar.
 */
export function shouldShowSheet(input: {
  ua: string | null | undefined;
  now: number;
  bannerDismissedAt: number | null | undefined;
  sheetShown: boolean;
}): boolean {
  if (!isAndroidWeb(input.ua)) return false;
  if (input.sheetShown) return false;
  return shouldShowBanner(input.now, input.bannerDismissedAt);
}

// ---- browser storage (always guarded) ---------------------------------------

function read(key: string): string | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    // Blocked or full: the prompt may come back on the next visit, which is harmless.
  }
}

export function readBannerDismissedAt(): number | null {
  const raw = read(KEY_BANNER_DISMISSED);
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function writeBannerDismissedAt(now: number): void {
  write(KEY_BANNER_DISMISSED, String(now));
}

export function readSheetShown(): boolean {
  return read(KEY_SHEET_SHOWN) === '1';
}

export function writeSheetShown(): void {
  write(KEY_SHEET_SHOWN, '1');
}

/** The browser's user agent and touch points, or empty values outside a browser. */
export function browserInfo(): { ua: string; touch: number } {
  if (typeof navigator === 'undefined') return { ua: '', touch: 0 };
  return { ua: navigator.userAgent ?? '', touch: navigator.maxTouchPoints ?? 0 };
}
