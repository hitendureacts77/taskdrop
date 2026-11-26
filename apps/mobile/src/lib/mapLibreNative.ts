import { TurboModuleRegistry } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';

/**
 * MapLibre Native for the phone maps (plan 1.20, D33). Its native module is not
 * in Expo Go, and an older installed build may not have it either; in both
 * cases this is null and the screens use the tile map. Loaded with require()
 * so a missing module cannot crash the import. Only the .native map files
 * import this.
 */
export const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

export type MapLibre = typeof import('@maplibre/maplibre-react-native');

function load(): MapLibre | null {
  if (IN_EXPO_GO) return null;
  try {
    if (!TurboModuleRegistry.get('MLRNMapViewModule')) return null;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@maplibre/maplibre-react-native') as MapLibre;
  } catch {
    return null;
  }
}

export const ML = load();
