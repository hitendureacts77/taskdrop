import type { ReactNode } from 'react';
import { View } from 'react-native';
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
import { ThemeProvider, useTheme } from './providers/ThemeProvider';
import { ModeProvider } from './providers/ModeProvider';
import { AppStateProvider } from './providers/AppStateProvider';
import { AuthProvider } from './providers/AuthProvider';
import { SyncProvider } from './providers/SyncProvider';
import { useNav } from './providers/NavProvider';
import { ErrorBoundary } from './components/ErrorBoundary';
import { AppGate } from './components/AppGate';
import { PushBridge } from './components/PushBridge';
import { SessionWatch } from './components/SessionWatch';
import { PresenceBeat } from './components/PresenceBeat';
import { PublicPageLink } from './components/PublicPageLink';

/**
 * Wraps the current screen. A crash inside it shows the "try again" page, and
 * moving to another screen tries again on its own, so one broken screen never
 * takes the whole app down with it.
 */
export function ScreenBoundary({ home, children }: { home: 'home' | 'splash'; children: ReactNode }) {
  const { screen, reset } = useNav();
  return (
    <ErrorBoundary resetKey={screen} onHome={() => reset(home)}>
      {children}
    </ErrorBoundary>
  );
}

/** Status bar icons follow the app's own theme (light/dark/system), not the phone's. */
export function ThemedStatusBar() {
  const t = useTheme();
  return <StatusBar style={t.isDark ? 'light' : 'dark'} />;
}

/** No UI of their own: if one throws, the screen carries on without it. */
export function Background() {
  return (
    <ErrorBoundary silent>
      <PushBridge />
      <SessionWatch />
      <PresenceBeat />
      <PublicPageLink />
    </ErrorBoundary>
  );
}

/**
 * Fonts and every provider the app needs, shared by the web entry (App.tsx)
 * and the native tabs layout (app/_layout.tsx). Navigation sits below this.
 */
export function AppProviders({ children }: { children: ReactNode }) {
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
                {/* Maintenance, "update the app" and the announcement banner, from the admin panel. */}
                <AppGate>{children}</AppGate>
              </SyncProvider>
            </AppStateProvider>
          </ModeProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
