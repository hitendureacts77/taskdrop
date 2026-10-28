import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { RoleTheme } from './src/providers/ThemeProvider';
import { useMode } from './src/providers/ModeProvider';
import { useAuth } from './src/providers/AuthProvider';
import { NavProvider } from './src/providers/NavProvider';
import { ScreenHost } from './src/navigation/ScreenHost';
import { AgeGate } from './src/components/AgeGate';
import { Overlays } from './src/components/Overlays';
import { StagingWelcome } from './src/components/StagingWelcome';
import { TourHost } from './src/components/tour/TourHost';
import { WebShell } from './src/components/WebShell';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AppProviders, Background, ScreenBoundary, ThemedStatusBar } from './src/AppProviders';

/**
 * The web app (the phone apps start in app/_layout.tsx instead, where the
 * bottom tabs are the system's native tabs). Starts on the feed when a session
 * is restored, otherwise at the splash.
 */
function Routes() {
  const { ready, session, postAuthRoute } = useAuth();
  const { mode } = useMode();
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0F1012' }} />;
  return (
    // Signed in and earning: the whole app turns royal blue. Sign-up and the
    // welcome screens keep the brand green.
    <RoleTheme worker={Boolean(session) && mode === 'worker'}>
    <NavProvider initial={postAuthRoute ?? (session ? 'home' : 'splash')}>
      <ThemedStatusBar />
      <Background />
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
            <StagingWelcome />
            <TourHost />
          </ErrorBoundary>
        </KeyboardAvoidingView>
      </WebShell>
    </NavProvider>
    </RoleTheme>
  );
}

function AppRoot() {
  return (
    <AppProviders>
      <Routes />
    </AppProviders>
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
