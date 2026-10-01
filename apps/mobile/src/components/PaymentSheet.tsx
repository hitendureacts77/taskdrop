import { useState } from 'react';
import { Modal, View, Text as RNText, Pressable, ActivityIndicator, Linking } from 'react-native';
import { WebView, type WebViewNavigation } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../providers/ThemeProvider';
import { Icon } from './Icon';
import { tx } from './primitives';

/**
 * Razorpay checkout inside the app, native build.
 *
 * Opening the payment link with Linking handed people to Chrome, away from
 * TaskDrop, and back again by hand. Here it opens in a sheet over the screen
 * that is waiting for the money, so the moment the webhook lands that screen
 * can close this and carry on.
 *
 * UPI apps are the one thing a WebView cannot do itself: "Pay with GPay" is a
 * upi:// or intent:// link, which is handed to Android so the UPI app opens,
 * and the payer returns here when it is done.
 */
export function PaymentSheet({
  url,
  visible,
  onClose,
}: {
  url: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const [loading, setLoading] = useState(true);

  const external = (req: WebViewNavigation): boolean => {
    const u = req.url;
    if (/^https?:\/\//i.test(u) || u.startsWith('about:') || u.startsWith('data:') || u.startsWith('blob:')) return true;
    // upi://, intent://, tez://, phonepe://, paytmmp:// ... belong to other apps.
    let target = u;
    if (u.startsWith('intent://')) {
      // intent://pay?...#Intent;scheme=upi;package=...;end -> upi://pay?...
      const scheme = /;scheme=([^;]+);/.exec(u)?.[1];
      if (scheme) target = `${scheme}://${u.slice('intent://'.length).split('#Intent')[0]}`;
    }
    void Linking.openURL(target).catch(() => {
      /* no app for that link: the page offers the other methods */
    });
    return false;
  };

  return (
    <Modal visible={visible && Boolean(url)} animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: t.colors.bg, paddingTop: insets.top }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.line,
          }}
        >
          <View style={{ width: 34, height: 34, borderRadius: 10, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={16} color={t.colors.accentDeep} />
          </View>
          <View style={{ flex: 1 }}>
            <RNText style={tx('800', 15, t.colors.ink)}>Secure payment</RNText>
            <RNText style={tx('400', 11, t.colors.muted, { marginTop: 1 })}>UPI, cards, netbanking · by Razorpay</RNText>
          </View>
          <Pressable
            onPress={onClose}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel="Close payment"
            style={{ width: 36, height: 36, borderRadius: 999, backgroundColor: t.colors.surface2, alignItems: 'center', justifyContent: 'center' }}
          >
            <Icon name="close" size={18} color={t.colors.ink} />
          </Pressable>
        </View>
        {url ? (
          <WebView
            source={{ uri: url }}
            style={{ flex: 1 }}
            onLoadStart={() => setLoading(true)}
            onLoadEnd={() => setLoading(false)}
            onShouldStartLoadWithRequest={external}
            originWhitelist={['*']}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
          />
        ) : null}
        {loading ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 64, alignItems: 'center', paddingTop: 40 }}>
            <ActivityIndicator color={t.colors.accent} />
          </View>
        ) : null}
        <View style={{ paddingBottom: Math.max(insets.bottom, 10), paddingTop: 8, alignItems: 'center', borderTopWidth: 1, borderTopColor: t.colors.line }}>
          <RNText style={tx('500', 11, t.colors.muted)}>TaskDrop never sees your card or UPI PIN.</RNText>
        </View>
      </View>
    </Modal>
  );
}
