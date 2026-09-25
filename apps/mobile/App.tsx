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
import { ThemeProvider } from './src/providers/ThemeProvider';
import { ModeProvider } from './src/providers/ModeProvider';
import { AppStateProvider } from './src/providers/AppStateProvider';
import { AuthProvider, useAuth } from './src/providers/AuthProvider';
import { NavProvider } from './src/providers/NavProvider';
import { ScreenHost } from './src/navigation/ScreenHost';
import { Overlays } from './src/components/Overlays';
import { WebShell } from './src/components/WebShell';
import { PushBridge } from './src/components/PushBridge';
import { SessionWatch } from './src/components/SessionWatch';
import { PresenceBeat } from './src/components/PresenceBeat';

/** Starts on the feed when a session is restored, otherwise at the splash. */
function Routes() {
  const { ready, session, postAuthRoute } = useAuth();
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0F1012' }} />;
  return (
    <NavProvider initial={postAuthRoute ?? (session ? 'home' : 'splash')}>
      <StatusBar style="auto" />
      <PushBridge />
      <SessionWatch />
      <PresenceBeat />
      <WebShell>
        <View style={{ flex: 1 }}>
          <ScreenHost />
          <Overlays />
        </View>
      </WebShell>
    </NavProvider>
  );
}

export default function App() {
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
              <Routes />
            </AppStateProvider>
          </ModeProvider>
        </AuthProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}
