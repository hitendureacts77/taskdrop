import { useEffect, useState } from 'react';
import { Platform, Pressable, Text as RNText, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useLayout, RAIL_WIDTH, SIDEBAR_WIDTH } from '../lib/layout';
import { cardSurface } from './ui';
import { tx } from './primitives';
import { currentConsent, subscribeConsent, writeConsent, type Consent } from '../lib/consent';

/** The saved choice, kept fresh as it changes (the banner, or the settings row). Web only; null elsewhere. */
export function useConsent(): Consent | null {
  const [c, setC] = useState<Consent | null>(() => (Platform.OS === 'web' ? currentConsent() : null));
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    setC(currentConsent());
    return subscribeConsent(setC);
  }, []);
  return c;
}

/**
 * Website only. A slim, non-modal bar on the first visit: storage keeps you signed in; crash reports
 * only with the person's OK. It never appears in the phone apps, and the screen behind stays usable.
 * On a phone-width window it sits above the bottom tab bar; on a tablet or desktop it is a compact
 * card at the bottom left, clear of the side menu.
 */
export function ConsentBanner() {
  if (Platform.OS !== 'web') return null;
  return <Bar />;
}

function Bar() {
  const t = useTheme();
  const { go } = useNav();
  const layout = useLayout();
  const consent = useConsent();
  if (consent) return null;

  const wide = layout.desktop || layout.tablet;
  const left = layout.desktop ? SIDEBAR_WIDTH + 16 : layout.tablet ? RAIL_WIDTH + 16 : 8;
  const button = (label: string, a11y: string, primary: boolean, onPress: () => void) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      style={({ pressed }) => ({
        paddingVertical: 9,
        paddingHorizontal: 14,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: primary ? t.colors.accent : t.colors.line,
        backgroundColor: primary ? t.colors.accent : 'transparent',
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <RNText style={tx('700', 13, primary ? t.colors.onAccent : t.colors.ink)}>{label}</RNText>
    </Pressable>
  );

  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: 0, justifyContent: 'flex-end', zIndex: 50 }}
    >
      <View
        accessibilityRole="region"
        accessibilityLabel="Cookies and crash reports"
        style={[
          cardSurface(t, 14),
          {
            padding: 14,
            gap: 10,
            marginLeft: left,
            marginBottom: wide ? 16 : 84,
            marginRight: wide ? 0 : 8,
            alignSelf: wide ? 'flex-start' : 'stretch',
            maxWidth: wide ? 420 : undefined,
          },
        ]}
      >
        <RNText style={tx('400', 13, t.colors.text, { lineHeight: 19 })}>
          We use your browser’s storage to keep you signed in. With your OK we also send crash reports so we can fix problems.
        </RNText>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
          {button('Essential only', 'Essential only: no crash reports', false, () => writeConsent(false))}
          {button('Accept all', 'Accept all: allow crash reports', true, () => writeConsent(true))}
          <Pressable onPress={() => go('privacy')} accessibilityRole="link" accessibilityLabel="Read the Privacy Policy" hitSlop={8}>
            <RNText style={tx('700', 13, t.colors.accentDeep, { textDecorationLine: 'underline' })}>Privacy</RNText>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

/** Settings row (web only): change the choice made on the banner. */
export function ConsentSetting({ style }: { style?: object }) {
  const t = useTheme();
  const consent = useConsent();
  if (Platform.OS !== 'web') return null;
  const on = consent?.analytics === true;
  const pick = (analytics: boolean, label: string) => (
    <Pressable
      key={label}
      onPress={() => writeConsent(analytics)}
      accessibilityRole="button"
      accessibilityState={{ selected: on === analytics }}
      accessibilityLabel={analytics ? 'Allow crash reports' : 'Essential only, no crash reports'}
      style={{
        flex: 1,
        paddingVertical: 10,
        borderRadius: 10,
        borderWidth: 1,
        borderColor: on === analytics ? t.colors.accent : t.colors.line,
        backgroundColor: on === analytics ? t.colors.accentSoft : 'transparent',
        alignItems: 'center',
      }}
    >
      <RNText style={tx('600', 13, on === analytics ? t.colors.ink : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );
  return (
    <View style={style}>
      <RNText style={tx('800', 15, t.colors.ink)}>Cookies and crash reports</RNText>
      <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4, lineHeight: 18 })}>
        Browser storage that keeps you signed in is always on. Crash reports help us fix problems and are sent only if you allow them.
      </RNText>
      <View style={{ flexDirection: 'row', gap: 8, marginTop: 12 }}>
        {pick(false, 'Essential only')}
        {pick(true, 'Allow crash reports')}
      </View>
    </View>
  );
}
