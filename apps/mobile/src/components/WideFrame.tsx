import { View } from 'react-native';
import { useLayout, TABLET_CONTENT } from '../lib/layout';

/**
 * Task 1.14 level 1, native apps only. On an Android screen 600 wide or more (tablet, opened foldable, split-screen)
 * the screen is held to 720 and centred, as the website's tablet layout does. Under 600, and for full-bleed screens
 * (`full`: the maps), it renders its children untouched, so every phone looks exactly as before.
 */
export function WideFrame({ full, children }: { full?: boolean; children: React.ReactNode }) {
  const { nativeWide } = useLayout();
  if (!nativeWide || full) return <>{children}</>;
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={{ flex: 1, width: '100%', maxWidth: TABLET_CONTENT }}>{children}</View>
    </View>
  );
}
