import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  useFonts,
  Manrope_400Regular,
  Manrope_500Medium,
  Manrope_600SemiBold,
  Manrope_700Bold,
  Manrope_800ExtraBold,
} from '@expo-google-fonts/manrope';
import { ThemeProvider } from './src/providers/ThemeProvider';
import { ModeProvider } from './src/providers/ModeProvider';
import { AppStateProvider } from './src/providers/AppStateProvider';
import { AuthProvider, useAuth } from './src/providers/AuthProvider';
import { NavProvider } from './src/providers/NavProvider';
import { ScreenHost } from './src/navigation/ScreenHost';
import { Overlays } from './src/components/Overlays';

/** Starts on the feed when a session is restored, otherwise at the splash. */
function Routes() {
  const { ready, session } = useAuth();
  if (!ready) return <View style={{ flex: 1, backgroundColor: '#0F1012' }} />;
  return (
    <NavProvider initial={session ? 'home' : 'splash'}>
      <StatusBar style="auto" />
      <View style={{ flex: 1 }}>
        <ScreenHost />
        <Overlays />
      </View>
    </NavProvider>
  );
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts({
    Manrope_400Regular,
    Manrope_500Medium,
    Manrope_600SemiBold,
    Manrope_700Bold,
    Manrope_800ExtraBold,
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
