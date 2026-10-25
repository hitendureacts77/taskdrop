import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text as RNText, View } from 'react-native';
import { Image } from 'expo-image';
import { Icon } from './Icon';
import { tx } from './primitives';
import { imageSource, signedMediaUrl } from '../lib/media';

/**
 * A private picture shown full screen on a dark backdrop. It signs the `full`
 * size only when it opens, so a thread of small pictures never pays for it.
 * Tap anywhere, press the cross or use Back to close.
 */
export function PhotoViewer({ path, visible, onClose }: { path: string; visible: boolean; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let alive = true;
    setFailed(false);
    void signedMediaUrl(path, 'full').then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [path, visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <Pressable
        onPress={onClose}
        accessibilityRole="button"
        accessibilityLabel="Close photo"
        style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.94)', alignItems: 'center', justifyContent: 'center' }}
      >
        {url ? (
          <Image source={imageSource(url)} style={{ width: '100%', height: '100%' }} contentFit="contain" accessibilityLabel="Photo" />
        ) : failed ? (
          <RNText style={tx('600', 15, '#FFFFFF')}>Couldn&apos;t open this photo. Please try again.</RNText>
        ) : (
          <ActivityIndicator color="#FFFFFF" />
        )}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', top: 48, right: 20, width: 40, height: 40, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.18)', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="close" size={20} color="#FFFFFF" />
        </View>
      </Pressable>
    </Modal>
  );
}
