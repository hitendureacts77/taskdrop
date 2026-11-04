import { Modal, Pressable, Text as RNText, View } from 'react-native';
import { PrimaryButton } from './kit';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useReducedMotion } from '../lib/motion';
import { ACCOUNT_COPY, FROM_GUEST, closeAccountPrompt, useAccountPrompt } from '../lib/guest';

/**
 * The one "Make your account" pop-up (design D15). A guest sees it only at the last step
 * (post, offer, pay, chat...). "Create account" and "Sign in" open the sign-in page and keep
 * the action the guest was finishing; "Not now" drops it.
 */
export function AccountPrompt() {
  const t = useTheme();
  const { go } = useNav();
  const reduced = useReducedMotion();
  const { open, reason } = useAccountPrompt();
  const copy = ACCOUNT_COPY[reason];

  const toSignIn = () => {
    closeAccountPrompt(true);
    go('welcome', { [FROM_GUEST]: true });
  };
  const notNow = () => closeAccountPrompt();

  return (
    <Modal
      visible={open}
      transparent
      animationType={reduced ? 'none' : 'fade'}
      onRequestClose={notNow}
      statusBarTranslucent
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Pressable
          onPress={notNow}
          accessibilityRole="button"
          accessibilityLabel="Not now"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.5)' }}
        />
        <View
          accessibilityViewIsModal
          style={{
            width: '100%',
            maxWidth: 400,
            backgroundColor: t.colors.surface,
            borderRadius: 24,
            borderWidth: 1,
            borderColor: t.colors.line,
            padding: 22,
            shadowColor: '#000',
            shadowOpacity: 0.28,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: 12 },
            elevation: 10,
          }}
        >
          <RNText accessibilityRole="header" style={tx('800', 22, t.colors.ink, { letterSpacing: -0.6, lineHeight: 28 })}>
            {copy.title}
          </RNText>
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>{copy.body}</RNText>
          <PrimaryButton label="Create account" onPress={toSignIn} style={{ marginTop: 22 }} />
          <PrimaryButton label="Sign in" tone="quiet" onPress={toSignIn} style={{ marginTop: 10 }} />
          <Pressable onPress={notNow} accessibilityRole="button" accessibilityLabel="Not now" style={{ alignItems: 'center', paddingVertical: 14, marginTop: 2 }}>
            <RNText style={tx('700', 14, t.colors.muted)}>Not now</RNText>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}
