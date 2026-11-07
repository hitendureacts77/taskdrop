import { useEffect, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import {
  GET_PATH,
  browserInfo,
  isAppleMobile,
  isGetPath,
  readBannerDismissedAt,
  readSheetShown,
  shouldShowSheet,
  writeSheetShown,
} from '../lib/appDownload';
import { goTo, subscribeFirstAction } from '../lib/appPrompt';
import { BottomSheet } from './kit';
import { Icon, type IconName } from './Icon';
import { Drop } from './Ripples';
import { tx } from './primitives';

const ROWS: { icon: IconName; title: string; sub: string }[] = [
  { icon: 'bell', title: 'Alerts the second someone replies', sub: 'Offers and messages, even with the app closed' },
  { icon: 'pin', title: 'The live map of helpers near you', sub: 'Smooth on your phone' },
  { icon: 'bolt', title: 'Opens in one tap', sub: 'Stay signed in, no typing the address' },
];

/**
 * Shown once per browser, on an Android phone, right after the visitor's first
 * search or first look at a task, unless they closed the top bar in the last
 * 14 days. It is marked as shown the moment it opens, so it never comes back.
 */
export function AppSheet() {
  const t = useTheme();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = subscribeFirstAction(() => {
      if (timer) return;
      const { ua, touch } = browserInfo();
      if (isAppleMobile(ua, touch) || isGetPath(window.location.pathname)) return;
      const ok = shouldShowSheet({
        ua,
        now: Date.now(),
        bannerDismissedAt: readBannerDismissedAt(),
        sheetShown: readSheetShown(),
      });
      if (!ok) return;
      // A beat after the results appear, so it does not cover them while they load.
      timer = setTimeout(() => {
        writeSheetShown();
        setOpen(true);
      }, 900);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, []);

  const close = () => setOpen(false);
  const download = () => {
    close();
    goTo(GET_PATH);
  };

  return (
    <BottomSheet visible={open} onClose={close}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: 14,
            backgroundColor: t.colors.heroMid,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Drop size={34} fill="#FFFFFF" tick={t.colors.heroMid} />
        </View>
        <RNText style={tx('800', 21, t.colors.ink, { flex: 1, lineHeight: 26, letterSpacing: -0.5 })} accessibilityRole="header">
          TaskDrop works best as an app
        </RNText>
      </View>

      {ROWS.map((r) => (
        <View key={r.title} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 14 }}>
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              backgroundColor: t.colors.accentSoft,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon name={r.icon} size={18} color={t.colors.accentDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('700', 15, t.colors.ink)}>{r.title}</RNText>
            <RNText style={tx('400', 13, t.colors.muted, { marginTop: 1 })}>{r.sub}</RNText>
          </View>
        </View>
      ))}

      <Pressable
        onPress={download}
        accessibilityRole="button"
        accessibilityLabel="Download for Android"
        style={({ pressed }) => ({
          marginTop: 22,
          height: 52,
          borderRadius: 16,
          backgroundColor: t.colors.btn,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
        })}
      >
        <Icon name="download" size={18} color={t.colors.onBtn} strokeWidth={2.4} />
        <RNText style={tx('800', 16, t.colors.onBtn)}>Download for Android</RNText>
      </Pressable>
      <Pressable
        onPress={close}
        accessibilityRole="button"
        accessibilityLabel="Keep using the website"
        style={({ pressed }) => ({
          marginTop: 10,
          height: 46,
          borderRadius: 16,
          borderWidth: 1,
          borderColor: t.colors.line,
          alignItems: 'center',
          justifyContent: 'center',
          opacity: pressed ? 0.8 : 1,
        })}
      >
        <RNText style={tx('700', 15, t.colors.ink)}>Keep using the website</RNText>
      </Pressable>
      <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 12, marginBottom: 6 }}>
        <RNText style={tx('400', 12.5, t.colors.muted)}>Free · </RNText>
        <Pressable onPress={download} accessibilityRole="link" accessibilityLabel="How to install" hitSlop={8}>
          <RNText style={tx('700', 12.5, t.colors.accentDeep)}>How to install</RNText>
        </Pressable>
      </View>
    </BottomSheet>
  );
}
