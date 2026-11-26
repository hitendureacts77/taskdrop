import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { RoleTheme } from './src/providers/ThemeProvider';
import { useMode } from './src/providers/ModeProvider';
import { useAuth } from './src/providers/AuthProvider';
import { NavProvider } from './src/providers/NavProvider';
import { ScreenHost } from './src/navigation/ScreenHost';
import { AgeGate } from './src/components/AgeGate';
import { ResumePost } from './src/components/ResumePost';
import { Overlays } from './src/components/Overlays';
import { AccountPrompt } from './src/components/AccountPrompt';
import { StagingWelcome } from './src/components/StagingWelcome';
import { WalkthroughHost } from './src/components/WalkthroughHost';
import { AppSheet } from './src/components/AppSheet';
import { WebShell } from './src/components/WebShell';
import { ConsentBanner } from './src/components/ConsentBanner';
import { ErrorBoundary } from './src/components/ErrorBoundary';
import { AppProviders, Background, ScreenBoundary, ThemedStatusBar } from './src/AppProviders';
import { usesWorkerColours } from './src/lib/roleColours';
import { useDesktopScale } from './src/lib/desktopScale';
import './src/lib/webScrollbar';

/**
 * The web app (the phone apps start in app/_layout.tsx instead, where the
 * bottom tabs are the system's native tabs). Starts on the feed when a session
 * is restored, otherwise at the splash.
 */
function Routes() {
  const { ready, session, postAuthRoute, guest } = useAuth();
  const { mode } = useMode();
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0F1012' }} />;
  return (
    // Earning, signed in or as a guest: the whole app turns royal blue. Sign-up and the
    // welcome screens keep the brand green.
    <RoleTheme worker={usesWorkerColours({ session, guest, mode })}>
    {/* No username yet (plan 1.18): Home underneath, and the gate (components/UsernameGate) opens over it. */}
    <NavProvider initial={postAuthRoute === 'setup' ? 'setup' : postAuthRoute || session || guest ? 'home' : 'splash'}>
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
          <ScreenBoundary home={session || guest ? 'home' : 'splash'}>
            <AgeGate>
              <ScreenHost />
              <ResumePost />
            </AgeGate>
          </ScreenBoundary>
          <ErrorBoundary silent>
            <Overlays />
            <AccountPrompt />
            <StagingWelcome />
            <WalkthroughHost />
            <AppSheet />
          </ErrorBoundary>
        </KeyboardAvoidingView>
      </WebShell>
      <ErrorBoundary silent>
        <ConsentBanner />
      </ErrorBoundary>
    </NavProvider>
    </RoleTheme>
  );
}

function AppRoot() {
  // A desktop browser zooms the whole page with the window (lib/layout.ts).
  useDesktopScale();
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
