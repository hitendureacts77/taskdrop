import { useEffect, useState } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import {
  GET_PATH,
  browserInfo,
  isAndroidWeb,
  isAppleMobile,
  isGetPath,
  readBannerDismissedAt,
  shouldShowBanner,
  writeBannerDismissedAt,
} from '../lib/appDownload';
import { goTo } from '../lib/appPrompt';
import { Icon } from './Icon';
import { Drop } from './Ripples';
import { tx } from './primitives';

/**
 * A slim bar across the very top of every page on an Android phone's browser:
 * the app icon, one line of why, a "Get app" pill that goes to /get, and a
 * close that hides it for 14 days. Never on an iPhone or iPad, never on a
 * desktop, and not on the download page itself.
 */
export function AppBanner() {
  const t = useTheme();
  const [show, setShow] = useState(false);

  useEffect(() => {
    const { ua, touch } = browserInfo();
    const eligible = isAndroidWeb(ua) && !isAppleMobile(ua, touch) && !isGetPath(window.location.pathname);
    setShow(eligible && shouldShowBanner(Date.now(), readBannerDismissedAt()));
  }, []);

  if (!show) return null;
  return (
    <View
      accessibilityRole="banner"
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        paddingVertical: 10,
        paddingLeft: 14,
        paddingRight: 8,
        backgroundColor: t.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: t.colors.line,
      }}
    >
      <View
        style={{
          width: 38,
          height: 38,
          borderRadius: 10,
          backgroundColor: t.colors.heroMid,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Drop size={26} fill="#FFFFFF" tick={t.colors.heroMid} />
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText style={tx('700', 14, t.colors.ink)} numberOfLines={1}>
          TaskDrop for Android
        </RNText>
        <RNText style={tx('400', 12, t.colors.muted)} numberOfLines={1}>
          Free · alerts the second someone replies
        </RNText>
      </View>
      <Pressable
        onPress={() => goTo(GET_PATH)}
        accessibilityRole="link"
        accessibilityLabel="Get the TaskDrop Android app"
        style={({ pressed }) => ({
          backgroundColor: t.colors.btn,
          paddingVertical: 8,
          paddingHorizontal: 14,
          borderRadius: 999,
          opacity: pressed ? 0.85 : 1,
        })}
      >
        <RNText style={tx('800', 13, t.colors.onBtn)}>Get app</RNText>
      </Pressable>
      <Pressable
        onPress={() => {
          writeBannerDismissedAt(Date.now());
          setShow(false);
        }}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close"
        style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="close" size={16} color={t.colors.muted} strokeWidth={2.4} />
      </Pressable>
    </View>
  );
}
