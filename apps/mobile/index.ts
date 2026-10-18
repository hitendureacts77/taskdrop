import { registerRootComponent } from 'expo';

import App from './App';
import { installGlobalErrorHandlers } from './src/lib/globalErrors';
import { installMonitoring, withMonitoring } from './src/lib/monitoring';

// First, so even a failure while the app is starting up is caught and reported.
installMonitoring();
installGlobalErrorHandlers();

if (process.env.EXPO_OS === 'web') {
  // The web build keeps its own navigation (tab bar, side menu) in App.tsx.
  // registerRootComponent calls AppRegistry.registerComponent('main', () => App);
  // It also ensures that whether you load the app in Expo Go or in a native build,
  // the environment is set up appropriately
  registerRootComponent(withMonitoring(App));
} else {
  // iOS and Android start in Expo Router (src/app/_layout.tsx), which gives the
  // five main tabs the system's native tab bar. It registers the root itself.
  require('expo-router/entry');
}
