import { useEffect, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { parseBirthDate } from '@taskdrop/rules';
import { Screen } from './ui';
import { Icon } from './Icon';
import { PrimaryButton } from './kit';
import { tx } from './primitives';
import { BirthDateField, EMPTY_BIRTH_DATE, type BirthDateParts } from './BirthDateField';
import { DesktopAuthFrame } from './DesktopAuthFrame';
import { useTheme } from '../providers/ThemeProvider';
import { useNav, type ScreenName } from '../providers/NavProvider';
import { useAuth } from '../providers/AuthProvider';
import { useActions } from '../providers/AppStateProvider';
import { useLayout } from '../lib/layout';
import { ageStatus, onAgeStatus, recordBirthDate, type AgeStatus } from '../data/age';

// The way in, and pages anyone may read. AccessScreen asks new phone sign-ups
// itself, before an account exists, so the gate stays out of its way.
const OPEN: ScreenName[] = ['splash', 'welcome', 'signup', 'copyright', 'terms', 'privacy'];

/**
 * Nobody signed in reaches the app until their account has answered the age
 * check (migration 082). Google sign-ups and accounts made before the check
 * existed meet it here, once; phone sign-ups have already answered on
 * AccessScreen. If the server cannot be asked, the app opens and the check is
 * tried again on the next screen -- the server still refuses to finish setup
 * without it.
 */
export function AgeGate({ children }: { children: React.ReactNode }) {
  const { userId, signOut } = useAuth();
  const { screen, reset } = useNav();
  const { desktop } = useLayout();
  const [status, setStatus] = useState<AgeStatus | 'loading' | 'unreachable'>('loading');
  const [turnedAway, setTurnedAway] = useState(false);

  useEffect(() => {
    if (!userId) return;
    return onAgeStatus((id, s) => {
      if (id === userId) setStatus(s);
    });
  }, [userId]);

  const retry = status === 'unreachable' ? screen : null;
  useEffect(() => {
    if (!userId) return;
    let live = true;
    if (status !== 'unreachable') setStatus('loading');
    // A pass is final. A slow answer that left before AccessScreen recorded the
    // birth date must not undo the pass it announced meanwhile.
    ageStatus(userId)
      .then((s) => live && setStatus((prev) => (prev === 'ok' ? 'ok' : s)))
      .catch(() => live && setStatus((prev) => (prev === 'ok' ? 'ok' : 'unreachable')));
    return () => {
      live = false;
    };
    // `retry` re-asks on each new screen only while the server was unreachable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, retry]);

  const frame = (node: React.ReactNode) => (desktop ? <DesktopAuthFrame>{node}</DesktopAuthFrame> : node);

  if (turnedAway) {
    return frame(
      <TurnedAway
        onDone={() => {
          setTurnedAway(false);
          reset('welcome');
        }}
      />,
    );
  }
  if (!userId || OPEN.includes(screen) || status === 'ok' || status === 'unreachable') return <>{children}</>;
  if (status === 'loading') return <Screen padded={false}>{null}</Screen>;

  return frame(
    <AgeCheck
      onPassed={() => setStatus('ok')}
      onTurnedAway={async () => {
        setTurnedAway(true);
        await signOut().catch(() => {});
      }}
      onSignOut={() => void signOut()}
    />,
  );
}

/** "When were you born?" for an account that exists but has not answered. */
function AgeCheck({
  onPassed,
  onTurnedAway,
  onSignOut,
}: {
  onPassed: () => void;
  onTurnedAway: () => Promise<void>;
  onSignOut: () => void;
}) {
  const t = useTheme();
  const { flash } = useActions();
  const [dob, setDob] = useState<BirthDateParts>(EMPTY_BIRTH_DATE);
  const [busy, setBusy] = useState(false);
  const birth = parseBirthDate(dob.day, dob.month, dob.year);

  const submit = async () => {
    if (!birth) return flash('Enter a real date of birth');
    setBusy(true);
    try {
      if ((await recordBirthDate(birth)) === 'ok') onPassed();
      else await onTurnedAway();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not save that');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen padded={false}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 22, paddingTop: 48 }} keyboardShouldPersistTaps="handled">
        <View
          style={{ width: 52, height: 52, borderRadius: 16, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="shield" size={24} color={t.colors.accentDeep} />
        </View>
        <RNText style={tx('800', 28, t.colors.ink, { letterSpacing: -1, marginTop: 18 })}>When were you born?</RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 10, lineHeight: 21 })}>
          We ask everyone on TaskDrop, once. It stays private and is never shown on your profile.
        </RNText>
        <View style={{ marginTop: 26 }}>
          <BirthDateField value={dob} onChange={setDob} onSubmit={() => void submit()} autoFocus />
        </View>
        <PrimaryButton
          label="Continue"
          onPress={() => void submit()}
          busy={busy}
          disabled={!birth}
          style={{ marginTop: 26, borderRadius: 999 }}
        />
        <View style={{ flex: 1 }} />
        <Pressable onPress={onSignOut} style={{ alignSelf: 'center', paddingVertical: 14 }} accessibilityRole="button">
          <RNText style={tx('700', 13, t.colors.muted)}>Sign out</RNText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

/**
 * Shown to someone the age check turned away. It does not say why or what the
 * threshold is: a neutral refusal is what stops the next attempt being a lie.
 */
export function TurnedAway({ onDone }: { onDone: () => void }) {
  const t = useTheme();
  return (
    <Screen padded={false}>
      <View style={{ flex: 1, padding: 22, justifyContent: 'center' }}>
        <RNText style={tx('800', 28, t.colors.ink, { letterSpacing: -1, lineHeight: 33 })}>
          Sorry, we can’t make{'\n'}an account for you.
        </RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 12, lineHeight: 21 })}>
          TaskDrop isn’t available to you right now.
        </RNText>
        <PrimaryButton label="OK" onPress={onDone} tone="quiet" style={{ marginTop: 28, borderRadius: 999 }} />
      </View>
    </Screen>
  );
}
