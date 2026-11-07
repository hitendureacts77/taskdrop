import { useCallback } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { Screen } from '../components/ui';
import { PrimaryButton } from '../components/kit';
import { WelcomeStory } from '../components/WelcomeStory';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { FROM_GUEST } from '../lib/guest';
import { saveIntroSeen } from '../lib/intro';
import { introMode } from '../lib/introRoute';

/**
 * The first thing a new install shows after the splash: how TaskDrop works,
 * played as the five-part story, then a choice. Making an account is the large
 * button; "Skip for now" is a small link under it, and leads into the app as a
 * guest (they can make the account later from any pop-up or the sign-in tab).
 *
 * The same screen opens again from "How TaskDrop works" on Home (`replay`): a
 * guest is offered the account again, a signed-in person just closes it.
 */
export function IntroScreen() {
  const t = useTheme();
  const { reset, back, go, params } = useNav();
  const { session, continueAsGuest } = useAuth();
  const mode = introMode({ replay: Boolean(params.replay), signedIn: Boolean(session) });

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

  return (
    <Screen scroll>
      <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', paddingTop: 28 }}>
        <RNText style={tx('800', 30, t.colors.ink, { textAlign: 'center', letterSpacing: -1 })}>
          taskdrop<RNText style={{ color: t.colors.accent }}>.</RNText>
        </RNText>
        <RNText style={tx('400', 15, t.colors.muted, { textAlign: 'center', marginTop: 6, lineHeight: 22 })}>
          Ask for anything. Someone gets it done for you.
        </RNText>

        <WelcomeStory />

        {mode === 'member-replay' ? (
          <PrimaryButton label="Done" onPress={skip} style={{ marginTop: 26 }} />
        ) : (
          <>
            <PrimaryButton label="Create my account" onPress={makeAccount} style={{ marginTop: 26, minHeight: 60 }} />
            <RNText style={tx('400', 12.5, t.colors.muted, { textAlign: 'center', marginTop: 10, lineHeight: 18 })}>
              Takes a minute: your number and a code.
            </RNText>
            <Pressable
              onPress={skip}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={mode === 'first' ? 'Skip sign-up for now' : 'Back to the app'}
              style={{ alignSelf: 'center', marginTop: 18, paddingVertical: 8, paddingHorizontal: 14 }}
            >
              <RNText style={tx('600', 12.5, t.colors.muted)}>{mode === 'first' ? 'Skip for now' : 'Back to the app'}</RNText>
            </Pressable>
          </>
        )}
      </View>
    </Screen>
  );
}
