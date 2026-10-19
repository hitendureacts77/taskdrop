import { View } from 'react-native';
import { RoleTheme } from '../providers/ThemeProvider';
import { useMode } from '../providers/ModeProvider';
import { useAuth } from '../providers/AuthProvider';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AppProviders, Background, ThemedStatusBar } from '../AppProviders';
import { NativeRoot } from '../navigation/NativeRoot';
import { decideStart } from '../navigation/nativeStart';
import { withMonitoring } from '../lib/monitoring';

/**
 * Root of the iOS and Android apps. The web build does not come through here
 * (index.ts starts App.tsx for it). The five main tabs are src/app/(tabs),
 * every other screen is src/app/screen/[name], and NativeRoot holds them in a
 * native stack.
 */
function Routes() {
  const { ready, session, postAuthRoute } = useAuth();
  const { mode } = useMode();
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0F1012' }} />;
  decideStart(postAuthRoute === 'setup' ? 'setup' : session ? null : 'splash');
  return (
    // Signed in and earning: the whole app turns royal blue. Sign-up and the
    // welcome screens keep the brand green.
    <RoleTheme worker={Boolean(session) && mode === 'worker'}>
      <ThemedStatusBar />
      <Background />
      <NativeRoot />
    </RoleTheme>
  );
}

function RootLayout() {
  return (
    <ErrorBoundary>
      <AppProviders>
        <Routes />
      </AppProviders>
    </ErrorBoundary>
  );
}

export default withMonitoring(RootLayout);
