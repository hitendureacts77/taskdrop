import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  Animated,
} from 'react-native';
import { Drop, Ripples } from '../components/Ripples';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { BottomSheet, Field, PrimaryButton } from '../components/kit';
import { tx } from '../components/primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { AuthError, useAuth } from '../providers/AuthProvider';
import { postSignInRoute } from '../data/api';
import { supabase } from '../lib/supabase';
import { signInWithUsername } from '../data/extras';

/**
 * The way in: one screen for new and returning people alike.
 *
 * There is no "Create account" / "Sign in" fork. The number is the key: the
 * server already knows whether it has an account for it (phone-auth checks
 * before any code is made), so this screen asks as a returning member first
 * and, if the server says there is no such account, quietly asks again as a
 * new one. The person only ever sees "text me a code".
 *
 * Google and @username + password stay available as the two quieter ways in.
 * Hiring or earning is chosen later, in setup -- not here.
 */

type Stage = 'number' | 'code';
type Door = 'signin' | 'signup';

/** "9876543210" -> "98765 43210", the way people say a number aloud. */
function spaced(digits: string): string {
  return digits.length > 5 ? `${digits.slice(0, 5)} ${digits.slice(5)}` : digits;
}

export function AccessScreen() {
  const t = useTheme();
  const { go, reset } = useNav();
  const { celebrate, flash } = useActions();
  const { requestCode, verifyCode, signInWithGoogle } = useAuth();

  const [stage, setStage] = useState<Stage>('number');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  // Which door the server let us through. Decided when the code is sent and
  // reused to verify it, because only 'signup' may create an account.
  const [door, setDoor] = useState<Door>('signin');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [phoneFocused, setPhoneFocused] = useState(false);
  const [codeFocused, setCodeFocused] = useState(false);

  const [pwOpen, setPwOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPasswordText] = useState('');
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

  const phoneRef = useRef<TextInput>(null);
  const codeRef = useRef<TextInput>(null);

  // The line under the number fills as it is typed: ten digits, ten steps.
  const fill = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(fill, { toValue: phone.length / 10, duration: 160, useNativeDriver: false }).start();
  }, [phone.length, fill]);

  const numberReady = phone.length === 10;
  const complete = otp.length === 6;

  // Where to go once a session exists. Returning people go straight in; a
  // first sign-in goes through setup.
  const proceed = async () => {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;
    const route = await postSignInRoute(user.id);
    if (route === 'home') reset('home');
    else go('setup');
  };

  /**
   * Ask as a returning member first. "No account" means a new person: ask
   * again as one. The reverse ("already exists") can only happen if the number
   * was registered a moment ago, and is handled the same way.
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
        result = await requestCode(phone, used);
      }
      setDoor(used);
      setStage('code');
      setOtp('');
      setResendAt(Date.now() + 60_000);
      setNow(Date.now());
      if (result.devCode) {
        flash('Development code filled in');
        setOtp(result.devCode);
      } else {
        flash(`Code sent to +91 ${spaced(phone)}`);
        setTimeout(() => codeRef.current?.focus(), 250);
      }
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send a code');
    } finally {
      setBusy(false);
    }
  };

  // Six digits can only mean one thing, so submit rather than waiting for a
  // tap. The guard is a ref, not state: a code is single-use, so two in-flight
  // verifies mean the second one always fails.
  const verifying = useRef(false);
  useEffect(() => {
    if (!complete || busy || verifying.current || stage !== 'code') return;
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
      flash(e instanceof Error ? e.message : 'Could not sign in with Google');
    } finally {
      setGoogleBusy(false);
    }
  };

  const passwordSignIn = async () => {
    if (!username.trim() || !password) return flash('Enter your username and password');
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
      ? { title: 'Get help nearby.\nOr earn nearby.', sub: 'All it takes is your mobile number. New or returning — we’ll know.' }
      : {
          title: door === 'signin' ? 'Good to see\nyou again.' : 'Nice to meet\nyou.',
          sub:
            door === 'signin'
              ? 'Enter the code we just texted to sign in.'
              : 'Enter the code we just texted. Your account is made the moment it matches.',
        };

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ flexGrow: 1, paddingBottom: 22 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {/* The picture: the droplet with its ripples, on the brand colour. */}
        <View
          style={{
            height: 230,
            backgroundColor: t.colors.hero,
            borderBottomLeftRadius: 36,
            borderBottomRightRadius: 36,
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          <Ripples color="rgba(255,255,255,0.9)" size={360} />
          <View
            style={{
              width: 78,
              height: 78,
              borderRadius: 78,
              backgroundColor: '#FFFFFF',
              alignItems: 'center',
              justifyContent: 'center',
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 18,
              shadowOffset: { width: 0, height: 8 },
              elevation: 6,
            }}
          >
            <Drop size={44} fill={t.colors.hero} tick="#FFFFFF" />
          </View>
          <RNText style={tx('800', 22, '#FFFFFF', { letterSpacing: -0.8, position: 'absolute', top: 18, left: 22 })}>
            taskdrop<RNText style={{ color: '#7FE3C4' }}>.</RNText>
          </RNText>
        </View>

        <View style={{ flex: 1, paddingHorizontal: 22, paddingTop: 26 }}>
          <RNText style={tx('800', 30, t.colors.ink, { letterSpacing: -1.1, lineHeight: 35 })}>{heading.title}</RNText>
          <RNText style={tx('400', 14, t.colors.muted, { marginTop: 10, lineHeight: 21 })}>{heading.sub}</RNText>

          {stage === 'number' ? (
            <>
              {/* The number, big, on a line that fills as it is typed. */}
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
                    value={spaced(phone)}
                    onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, '').slice(0, 10))}
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
                    maxLength={11}
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

              <PrimaryButton
                label={busy ? 'Sending…' : 'Text me a code'}
                onPress={() => void sendCode()}
                busy={busy}
                disabled={!numberReady}
                style={{ marginTop: 26, borderRadius: 999 }}
              />

              {/* The other two ways in, side by side and quieter. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 26 }}>
                <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
                <RNText style={tx('500', 12, t.colors.muted)}>or use</RNText>
                <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
              </View>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
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
              </View>
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
                <RNText style={tx('500', 13, t.colors.muted, { flex: 1 })} numberOfLines={1}>
                  +91 {spaced(phone)}
                </RNText>
                <Pressable onPress={editNumber} hitSlop={8} accessibilityRole="button">
                  <RNText style={tx('700', 13, t.colors.accentDeep)}>Change</RNText>
                </Pressable>
              </View>

              {/* Six beads on a string. Each fills as its digit arrives. */}
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
                            backgroundColor: v ? t.colors.accent : t.colors.bg,
                            borderWidth: 2,
                            borderColor: v ? t.colors.accent : next ? t.colors.accent : t.colors.line,
                          }}
                        >
                          <RNText style={tx('800', 19, v ? t.colors.onAccent : t.colors.muted)}>{v || '·'}</RNText>
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
                  autoComplete="sms-otp"
                  textContentType="oneTimeCode"
                  accessibilityLabel="Six-digit code"
                  style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 46, opacity: 0 }}
                />
              </Pressable>

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
        </View>
      </ScrollView>

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
          onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_@]/g, '').toLowerCase())}
          autoCapitalize="none"
          autoCorrect={false}
          placeholder="yourname"
          left={<RNText style={tx('600', 15, t.colors.muted)}>@</RNText>}
        />
        <Field
          label="Password"
          value={password}
          onChangeText={setPasswordText}
          secureTextEntry
          autoCapitalize="none"
          style={{ marginTop: 14 }}
          returnKeyType="go"
          onSubmitEditing={() => void passwordSignIn()}
        />
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 12, lineHeight: 18 })}>
          Forgot it? Use your mobile number instead, then set a new password in Settings → Security.
        </RNText>
      </BottomSheet>
    </Screen>
  );
}
