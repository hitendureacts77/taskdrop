import { View } from 'react-native';
import { useLayout, TABLET_CONTENT } from '../lib/layout';

/**
 * Task 1.14 level 1, native apps only. On an Android screen 600 wide or more (tablet, opened foldable, split-screen)
 * the screen is held to 720 and centred, as the website's tablet layout does. Under 600, and for full-bleed screens
 * (`full`: the maps), the two boxes are plain full-size boxes, so every phone looks exactly as before.
 * The boxes are always there, so opening a foldable or turning a tablet never rebuilds the screen inside them
 * (a half-written task, an offer or the map's place survives).
 */
export function WideFrame({ full, children }: { full?: boolean; children: React.ReactNode }) {
  const { nativeWide } = useLayout();
  return (
    <View style={{ flex: 1, alignItems: 'center' }}>
      <View style={{ flex: 1, width: '100%', maxWidth: nativeWide && !full ? TABLET_CONTENT : undefined }}>{children}</View>
    </View>
  );
}
