import { useColorScheme, View } from 'react-native';
import { dark, light } from '../theme';

/**
 * The blank frame painted while fonts load and while the session is restored. It follows the system
 * light/dark setting, so a light-theme person no longer gets a dark flash on every start (S3-14).
 */
export function StartupFrame() {
  const scheme = useColorScheme();
  return <View style={{ flex: 1, backgroundColor: (scheme === 'dark' ? dark : light).bg }} />;
}
