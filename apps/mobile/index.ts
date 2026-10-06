import { registerRootComponent } from 'expo';

import App from './App';
import { installGlobalErrorHandlers } from './src/lib/globalErrors';
import { installMonitoring } from './src/lib/monitoring';

// First, so even a failure while the app is starting up is caught and reported.
installMonitoring();
installGlobalErrorHandlers();

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
