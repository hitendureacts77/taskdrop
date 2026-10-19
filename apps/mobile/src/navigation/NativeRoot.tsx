import { useMemo } from 'react';
import { KeyboardAvoidingView } from 'react-native';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import { useTheme } from '../providers/ThemeProvider';
import { useAuth } from '../providers/AuthProvider';
import { AgeGate } from '../components/AgeGate';
import { Overlays } from '../components/Overlays';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { ScreenBoundary } from '../AppProviders';
import { fontFamilyFor } from '../theme';
import type { ScreenName } from '../providers/navTypes';
import { NATIVE_HEADER_SCREENS } from './nativeHeader';

/** Sign-in and welcome screens: no swiping back out of them. */
const NO_BACK = ['splash', 'welcome', 'signup', 'setup'];
const FADE = ['splash', 'welcome'];

/**
 * The phone apps' navigation. A native stack holds the tabs (src/app/(tabs),
 * the system's tab bar) and every other screen (src/app/screen/[name]) on top
 * of them, with the system's own transitions, swipe-back and Android back.
 */
export function NativeRoot() {
  const t = useTheme();
  const { session } = useAuth();
  const c = t.colors;

  // Without this the navigator's own theme (white) flashes between screens.
  const navTheme = useMemo(() => {
    const base = t.isDark ? DarkTheme : DefaultTheme;
    return {
      ...base,
      colors: { ...base.colors, primary: c.accentDeep, background: c.bg, card: c.surface, text: c.ink, border: c.line },
    };
  }, [t.isDark, c.accentDeep, c.bg, c.surface, c.ink, c.line]);

  return (
    // Android draws edge to edge since SDK 53, so the window no longer shrinks
    // for the keyboard and a focused field could sit under it. One wrapper
    // here lifts every screen; the ScrollViews inside then bring the focused
    // field into view themselves.
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
      <ScreenBoundary home={session ? 'home' : 'splash'}>
        <AgeGate>
          <NavThemeProvider value={navTheme}>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: c.bg } }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen
                name="screen/[name]"
                options={({ route }) => {
                  const name = String((route.params as { name?: string } | undefined)?.name ?? '');
                  return {
                    gestureEnabled: !NO_BACK.includes(name),
                    animation: FADE.includes(name) ? 'fade' : 'default',
                    // The system header for screens with a TopBar (it fills in the title); the page's colours and type.
                    headerShown: NATIVE_HEADER_SCREENS.includes(name as ScreenName),
                    title: '',
                    headerShadowVisible: false,
                    headerBackButtonDisplayMode: 'minimal',
                    headerStyle: { backgroundColor: c.bg },
                    headerTintColor: c.ink,
                    headerTitleStyle: { color: c.ink, fontFamily: fontFamilyFor('800'), fontSize: 18 },
                  };
                }}
              />
            </Stack>
          </NavThemeProvider>
        </AgeGate>
      </ScreenBoundary>
      <ErrorBoundary silent>
        <Overlays />
      </ErrorBoundary>
    </KeyboardAvoidingView>
  );
}
