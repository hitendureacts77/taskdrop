import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  PlusJakartaSans_400Regular,
  PlusJakartaSans_500Medium,
  PlusJakartaSans_600SemiBold,
  PlusJakartaSans_700Bold,
  PlusJakartaSans_800ExtraBold,
} from '@expo-google-fonts/plus-jakarta-sans';
import { RoleTheme, ThemeProvider } from './src/providers/ThemeProvider';
import { ModeProvider, useMode } from './src/providers/ModeProvider';
import { AppStateProvider } from './src/providers/AppStateProvider';
import { AuthProvider, useAuth } from './src/providers/AuthProvider';
import { NavProvider } from './src/providers/NavProvider';
import { SyncProvider } from './src/providers/SyncProvider';
import { ScreenHost } from './src/navigation/ScreenHost';
import { AgeGate } from './src/components/AgeGate';
import { Overlays } from './src/components/Overlays';
import { WebShell } from './src/components/WebShell';
import { PushBridge } from './src/components/PushBridge';
import { SessionWatch } from './src/components/SessionWatch';
import { PresenceBeat } from './src/components/PresenceBeat';
import { PublicPageLink } from './src/components/PublicPageLink';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { useNav } from './src/providers/NavProvider';

/**
 * Wraps the current screen. A crash inside it shows the "try again" page, and
 * moving to another screen tries again on its own, so one broken screen never
 * takes the whole app down with it.
 */
function ScreenBoundary({ home, children }: { home: 'home' | 'splash'; children: ReactNode }) {
  const { screen, reset } = useNav();
  return (
    <ErrorBoundary resetKey={screen} onHome={() => reset(home)}>
      {children}
    </ErrorBoundary>
  );
}

/** Starts on the feed when a session is restored, otherwise at the splash. */
function Routes() {
  const { ready, session, postAuthRoute } = useAuth();
  const { mode } = useMode();
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0F1012' }} />;
  return (
    // Signed in and earning: the whole app turns royal blue. Sign-up and the
    // welcome screens keep the brand green.
    <RoleTheme worker={Boolean(session) && mode === 'worker'}>
    <NavProvider initial={postAuthRoute ?? (session ? 'home' : 'splash')}>
      <StatusBar style="auto" />
      {/* No UI of their own: if one throws, the screen carries on without it. */}
      <ErrorBoundary silent>
        <PushBridge />
        <SessionWatch />
        <PresenceBeat />
        <PublicPageLink />
      </ErrorBoundary>
      <WebShell>
        {/* Android draws edge to edge since SDK 53, so the window no longer
            shrinks for the keyboard and a focused field could sit under it.
            One wrapper here lifts every screen; the ScrollViews inside then
            bring the focused field into view themselves. */}
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior="padding"
          enabled={Platform.OS !== 'web'}
        >
          <ScreenBoundary home={session ? 'home' : 'splash'}>
            <AgeGate>
              <ScreenHost />
            </AgeGate>
          </ScreenBoundary>
          <ErrorBoundary silent>
            <Overlays />
          </ErrorBoundary>
        </KeyboardAvoidingView>
      </WebShell>
    </NavProvider>
    </RoleTheme>
  );
}

function AppRoot() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  // Never block the whole app on a font: if loading fails, render anyway and
  // fall back to the system face rather than showing a blank screen.
  if (!fontsLoaded && !fontError) {
    return <View style={{ flex: 1, backgroundColor: '#0F1012' }} />;
  }

  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <AuthProvider>
          <ModeProvider initial="worker">
            <AppStateProvider>
              <SyncProvider>
                <Routes />
              </SyncProvider>
            </AppStateProvider>
          </ModeProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

/**
 * Last line of defence. Wraps the providers themselves, so a failure in the
 * theme, auth or navigation setup still ends on the "try again" page rather
 * than a blank window.
 */
export default function App() {
  return (
    <ErrorBoundary>
      <AppRoot />
    </ErrorBoundary>
  );
}
