import { useCallback } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { Screen } from '../components/ui';
import { Walkthrough } from '../components/Walkthrough';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import { FROM_GUEST } from '../lib/guest';
import { saveIntroSeen } from '../lib/intro';
import { introMode } from '../lib/introRoute';
import { walkSideFor, type WalkSide } from '../lib/walkthrough';
import { useLayout } from '../lib/layout';

/**
 * "How TaskDrop works" (plan 1.19 row N): the one walkthrough, five real app
 * screens per side. A new install opens on it after the splash; Skip leads
 * into the app as a guest, and the last card's button goes straight to posting
 * (Hire) or finding work (Earn). A guest is also offered the account there.
 *
 * The same screen opens again from Profile, the account menu and the "How
 * TaskDrop works" pill on Home (`replay`), on the side the person is on.
 */
export function IntroScreen() {
  const t = useTheme();
  const { reset, back, go, params } = useNav();
  const { session, continueAsGuest } = useAuth();
  const { mode: appMode, setMode } = useMode();
  const { desktop } = useLayout();
  const mode = introMode({ replay: Boolean(params.replay), signedIn: Boolean(session) });
  // A new install opens on Hire; a replay opens on the side the person is on.
  const side = walkSideFor(params.side, mode === 'first' ? 'poster' : appMode);

  const makeAccount = useCallback(() => {
    void saveIntroSeen();
    if (mode === 'first') reset('welcome');
    else go('welcome', { [FROM_GUEST]: true });
  }, [mode, reset, go]);

  const skip = useCallback(() => {
    void saveIntroSeen();
    if (mode === 'first') {
      continueAsGuest();
      reset('home');
    } else {
      back();
    }
  }, [mode, continueAsGuest, reset, back]);

  const finish = useCallback(
    (s: WalkSide) => {
      void saveIntroSeen();
      setMode(s === 'earn' ? 'worker' : 'poster');
      if (mode === 'first') {
        continueAsGuest();
        reset('home');
      } else {
        back();
      }
      go(s === 'earn' ? 'explore' : 'aiPost');
    },
    [mode, setMode, continueAsGuest, reset, back, go],
  );

  const account =
    mode === 'member-replay' ? null : (
      <View style={{ alignItems: 'center', marginTop: 6 }}>
        <Pressable onPress={makeAccount} accessibilityRole="button" accessibilityLabel="Create my account" hitSlop={8} style={{ paddingVertical: 8, paddingHorizontal: 14 }}>
          <RNText style={tx('700', 14, t.colors.ink, { textDecorationLine: 'underline' })}>Create my account</RNText>
        </Pressable>
        <RNText style={tx('400', 12.5, t.colors.muted, { textAlign: 'center', lineHeight: 18 })}>Takes a minute: your number and a code.</RNText>
      </View>
    );

  return (
    <Screen scroll>
      <View style={{ width: '100%', maxWidth: desktop ? 1000 : 460, alignSelf: 'center', paddingTop: 12, paddingBottom: desktop ? 40 : 160 }}>
        <Walkthrough
          side={side}
          onSkip={skip}
          onFinish={finish}
          skipLabel={mode === 'first' ? 'Skip' : 'Close'}
          extra={account}
        />
      </View>
    </Screen>
  );
}
