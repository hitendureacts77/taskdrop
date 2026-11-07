import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANDROID_APK_URL,
  BANNER_HIDE_DAYS,
  GET_PATH,
  isAndroidWeb,
  isAppleMobile,
  isGetPath,
  readBannerDismissedAt,
  readSheetShown,
  shouldShowBanner,
  shouldShowSheet,
  writeBannerDismissedAt,
  writeSheetShown,
} from './appDownload.ts';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; CPH2585) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15';
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const DAY = 24 * 60 * 60 * 1000;

test('the download target is one https address and one fixed path', () => {
  assert.ok(ANDROID_APK_URL.startsWith('https://'));
  assert.equal(GET_PATH, '/get');
});

test('isAndroidWeb: Android browsers only', () => {
  assert.equal(isAndroidWeb(ANDROID), true);
  assert.equal(isAndroidWeb(IPHONE), false);
  assert.equal(isAndroidWeb(WINDOWS), false);
  assert.equal(isAndroidWeb(''), false);
  assert.equal(isAndroidWeb(null), false);
});

test('isAppleMobile: iPhone, iPad, and an iPad asking for the desktop site', () => {
  assert.equal(isAppleMobile(IPHONE), true);
  assert.equal(isAppleMobile('Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X)'), true);
  assert.equal(isAppleMobile(IPAD_DESKTOP, 5), true);
  assert.equal(isAppleMobile(IPAD_DESKTOP, 0), false, 'a real Mac has no touch screen');
  assert.equal(isAppleMobile(ANDROID), false);
  assert.equal(isAppleMobile(undefined), false);
});

test('isGetPath matches /get and /get/ only', () => {
  assert.equal(isGetPath('/get'), true);
  assert.equal(isGetPath('/get/'), true);
  assert.equal(isGetPath('/'), false);
  assert.equal(isGetPath('/getaway'), false);
  assert.equal(isGetPath('/get/x'), false);
  assert.equal(isGetPath(null), false);
});

test('shouldShowBanner: hidden for 14 days after the close button', () => {
  const now = 1_800_000_000_000;
  assert.equal(BANNER_HIDE_DAYS, 14);
  assert.equal(shouldShowBanner(now, null), true);
  assert.equal(shouldShowBanner(now, undefined), true);
  assert.equal(shouldShowBanner(now, now), false);
  assert.equal(shouldShowBanner(now, now - 13 * DAY), false);
  assert.equal(shouldShowBanner(now, now - 14 * DAY), true);
  assert.equal(shouldShowBanner(now, now - 30 * DAY), true);
  assert.equal(shouldShowBanner(now, now + DAY), true, 'a time in the future never hides it');
  assert.equal(shouldShowBanner(now, Number.NaN), true);
});

test('shouldShowSheet: Android, once, and not right after the bar was closed', () => {
  const now = 1_800_000_000_000;
  const base = { ua: ANDROID, now, bannerDismissedAt: null, sheetShown: false };
  assert.equal(shouldShowSheet(base), true);
  assert.equal(shouldShowSheet({ ...base, ua: IPHONE }), false);
  assert.equal(shouldShowSheet({ ...base, ua: WINDOWS }), false);
  assert.equal(shouldShowSheet({ ...base, sheetShown: true }), false);
  assert.equal(shouldShowSheet({ ...base, bannerDismissedAt: now - 2 * DAY }), false);
  assert.equal(shouldShowSheet({ ...base, bannerDismissedAt: now - 20 * DAY }), true);
});

test('storage helpers never throw without a browser, and round-trip with one', () => {
  const g = globalThis as { localStorage?: unknown };
  assert.equal(readBannerDismissedAt(), null);
  assert.equal(readSheetShown(), false);
  writeBannerDismissedAt(5);
  writeSheetShown();

  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  try {
    assert.equal(readBannerDismissedAt(), null);
    writeBannerDismissedAt(1234);
    assert.equal(readBannerDismissedAt(), 1234);
    assert.equal(readSheetShown(), false);
    writeSheetShown();
    assert.equal(readSheetShown(), true);
    store.set('taskdrop.getApp.bannerDismissedAt', 'junk');
    assert.equal(readBannerDismissedAt(), null);

    // A blocked browser: every call throws, none may escape.
    g.localStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    assert.equal(readBannerDismissedAt(), null);
    assert.equal(readSheetShown(), false);
    writeBannerDismissedAt(1);
    writeSheetShown();
  } finally {
    delete g.localStorage;
  }
});
