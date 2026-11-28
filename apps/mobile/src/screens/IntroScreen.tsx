import { useCallback, useEffect } from 'react';
import { useLayout } from '../lib/layout';
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
import { walkSeenKey, walkSideFor, WALK_COPY, type WalkSide } from '../lib/walkthrough';

/**
 * "How TaskDrop works" (plan 1.19 row N): the one walkthrough, real app
 * screens per side. A new install opens on it after the splash; Skip leads
 * into the app as a guest, and the last card's button goes straight to posting
 * (Hire) or finding work (Earn). A guest is also offered the account there.
 *
 * The same screen opens again from Profile, the account menu and the "How
 * TaskDrop works" pill on Home (`replay`), on the side the person is on.
 */
export function IntroScreen() {
  const t = useTheme();
  const layout = useLayout();
  const wide = layout.desktop || layout.tablet;
  const { reset, back, go, params } = useNav();
  const { session, userId, guest, continueAsGuest } = useAuth();
  const { mode: appMode, setMode } = useMode();
  const mode = introMode({ replay: Boolean(params.replay), signedIn: Boolean(session) });
  // Opened from the link on the desktop sign-in page by someone with no session who has not chosen guest: closing or
  // finishing just returns to the sign-in page, and there is no "Create my account" (they are already on it).
  const fromSignIn = params.from === 'signin';
  // A new install opens on Hire; a replay opens on the side the person is on.
  const side = walkSideFor(params.side, mode === 'first' ? 'poster' : appMode);
  // Remembered for this person (an account, or the guest), and only once the walkthrough is really on screen: on a
  // phone the auto-open can be dropped while the native stack is not mounted yet, and it must then try again.
  const seenKey = walkSeenKey({ userId, guest: guest || mode === 'first' });
  useEffect(() => {
    void saveIntroSeen(seenKey);
  }, [seenKey]);

  const makeAccount = useCallback(() => {
    void saveIntroSeen(seenKey);
    if (mode === 'first') reset('welcome');
    else go('welcome', { [FROM_GUEST]: true });
  }, [mode, reset, go, seenKey]);

  const skip = useCallback(() => {
    void saveIntroSeen(seenKey);
    if (mode === 'first') {
      continueAsGuest();
      reset('home');
    } else {
      back();
    }
  }, [mode, continueAsGuest, reset, back, seenKey]);

  const finish = useCallback(
    (s: WalkSide) => {
      void saveIntroSeen(seenKey);
      if (fromSignIn) {
        back();
        return;
      }
      setMode(s === 'earn' ? 'worker' : 'poster');
      if (mode === 'first') {
        continueAsGuest();
        reset('home');
      } else {
        back();
      }
      go(s === 'earn' ? 'explore' : 'aiPost');
    },
    [mode, fromSignIn, setMode, continueAsGuest, reset, back, go, seenKey],
  );

  const account =
    mode === 'member-replay' || fromSignIn ? null : (
      <View style={{ alignItems: 'center', marginTop: 6 }}>
        <Pressable onPress={makeAccount} accessibilityRole="button" accessibilityLabel="Create my account" hitSlop={8} style={{ paddingVertical: 8, paddingHorizontal: 14 }}>
          <RNText style={tx('700', 14, t.colors.ink, { textDecorationLine: 'underline' })}>Create my account</RNText>
        </Pressable>
        <RNText style={tx('400', 12.5, t.colors.muted, { textAlign: 'center', lineHeight: 18 })}>Takes a minute: your number and a code.</RNText>
      </View>
    );

  const walk = (
    <Walkthrough
      side={side}
      onSkip={skip}
      onFinish={finish}
      skipLabel={fromSignIn ? WALK_COPY.backSignIn : mode === 'first' ? WALK_COPY.skip : WALK_COPY.backHome}
      extra={account}
    />
  );
  // Desktop and tablet: the page draws itself full width (no sign-in frame, no menu). Phone: story mode on a plain screen.
  if (wide) return walk;
  return <Screen padded={false}>{walk}</Screen>;
}
