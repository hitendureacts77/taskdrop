import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  TextInput,
  ActivityIndicator,
  Animated,
  Platform,
  type TextInputInstance,
} from 'react-native';
import { Drop, Ripples } from '../components/Ripples';
import { HeroBackground } from '../components/Hero';
import { FloatCard } from '../components/BrandArt';
import { useLayout } from '../lib/layout';
import { isReadyMobile, normalizeMobileInput, spacedMobile } from '../lib/phone';
import { listenForSmsCode } from '../lib/webOtp';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { BottomSheet, Field, PrimaryButton } from '../components/kit';
import { HitArea, tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useAppConfig } from '../components/AppGate';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { AuthError, useAuth } from '../providers/AuthProvider';
import { AppleSignInButton } from '../components/AppleSignInButton';
import { postSignInRoute } from '../data/api';
import { supabase } from '../lib/supabase';
import { signInWithUsername } from '../data/extras';
import { MIN_SIGNUP_AGE, ageOn, parseBirthDate } from '@taskdrop/rules';
import { BirthDateField, EMPTY_BIRTH_DATE, type BirthDateParts } from '../components/BirthDateField';
import { TurnedAway } from '../components/AgeGate';
import { recordBirthDate } from '../data/age';
import { KeyboardScrollView, RevealWhen } from '../components/KeyboardScrollView';
import { FROM_GUEST, clearGuestHandoff, declineAccount, markGuestHandoff, releaseAccountHold, runPendingAfterSignIn } from '../lib/guest';

/**
 * The way in: one screen for new and returning people alike.
 *
 * There is no "Create account" / "Sign in" fork. The number is the key: the
 * server already knows whether it has an account for it (phone-auth checks
 * before any code is made), so this screen asks as a returning member first
 * and, if the server says there is no such account, quietly asks again as a
 * new one. The person only ever sees "text me a code".
 *
 * A new person is asked when they were born before any code is texted, so
 * nobody under MIN_SIGNUP_AGE gets an account -- or a text -- at all. The
 * answer is recorded against the account once it exists (migration 082).
 *
 * Google and @username + password stay available as the two quieter ways in.
 * Hiring or earning is chosen later, in setup -- not here.
 */

type Stage = 'number' | 'birth' | 'code';
type Door = 'signin' | 'signup';

const spaced = spacedMobile;

