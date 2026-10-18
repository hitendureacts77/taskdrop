import { ActivityIndicator, View } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import { useTheme } from '../providers/ThemeProvider';

/**
 * Apple's own "Sign in with Apple" button. It has to be Apple's native view:
 * the App Store checks the wording, logo and shape. Android and web use the
 * AppleSignInButton.tsx stub, which draws nothing.
 */
export function AppleSignInButton({ onPress, busy }: { onPress: () => void; busy?: boolean }) {
  const t = useTheme();
  return (
    <View style={{ opacity: busy ? 0.6 : 1 }} pointerEvents={busy ? 'none' : 'auto'}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
        buttonStyle={
          t.isDark
            ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
        }
        cornerRadius={16}
        onPress={onPress}
        style={{ width: '100%', height: 48 }}
      />
      {busy ? (
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={t.isDark ? '#000' : '#fff'} />
        </View>
      ) : null}
    </View>
  );
}
