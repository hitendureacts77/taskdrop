import { useEffect } from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { ANDROID_APK_URL, ANDROID_APP_VERSION, browserInfo, isAppleMobile } from '../lib/appDownload';
import { goTo } from '../lib/appPrompt';
import { Icon } from './Icon';
import { HeroCard } from './Hero';
import { Drop } from './Ripples';
import { cardSurface } from './ui';
import { tx } from './primitives';

const STEPS = [
  { title: 'Open the file', sub: 'Tap the download when it finishes, or find it in Files › Downloads.' },
  {
    title: 'Allow it once',
    sub: 'If Android asks, tap Settings and turn on "Allow from this source". You only do this once.',
  },
  { title: 'Tap Install, then Open', sub: 'Sign in with the same number you use on the website.' },
];

/**
 * The public download page, taskdrop.in/get (design D17). Shown by AppGate on
 * the web before anything else, so it opens for anyone, signed in or not. It
 * is the one fixed address the banner, the sheet and the QR code all point at;
 * when the app reaches Google Play only ANDROID_APK_URL (lib/appDownload.ts)
 * changes. On an iPhone the download is replaced by a way back to the website.
 */
export function GetApp() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const { ua, touch } = browserInfo();
  const apple = isAppleMobile(ua, touch);

  useEffect(() => {
    if (typeof document !== 'undefined') document.title = 'Get TaskDrop for Android';
  }, []);

  const toWebsite = () => goTo('/');

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.colors.bg }}
      contentContainerStyle={{ alignItems: 'center', paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24, flexGrow: 1 }}
    >
      <View style={{ width: '100%', maxWidth: 520, paddingHorizontal: 20, flexGrow: 1 }}>
        <HeroCard radius={22} padding={22} ringSize={200}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: 14,
                backgroundColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Drop size={34} fill={t.colors.heroMid} tick="#FFFFFF" />
            </View>
            <RNText style={tx('700', 11, 'rgba(255,255,255,0.85)', { letterSpacing: 1.3 })}>TASKDROP FOR ANDROID</RNText>
          </View>
          <RNText
            accessibilityRole="header"
            style={tx('800', 26, '#FFFFFF', { lineHeight: 31, letterSpacing: -0.7, marginTop: 14 })}
          >
            Install TaskDrop on your Android phone
          </RNText>
          {apple ? (
            <>
              <RNText style={tx('600', 14, 'rgba(255,255,255,0.92)', { lineHeight: 20, marginTop: 8 })}>
                On an iPhone? Use the website. It works in your browser, with nothing to install.
              </RNText>
              <Pressable
                onPress={toWebsite}
                accessibilityRole="link"
                accessibilityLabel="Use the website"
                style={({ pressed }) => ({
                  marginTop: 18,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: '#FFFFFF',
                  alignItems: 'center',
                  justifyContent: 'center',
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <RNText style={tx('800', 16, t.colors.heroTo)}>Use the website</RNText>
              </Pressable>
            </>
          ) : (
            <>
              <RNText style={tx('400', 13, 'rgba(255,255,255,0.85)', { marginTop: 8 })}>
                Version {ANDROID_APP_VERSION} · Android 8 or newer
              </RNText>
              <Pressable
                onPress={() => goTo(ANDROID_APK_URL)}
                accessibilityRole="link"
                accessibilityLabel="Download the app"
                style={({ pressed }) => ({
                  marginTop: 18,
                  height: 52,
                  borderRadius: 16,
                  backgroundColor: '#FFFFFF',
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  opacity: pressed ? 0.9 : 1,
                })}
              >
                <Icon name="download" size={18} color={t.colors.heroTo} strokeWidth={2.4} />
                <RNText style={tx('800', 16, t.colors.heroTo)}>Download the app</RNText>
              </Pressable>
            </>
          )}
        </HeroCard>

        {apple ? null : (
          <>
            <RNText accessibilityRole="header" style={tx('800', 18, t.colors.ink, { letterSpacing: -0.35, marginTop: 24, marginBottom: 2 })}>
              Then 3 quick steps
            </RNText>
            {STEPS.map((s, i) => (
              <View
                key={s.title}
                style={[cardSurface(t, 18), { flexDirection: 'row', alignItems: 'flex-start', gap: 12, padding: 14, marginTop: 10 }]}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 999,
                    backgroundColor: t.colors.accentSoft,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText style={tx('800', 14, t.colors.accentDeep)}>{i + 1}</RNText>
                </View>
                <View style={{ flex: 1 }}>
                  <RNText style={tx('700', 15, t.colors.ink)}>{s.title}</RNText>
                  <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 19, marginTop: 2 })}>{s.sub}</RNText>
                </View>
              </View>
            ))}
          </>
        )}

        {apple ? null : (
        <View
          style={{
            marginTop: 14,
            flexDirection: 'row',
            alignItems: 'flex-start',
            gap: 10,
            paddingVertical: 12,
            paddingHorizontal: 14,
            borderRadius: 14,
            backgroundColor: t.colors.goldSoft,
          }}
        >
          <View style={{ marginTop: 1 }}>
            <Icon name="shield" size={18} color={t.colors.goldInk} strokeWidth={2} />
          </View>
          <RNText style={tx('500', 13, t.colors.goldInk, { flex: 1, lineHeight: 19 })}>
            Only download TaskDrop from taskdrop.in. We never send the app on WhatsApp or by SMS.
          </RNText>
        </View>
        )}

        <View style={{ flex: 1, minHeight: 20 }} />
        <View style={{ alignItems: 'center', paddingTop: 20, gap: 2 }}>
          {apple ? null : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' }}>
              <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 20 })}>On an iPhone? </RNText>
              <Pressable onPress={toWebsite} accessibilityRole="link" accessibilityLabel="On an iPhone? Use the website" hitSlop={8}>
                <RNText style={tx('700', 13, t.colors.accentDeep, { lineHeight: 20 })}>Use the website</RNText>
              </Pressable>
            </View>
          )}
          <RNText style={tx('400', 13, t.colors.muted, { lineHeight: 20 })}>Google Play: coming soon</RNText>
        </View>
      </View>
    </ScrollView>
  );
}
