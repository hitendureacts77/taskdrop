import { useEffect } from 'react';
import { Pressable, Text as RNText, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { goTo } from '../lib/appPrompt';
import { NOT_FOUND_TITLE } from '../navigation/webAddress';
import { PrimaryButton } from './kit';
import { Drop } from './Ripples';
import { tx } from './primitives';

/**
 * "Page not found" (plan 3.6, T13 point 8). Web only: AppGate shows it before sign-in, maintenance or anything
 * else when the address is not one the website answers (isKnownPath in navigation/webAddress.ts), so a wrong link
 * never lands on the sign-in screen. On Cloudflare the same address also comes back with status 404
 * (dist/404.html, scripts/web-route-pages.mjs). The brand green on purpose: nobody is in Hire or Earn here.
 * The logo and "Go to Home" both go to "/"; a second link opens Help and support.
 */
export function NotFound() {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.title = NOT_FOUND_TITLE;
    // Never indexed, even where the host answered 200 (the Vercel copy of the site).
    let meta = document.querySelector('meta[name="robots"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'robots');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', 'noindex');
  }, []);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: t.colors.bg,
        alignItems: 'center',
        justifyContent: 'center',
        paddingHorizontal: 24,
        paddingTop: insets.top + 24,
        paddingBottom: insets.bottom + 24,
      }}
    >
      <View style={{ width: '100%', maxWidth: 420, alignItems: 'center' }}>
        <Pressable
          onPress={() => goTo('/')}
          accessibilityRole="link"
          accessibilityLabel="taskdrop. Go to Home"
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}
        >
          <Drop size={28} fill={t.colors.accent} tick="#FFFFFF" />
          <RNText style={tx('800', 22, t.colors.ink, { letterSpacing: -0.4 })}>
            taskdrop<RNText style={{ color: t.colors.accent }}>.</RNText>
          </RNText>
        </Pressable>
        <RNText style={tx('800', 56, t.colors.accent, { marginTop: 28, letterSpacing: -1.5 })}>404</RNText>
        <RNText accessibilityRole="header" style={tx('800', 26, t.colors.ink, { marginTop: 4, textAlign: 'center', letterSpacing: -0.5 })}>
          Page not found
        </RNText>
        <RNText style={tx('500', 15, t.colors.muted, { marginTop: 10, textAlign: 'center', lineHeight: 22 })}>
          This address does not lead anywhere on TaskDrop. It may be an old link, or a typing slip.
        </RNText>
        <View style={{ marginTop: 28, width: '100%' }}>
          <PrimaryButton label="Go to Home" onPress={() => goTo('/')} />
        </View>
        <Pressable onPress={() => goTo('/support')} accessibilityRole="link" hitSlop={8} style={{ marginTop: 16, minHeight: 44, justifyContent: 'center' }}>
          <RNText style={tx('700', 15, t.colors.accentDeep)}>Help and support</RNText>
        </Pressable>
      </View>
    </View>
  );
}