export function AccessScreen() {
  const t = useTheme();
  const { desktop } = useLayout();
  const { go, reset, back, replace, params } = useNav();
  const { celebrate, flash } = useActions();
  const { requestCode, verifyCode, signInWithGoogle, signInWithApple, signOut, continueAsGuest } = useAuth();
  // Opened from the "Make your account" pop-up: Not now goes back, and signing in resumes what the guest was doing.
  const fromGuest = Boolean(params[FROM_GUEST]);
  // Leaving this page any other way (the phone's Back) gives the guest's open sheet back, unless setup comes next.
  const toSetup = useRef(false);
  useEffect(() => (fromGuest ? () => { if (!toSetup.current) releaseAccountHold(); } : undefined), [fromGuest]);
  // While this page (opened from the pop-up) shows, a sign-in is the guest's own: their drafts and saves may move
  // into the account. Opened any other way, or once it has gone, they do not (B31, lib/guestHandoff.ts).
  useEffect(() => {
    if (!fromGuest) return;
    markGuestHandoff();
    return () => clearGuestHandoff();
  }, [fromGuest]);
  // Sign-in methods the admin panel has switched off are not offered (the server refuses them too, except Google).
  const { features } = useAppConfig();

  const [stage, setStage] = useState<Stage>('number');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  // Only set while the server is in test mode and returns the code; empty when it goes by SMS.
  const [devCode, setDevCode] = useState('');
  const [dob, setDob] = useState<BirthDateParts>(EMPTY_BIRTH_DATE);
  const [birth, setBirth] = useState<Date | null>(null);
  const [turnedAway, setTurnedAway] = useState(false);
  // Which door the server let us through. Decided when the code is sent and
  // reused to verify it, because only 'signup' may create an account.
  const [door, setDoor] = useState<Door>('signin');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [appleBusy, setAppleBusy] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPasswordText] = useState('');
  // What is missing when Sign in was tapped with an empty box; cleared once they type.
  const [pwMissing, setPwMissing] = useState<string | null>(null);
  const [pwBusy, setPwBusy] = useState(false);

  // The server refuses a second code within 60 seconds; count it down here
  // rather than letting a tap meet that refusal.
  const [resendAt, setResendAt] = useState(0);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (resendAt <= Date.now()) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [resendAt]);
  const waitSec = Math.max(0, Math.ceil((resendAt - now) / 1000));

  const phoneRef = useRef<TextInputInstance>(null);
  const codeRef = useRef<TextInputInstance>(null);

  // The line under the number fills as it is typed: ten digits, ten steps.
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: phone.length / 10, duration: 160, useNativeDriver: false }).start();
  }, [phone.length, fill]);

  const numberReady = isReadyMobile(phone);
  const complete = otp.length === 6;
  // Once the code is asked for, the picture shrinks so the code boxes and the Test mode code sit above the
  // phone's keyboard without scrolling (P1-1).
  const compactHero = stage !== 'number';

  // Where to go once a session exists. Returning people go straight in; a
  // first sign-in goes through setup.
  const proceed = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const route = await postSignInRoute(user.id);
    if (fromGuest) {
      if (route === 'home') {
        back();
        runPendingAfterSignIn();
      } else if (route === 'username') {
        // An existing account with no username (plan 1.18): it picks one, then what the guest was doing finishes.
        toSetup.current = true;
        replace('pickUsername');
      } else {
        toSetup.current = true;
        go('setup', { quick: true });
      }
      return;
    }
    // No username (plan 1.18): Home underneath, and the gate opens over it (components/UsernameGate).
    if (route === 'home' || route === 'username') reset('home');
    else go('setup');
  };

  // A code is on its way: show where to type it.
  const codeSent = (used: Door, result: { devCode?: string }) => {
    setDoor(used);
    setStage('code');
    setOtp('');
    accepted.current = false;
    setResendAt(Date.now() + 60_000);
    setNow(Date.now());
    // A test project hands the code back. It is shown in a box to be typed, not filled in.
    setDevCode(result.devCode ?? '');
    flash(result.devCode ? 'Test code shown below' : `Code sent to +91 ${spaced(phone)}`);
    setTimeout(() => codeRef.current?.focus(), 250);
  };

  /**
   * Ask as a returning member first. "No account" means a new person: ask
   * when they were born, then ask again as one. The reverse ("already
   * exists") can only happen if the number was registered a moment ago, and
   * is handled the same way.
   */
  const sendCode = async () => {
    if (!numberReady) return flash('Enter a 10-digit mobile number');
    setBusy(true);
    try {
      let used: Door = stage === 'code' ? door : 'signin';
      let result: { devCode?: string };
      try {
        result = await requestCode(phone, used);
      } catch (e) {
        if (!(e instanceof AuthError) || !(e.noAccount || e.accountExists)) throw e;
        used = e.noAccount ? 'signup' : 'signin';
        if (used === 'signup' && !birth) {
          setStage('birth');
          return;
        }
        result = await requestCode(phone, used);
      }
      codeSent(used, result);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send a code');
    } finally {
      setBusy(false);
    }
  };

  /**
   * The birth date, checked here before any code is sent. The server checks
   * it again once the account exists, and has the final say.
   */
  const confirmBirth = async () => {
    const date = parseBirthDate(dob.day, dob.month, dob.year);
    if (!date) return flash('Enter a real date of birth');
    if (ageOn(date) < MIN_SIGNUP_AGE) {
      setTurnedAway(true);
      return;
    }
    setBirth(date);
    setBusy(true);
    try {
      codeSent('signup', await requestCode(phone, 'signup'));
    } catch (e) {
      if (e instanceof AuthError && e.accountExists) setStage('number');
      flash(e instanceof Error ? e.message : 'Could not send a code');
    } finally {
      setBusy(false);
    }
  };

  // Six digits can only mean one thing, so submit rather than waiting for a
  // tap. The guard is a ref, not state: a code is single-use, so two in-flight
  // verifies mean the second one always fails.
  const verifying = useRef(false);
  // Set once a code has been accepted. The code stays typed in the box while the app moves on, so
  // without this the effect below fired a second verify when `busy` flipped back, and the server
  // answered "Request a code first" on top of Home (P1-7). Cleared when a new code is sent.
  const accepted = useRef(false);
  // Website: Chrome on Android can fill the code from the SMS with one tap (WebOTP); the effect below then
  // verifies it. Stops when the code step closes. Does nothing in the apps.
  useEffect(() => {
    if (stage !== 'code') return;
    return listenForSmsCode((code) => setOtp(code));
  }, [stage]);

  useEffect(() => {
    if (!complete || busy || verifying.current || accepted.current || stage !== 'code') return;
    verifying.current = true;
    void verify().finally(() => {
      verifying.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, busy, stage]);

  const verify = async () => {
    if (!complete) return flash('Enter all six digits');
    setBusy(true);
    try {
      await verifyCode(phone, otp, door);
      // The code is spent: nothing may submit it again, and the test-code box has done its job.
      accepted.current = true;
      setDevCode('');
      // The new account answers the question it was asked before the code. If
      // this cannot reach the server, AgeGate asks again after sign-in.
      if (door === 'signup' && birth) {
        if ((await recordBirthDate(birth).catch(() => null)) === 'blocked') {
          // Signed out on OK: signing out now would reset to the splash and hide the message.
          setTurnedAway(true);
          return;
        }
      }
      celebrate(door === 'signin' ? 'Welcome back' : 'Number verified');
      await proceed();
    } catch (e) {
      if (e instanceof AuthError && (e.accountExists || e.noAccount)) {
        // The number changed hands between sending and verifying. Start over
        // cleanly rather than guessing.
        flash('Please ask for a new code');
        setStage('number');
        setResendAt(0);
      } else {
        flash(e instanceof Error ? e.message : 'That code is not right');
        codeRef.current?.focus();
      }
      // Clear it, or the auto-submit cannot fire again for a retry.
      setOtp('');
    } finally {
      setBusy(false);
    }
  };

  // On the web this never returns -- the page goes to Google and back, and
  // AuthProvider routes on that fresh load. Native stays here and routes itself.
  const googleSignIn = async () => {
    setGoogleBusy(true);
    try {
      await signInWithGoogle('signin');
      await proceed();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not sign in with Google';
      // Closing Google's page is a choice, not an error (same as Apple's sheet).
      if (msg !== 'Sign-in was cancelled') flash(msg);
    } finally {
      setGoogleBusy(false);
    }
  };

  const appleSignIn = async () => {
    setAppleBusy(true);
    try {
      await signInWithApple();
      await proceed();
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Could not sign in with Apple';
      // Closing Apple's sheet is a choice, not an error.
      if (msg !== 'Sign-in was cancelled') flash(msg);
    } finally {
      setAppleBusy(false);
    }
  };

  const passwordSignIn = async () => {
    const missing = !username.trim() && !password ? 'Enter your username and password.' : !username.trim() ? 'Enter your username.' : !password ? 'Enter your password.' : null;
    setPwMissing(missing);
    if (missing) return flash(missing);
    setPwBusy(true);
    try {
      await signInWithUsername(username, password);
      setPwOpen(false);
      celebrate('Welcome back');
      await proceed();
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setPwBusy(false);
    }
  };

  const editNumber = () => {
    setStage('number');
    setOtp('');
    setTimeout(() => phoneRef.current?.focus(), 200);
  };

  const heading =
    stage === 'number'
      ? { title: 'Get help, near or far.\nOr earn.', sub: 'All it takes is your mobile number. New or returning — we’ll know.' }
      : stage === 'birth'
      ? {
          title: 'Nice to meet\nyou.',
          sub: 'Before we text you a code: when were you born? We ask everyone who joins, and it’s never shown on your profile.',
        }
      : {
          title: door === 'signin' ? 'Good to see\nyou again.' : 'Nice to meet\nyou.',
          sub:
            door === 'signin'
              ? 'Enter the code we just texted to sign in.'
              : 'Enter the code we just texted. Your account is made the moment it matches.',
        };

  // Said where the account is made (the code button, and Google beside it), so
  // agreeing is a clear act rather than a link in a footer.
  const consent = (
    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 12, lineHeight: 18, textAlign: 'center' })}>
      By continuing you agree to TaskDrop’s{' '}
      <RNText onPress={() => go('terms')} accessibilityRole="link" style={tx('700', 12, t.colors.accentDeep)}>
        Terms
      </RNText>{' '}
      and confirm you have read the{' '}
      <RNText onPress={() => go('privacy')} accessibilityRole="link" style={tx('700', 12, t.colors.accentDeep)}>
        Privacy Policy
      </RNText>
      .
    </RNText>
  );

  if (turnedAway) {
    return (
      <TurnedAway
        onDone={async () => {
          await signOut().catch(() => {});
          setTurnedAway(false);
          setStage('number');
          setPhone('');
          setDob(EMPTY_BIRTH_DATE);
        }}
      />
    );
  }

  return (
    <Screen padded={false} style={desktop ? { backgroundColor: t.colors.surface } : undefined}>
      <KeyboardScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 22 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The picture: the droplet with its ripples on the brand gradient,
            and what goes out when a task drops -- one nearby, one remote.
            On desktop the brand panel beside the form carries it instead. */}
        {desktop ? null : (
          <View
            style={{
              height: compactHero ? 150 : 290,
              borderBottomLeftRadius: 36,
              borderBottomRightRadius: 36,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}
          >
            <HeroBackground radius={0} />
            <Ripples color="rgba(255,255,255,0.75)" size={420} count={4} duration={4000} />
            <View
              style={{
                width: compactHero ? 80 : 108,
                height: compactHero ? 80 : 108,
                borderRadius: 108,
                backgroundColor: '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 22,
                shadowOffset: { width: 0, height: 10 },
                elevation: 8,
              }}
            >
              <Drop size={compactHero ? 40 : 56} fill={t.colors.heroMid} tick="#FFFFFF" />
            </View>
            {compactHero ? null : <FloatCard icon="globe" tone="ai" title="Logo design · Remote" sub="from ₹1,500" style={{ top: 66, right: 16 }} />}
            {compactHero ? null : <FloatCard icon="pin" title="Plumber · 1.2 km" sub="3 offers in 9 min" delay={900} style={{ top: 198, left: 16 }} />}
            <RNText style={tx('800', 22, '#FFFFFF', { letterSpacing: -0.8, position: 'absolute', top: 24, left: 22 })}>
              taskdrop<RNText style={{ color: '#7FE3C4' }}>.</RNText>
            </RNText>
          </View>
        )}

        <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: desktop ? 30 : 28 }}>
          {fromGuest ? (
            <Pressable
              onPress={() => {
                declineAccount();
                back();
              }}
              hitSlop={11}
              accessibilityRole="button"
              accessibilityLabel="Not now"
              style={{ alignSelf: 'flex-start', marginBottom: 14 }}
            >
              <HitArea x={8} y={11} />
              <RNText style={tx('700', 14, t.colors.muted)}>Not now</RNText>
            </Pressable>
          ) : null}
          <RNText style={tx('800', 32, t.colors.ink, { letterSpacing: -1.2, lineHeight: 36 })}>{heading.title}</RNText>
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 10, lineHeight: 21 })}>{heading.sub}</RNText>

          {stage === 'number' ? (
            <>
              {/* The number, big, on a line that fills as it is typed. On a phone the box sits low
                  (under the tall picture), so it scrolls itself above the keyboard when it gets focus. */}
              <RevealWhen when={phoneFocused}>
              <Pressable onPress={() => phoneRef.current?.focus()} style={{ marginTop: 28 }}>
                <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.4 })}>YOUR MOBILE NUMBER</RNText>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 }}>
                  <View
                    style={{
                      backgroundColor: t.colors.accentSoft,
                      borderRadius: 999,
                      paddingHorizontal: 11,
                      paddingVertical: 6,
                    }}
                  >
                    <RNText style={tx('700', 15, t.colors.accentDeep)}>+91</RNText>
                  </View>
                  <TextInput
                    ref={phoneRef}
                    // Phones get the plain digits: re-writing the box's text with a space in it while keys
                    // arrive quickly made Android drop or reorder digits (P1-2). The web box can take the space.
                    value={Platform.OS === 'web' ? spaced(phone) : phone}
                    onChangeText={(v) => setPhone(normalizeMobileInput(v))}
                    onFocus={() => setPhoneFocused(true)}
                    onBlur={() => setPhoneFocused(false)}
                    onSubmitEditing={() => void sendCode()}
                    returnKeyType="send"
                    placeholder="98765 43210"
                    placeholderTextColor={t.colors.muted}
                    keyboardType="number-pad"
                    inputMode="numeric"
                    autoComplete="tel-national"
                    textContentType="telephoneNumber"
                    accessibilityLabel="Mobile number"
                    style={tx('700', 28, t.colors.ink, { flex: 1, minWidth: 0, padding: 0, letterSpacing: 1.2 })}
                  />
                  {numberReady ? <Icon name="check" size={20} color={t.colors.accent} strokeWidth={2.6} /> : null}
                </View>
                <View style={{ height: 3, borderRadius: 3, backgroundColor: t.colors.line, marginTop: 12, overflow: 'hidden' }}>
                  <Animated.View
                    style={{
                      height: 3,
                      backgroundColor: phoneFocused || numberReady ? t.colors.accent : t.colors.muted,
                      width: fill.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }),
                    }}
                  />
                </View>
              </Pressable>
              </RevealWhen>

              <PrimaryButton
                label={busy ? 'Sending…' : 'Text me a code'}
                onPress={() => void sendCode()}
                busy={busy}
                disabled={!numberReady}
                style={{ marginTop: 26, borderRadius: 999 }}
              />
              {consent}

              {/* The other two ways in, side by side and quieter. */}
              {features.signInGoogle || features.signInPassword || (features.signInApple && Platform.OS === 'ios') ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
                <RNText style={tx('500', 12, t.colors.muted)}>or use</RNText>
                <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
              </View>
              ) : null}
              {features.signInApple && Platform.OS === 'ios' ? (
                <View style={{ marginTop: 14 }}>
                  <AppleSignInButton onPress={() => void appleSignIn()} busy={appleBusy} />
                </View>
              ) : null}
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
                {features.signInGoogle ? (
                <Pressable
                  onPress={() => void googleSignIn()}
                  disabled={googleBusy}
                  accessibilityRole="button"
                  accessibilityLabel="Continue with Google"
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    paddingVertical: 13,
                    borderRadius: 16,
                    backgroundColor: t.colors.surface,
                    borderWidth: 1,
                    borderColor: t.colors.line,
                    opacity: googleBusy ? 0.6 : 1,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  {googleBusy ? (
                    <ActivityIndicator color={t.colors.ink} />
                  ) : (
                    <>
                      <RNText style={tx('800', 16, '#4285F4')}>G</RNText>
                      <RNText style={tx('700', 14, t.colors.ink)}>Google</RNText>
                    </>
                  )}
                </Pressable>
                ) : null}
                {features.signInPassword ? (
                <Pressable
                  onPress={() => setPwOpen(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Sign in with username and password"
                  style={({ pressed }) => ({
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    paddingVertical: 13,
                    borderRadius: 16,
                    backgroundColor: t.colors.surface,
                    borderWidth: 1,
                    borderColor: t.colors.line,
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <RNText style={tx('800', 16, t.colors.accentDeep)}>@</RNText>
                  <RNText style={tx('700', 14, t.colors.ink)}>Username</RNText>
                </Pressable>
                ) : null}
              </View>

              {/* Look around first: the account is made at the last step (design D15). */}
              {fromGuest ? null : (
                <>
                  <Pressable
                    onPress={() => {
                      void continueAsGuest();
                      reset('home');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel="Continue as guest"
                    style={({ pressed }) => ({
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginTop: 14,
                      paddingVertical: 13,
                      borderRadius: 16,
                      backgroundColor: t.colors.surface,
                      borderWidth: 1,
                      borderColor: t.colors.line,
                      transform: [{ scale: pressed ? 0.97 : 1 }],
                    })}
                  >
                    <RNText style={tx('700', 14, t.colors.ink)}>Continue as guest</RNText>
                  </Pressable>
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 8, lineHeight: 18, textAlign: 'center' })}>
                    Look around first. Make your account when you post, offer or pay.
                  </RNText>
                </>
              )}
            </>
          ) : stage === 'birth' ? (
            <>
              {/* W3-9: a new account is about to be made for this number, so it is named big and clear,
                  with a way back to fix it if it is not the number they meant. */}
              <View style={{ marginTop: 22 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <View style={{ backgroundColor: t.colors.goldSoft, borderRadius: 999, paddingHorizontal: 11, paddingVertical: 5 }}>
                    <RNText style={tx('700', 12, t.colors.goldInk)}>New account</RNText>
                  </View>
                  <Pressable onPress={editNumber} hitSlop={8} accessibilityRole="button" accessibilityLabel="Change the number">
                    <RNText style={tx('700', 13, t.colors.accentDeep)}>Wrong number? Change</RNText>
                  </Pressable>
                </View>
                <RNText
                  testID="new-account-number"
                  accessibilityLabel={`New account for number plus 91 ${phone.split('').join(' ')}`}
                  style={tx('800', 28, t.colors.ink, { marginTop: 12, letterSpacing: 1.2 })}
                >
                  +91 {spaced(phone)}
                </RNText>
                <RNText style={tx('400', 13, t.colors.muted, { marginTop: 6, lineHeight: 19 })}>
                  No account uses this number yet, so we will make one for it.
                </RNText>
              </View>
              <View style={{ marginTop: 26 }}>
                <BirthDateField value={dob} onChange={setDob} onSubmit={() => void confirmBirth()} autoFocus />
              </View>
              <PrimaryButton
                label={busy ? 'Sending…' : 'Text me a code'}
                onPress={() => void confirmBirth()}
                busy={busy}
                disabled={!parseBirthDate(dob.day, dob.month, dob.year)}
                style={{ marginTop: 26, borderRadius: 999 }}
              />
              {consent}
            </>
          ) : (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 22 }}>
                <View
                  style={{
                    backgroundColor: door === 'signin' ? t.colors.accentSoft : t.colors.goldSoft,
                    borderRadius: 999,
                    paddingHorizontal: 11,
                    paddingVertical: 5,
                  }}
                >
                  <RNText style={tx('700', 12, door === 'signin' ? t.colors.accentDeep : t.colors.goldInk)}>
                    {door === 'signin' ? 'Returning member' : 'New account'}
                  </RNText>
                </View>
                <RNText style={tx('700', 16, t.colors.ink, { flex: 1 })} numberOfLines={1}>
                  +91 {spaced(phone)}
                </RNText>
                <Pressable onPress={editNumber} hitSlop={8} accessibilityRole="button">
                  <RNText style={tx('700', 13, t.colors.accentDeep)}>Change</RNText>
                </Pressable>
              </View>

              {/* Six beads on a string. Each fills as its digit arrives. The beads and the test code
                  scroll up clear of the keyboard while the code box is in use. */}
              <RevealWhen when={codeFocused} again={devCode}>
              <Pressable onPress={() => codeRef.current?.focus()} style={{ marginTop: 26 }}>
                <View style={{ justifyContent: 'center' }}>
                  <View
                    style={{ position: 'absolute', left: 22, right: 22, height: 2, backgroundColor: t.colors.line }}
                  />
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                    {[0, 1, 2, 3, 4, 5].map((i) => {
                      const v = otp[i] ?? '';
                      const next = codeFocused && i === Math.min(otp.length, 5) && !v;
                      return (
                        <View
                          key={i}
                          style={{
                            width: 46,
                            height: 46,
                            borderRadius: 46,
                            alignItems: 'center',
                            justifyContent: 'center',
                            backgroundColor: v ? t.colors.btn : t.colors.bg,
                            borderWidth: 2,
                            borderColor: v ? t.colors.btn : next ? t.colors.accent : t.colors.line,
                            ...(next && Platform.OS === 'web' ? ({ boxShadow: `0 0 0 4px ${t.colors.accentSoft}` } as object) : null),
                          }}
                        >
                          <RNText style={tx('800', 19, v ? t.colors.onBtn : t.colors.muted)}>{v || '·'}</RNText>
                        </View>
                      );
                    })}
                  </View>
                </View>
                {/* The real field. Invisible, but it is what receives the code. */}
                <TextInput
                  ref={codeRef}
                  value={otp}
                  onFocus={() => setCodeFocused(true)}
                  onBlur={() => setCodeFocused(false)}
                  onChangeText={(v) => setOtp(v.replace(/[^0-9]/g, '').slice(0, 6))}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  maxLength={6}
                  // Browsers only know "one-time-code"; react-native-web passes "sms-otp" through untouched, which
                  // they ignore, so phones never offered the code from the SMS on the website (one-tap plan 1.1).
                  autoComplete={Platform.OS === 'web' ? 'one-time-code' : 'sms-otp'}
                  textContentType="oneTimeCode"
                  accessibilityLabel="Six-digit code"
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 46, opacity: 0 }}
                />
              </Pressable>

              {devCode ? (
                <View
                  style={{
                    marginTop: 18,
                    backgroundColor: t.colors.goldSoft,
                    borderRadius: 14,
                    paddingVertical: 10,
                    paddingHorizontal: 14,
                    alignItems: 'center',
                  }}
                >
                  <RNText style={tx('600', 12, t.colors.goldInk)}>Test mode: no SMS is sent. Type this code.</RNText>
                  <RNText
                    testID="dev-code"
                    accessibilityLabel="Test code"
                    selectable
                    style={tx('800', 24, t.colors.goldInk, { letterSpacing: 6, marginTop: 4 })}
                  >
                    {devCode}
                  </RNText>
                </View>
              ) : null}
              </RevealWhen>

              <View style={{ flexDirection: 'row', justifyContent: 'center', marginTop: 22 }}>
                {busy ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <ActivityIndicator color={t.colors.accent} />
                    <RNText style={tx('600', 13, t.colors.muted)}>{complete ? 'Checking…' : 'Sending…'}</RNText>
                  </View>
                ) : (
                  <Pressable onPress={() => void sendCode()} disabled={waitSec > 0} hitSlop={8} accessibilityRole="button">
                    <RNText style={tx('700', 13, waitSec > 0 ? t.colors.muted : t.colors.accentDeep)}>
                      {waitSec > 0 ? `No code? Ask again in 0:${String(waitSec).padStart(2, '0')}` : 'No code? Send it again'}
                    </RNText>
                  </Pressable>
                )}
              </View>

              <PrimaryButton
                label="Verify and continue"
                onPress={() => void verify()}
                busy={busy && complete}
                disabled={!complete}
                style={{ marginTop: 22, borderRadius: 999 }}
              />
            </>
          )}

          <View style={{ flex: 1 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginTop: 28 }}>
            <Icon name="shield" size={13} color={t.colors.muted} />
            <RNText style={tx('400', 12, t.colors.muted)}>One account for hiring and earning.</RNText>
          </View>
          <View style={{ flexDirection: 'row', justifyContent: 'center', flexWrap: 'wrap', gap: 14, marginTop: 10 }}>
            {(
              [
                ['terms', 'Terms'],
                ['privacy', 'Privacy'],
                ['copyright', 'Copyright'],
                ['support', 'Support'],
              ] as const
            ).map(([page, label]) => (
              <Pressable key={page} onPress={() => go(page)} hitSlop={{ top: 13, bottom: 13, left: 6, right: 6 }} accessibilityRole="link">
                {/* B172: 15 px links, 40 px to tap; the 14 px gaps between them are shared. */}
                <HitArea x={6} y={13} />
                <RNText style={tx('500', 12, t.colors.muted, { textDecorationLine: 'underline' })}>{label}</RNText>
              </Pressable>
            ))}
          </View>
        </View>
      </KeyboardScrollView>

      <BottomSheet
        visible={pwOpen}
        onClose={() => setPwOpen(false)}
        title="Sign in with a username"
        subtitle="For accounts that have set a password in Settings → Security."
        footer={<PrimaryButton label="Sign in" onPress={() => void passwordSignIn()} busy={pwBusy} />}
      >
        <Field
          label="Username"
          value={username}
          onChangeText={(v) => {
            setUsername(v.replace(/[^a-zA-Z0-9_@]/g, '').toLowerCase());
            setPwMissing(null);
          }}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="yourname"
          left={<RNText style={tx('600', 15, t.colors.muted)}>@</RNText>}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={(v) => {
            setPasswordText(v);
            setPwMissing(null);
          }}
          secureTextEntry
          autoCapitalize="none"
          style={{ marginTop: 14 }}
          returnKeyType="go"
          onSubmitEditing={() => void passwordSignIn()}
        />
        {pwMissing ? (
          // B179: said under the boxes too, not only in a toast that is gone in 2 seconds.
          <RNText accessibilityRole="alert" style={tx('600', 13, t.colors.signalDeep, { marginTop: 10 })}>
            {pwMissing}
          </RNText>
        ) : null}
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 12, lineHeight: 18 })}>
          Forgot it? Use your mobile number instead, then set a new password in Settings → Security within 15 minutes.
        </RNText>
      </BottomSheet>
    </Screen>
  );
}
