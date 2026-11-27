import { useCallback, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import { Screen } from '../components/ui';
import { Walkthrough } from '../components/Walkthrough';
import { WelcomeStory } from '../components/WelcomeStory';
import { PrimaryButton } from '../components/kit';
import { tx } from '../components/primitives';
import { PersonTheme, useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { useMode } from '../providers/ModeProvider';
import { FROM_GUEST } from '../lib/guest';
import { saveIntroSeen } from '../lib/intro';
import { introMode } from '../lib/introRoute';
import { walkSideFor, type WalkSide } from '../lib/walkthrough';

/**
 * "How TaskDrop works" (plan 1.19 row N): the one walkthrough, five real app
 * screens per side. A new install opens on it after the splash; Skip leads
 * into the app as a guest, and the last card's button goes straight to posting
 * (Hire) or finding work (Earn). A guest is also offered the account there.
 *
 * The same screen opens again from Profile, the account menu and the "How
 * TaskDrop works" pill on Home (`replay`), on the side the person is on. That
 * path plays the drawn story straight away (owner, 27 Nov: no "Show me the
 * app" question). The real-screen walkthrough only opens by itself once after
 * sign-in (WalkthroughHost passes `walk`) and on a first launch.
 */
export function IntroScreen() {
  const t = useTheme();
  const { reset, back, go, params } = useNav();
  const { session, continueAsGuest } = useAuth();
  const { mode: appMode, setMode } = useMode();
  const mode = introMode({ replay: Boolean(params.replay), signedIn: Boolean(session) });
  // A new install opens on Hire; a replay opens on the side the person is on.
  const startSide = walkSideFor(params.side, mode === 'first' ? 'poster' : appMode);
  const [side, setSide] = useState<WalkSide>(startSide);
  const walk = mode === 'first' || Boolean(params.walk);

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

  if (!walk) {
    return (
      <Screen scroll>
        <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', paddingTop: 20, paddingBottom: 60 }}>
          <PersonTheme role={side === 'hire' ? 'poster' : 'worker'}>
            <StoryPage side={side} onSide={setSide} mode={mode} onClose={skip} onAccount={makeAccount} />
          </PersonTheme>
        </View>
      </Screen>
    );
  }

  return (
    <Screen scroll>
      <View style={{ width: '100%', maxWidth: 460, alignSelf: 'center', paddingTop: 12, paddingBottom: 160 }}>
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

/** "How TaskDrop works" as the drawn story: plays at once, a Hire / Earn switch above, one button below. */
function StoryPage({
  side,
  onSide,
  mode,
  onClose,
  onAccount,
}: {
  side: WalkSide;
  onSide: (s: WalkSide) => void;
  mode: 'first' | 'guest-replay' | 'member-replay';
  onClose: () => void;
  onAccount: () => void;
}) {
  const t = useTheme();
  const guest = mode === 'guest-replay';
  return (
    <View>
      <RNText accessibilityRole="header" style={tx('800', 24, t.colors.ink, { textAlign: 'center', letterSpacing: -0.6 })}>How TaskDrop works</RNText>
      <View style={{ flexDirection: 'row', alignSelf: 'center', marginTop: 14, padding: 4, borderRadius: 999, backgroundColor: t.colors.surface2 }}>
        {(['hire', 'earn'] as const).map((k) => (
          <PersonTheme key={k} role={k === 'hire' ? 'poster' : 'worker'}>
            <SideTab on={side === k} label={k === 'hire' ? 'Hire' : 'Earn'} onPress={() => onSide(k)} />
          </PersonTheme>
        ))}
      </View>
      <WelcomeStory key={side} side={side} />
      <PrimaryButton label={guest ? 'Create my account' : 'Done'} onPress={guest ? onAccount : onClose} style={{ marginTop: 26 }} />
      {guest ? (
        <Pressable onPress={onClose} hitSlop={8} accessibilityRole="button" accessibilityLabel="Close" style={{ alignSelf: 'center', marginTop: 14, paddingVertical: 8, paddingHorizontal: 14 }}>
          <RNText style={tx('600', 13, t.colors.muted)}>Close</RNText>
        </Pressable>
      ) : null}
    </View>
  );
}

function SideTab({ on, label, onPress }: { on: boolean; label: string; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: on }}
      accessibilityLabel={`${label} side`}
      style={{ paddingVertical: 8, paddingHorizontal: 26, borderRadius: 999, backgroundColor: on ? t.colors.btn : 'transparent' }}
    >
      <RNText style={tx('800', 13.5, on ? t.colors.onBtn : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );
}
