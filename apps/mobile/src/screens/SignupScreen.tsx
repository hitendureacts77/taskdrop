import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput, ActivityIndicator, type TextStyle } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme, ring } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useActions } from '../providers/AppStateProvider';
import { AuthError, useAuth } from '../providers/AuthProvider';
import { postSignInRoute } from '../data/api';
import { supabase } from '../lib/supabase';
import { tx } from '../components/primitives';
import { Field, PrimaryButton } from '../components/kit';
import { signInWithUsername } from '../data/extras';

export function SignupScreen() {
  const t = useTheme();
  const { go, back, reset, params } = useNav();
  const { celebrate, flash } = useActions();
  const { requestCode, verifyCode, signInWithGoogle } = useAuth();
  const [phone, setPhone] = useState('');
  // Set when the server says this is the wrong door for this number.
  const [wrongDoor, setWrongDoor] = useState<'exists' | 'none' | null>(null);
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  // Signing in can also be @username + password, once one is set in
  // Settings -> Security. Creating an account is always by phone.
  const [method, setMethod] = useState<'phone' | 'password'>('phone');
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

  // One screen serves both doors off the welcome page. The exchange is
  // identical either way -- a phone number and a six-digit code -- but the
  // wording has to match what the person thought they were doing, and only
  // the sign-up door is allowed to register a number that has no account.
  const mode: 'signin' | 'signup' = params.mode === 'signin' ? 'signin' : 'signup';
  const signingIn = mode === 'signin';

  const copy = signingIn
    ? {
        title: 'Welcome back',
        sub: 'Use Google, your mobile number, or your @username.',
        switchPrompt: 'New here?',
        switchAction: 'Create an account',
      }
    : {
        title: 'Create your account',
        sub: 'One account covers posting and working.',
        switchPrompt: 'Already have an account?',
        switchAction: 'Sign in',
      };

  const complete = otp.length === 6;

  // Six digits can only mean one thing, so submit rather than waiting for a tap.
  // The guard is a ref, not state: a code is single-use, so two in-flight
  // verifies mean the second one always fails.
  const verifying = useRef(false);
  useEffect(() => {
    if (!complete || busy || verifying.current) return;
    verifying.current = true;
    void verify().finally(() => {
      verifying.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, busy]);

  const codeRef = useRef<TextInput>(null);
  const [codeFocused, setCodeFocused] = useState(false);

  // Normally the code arrives by SMS and is typed in by hand. While the server
  // is in development (no SMS yet) it hands the code back instead, and it is
  // filled in here -- the six digits then submit themselves.
  //
  // The mode goes with the request, so the server can stop at the wrong door
  // before any code is made: "Create account" for a number that already has
  // one, or "Sign in" for a number that has none.
  const sendCode = async () => {
    if (phone.replace(/[^0-9]/g, '').length !== 10) return flash('Enter a 10-digit mobile number');
    setBusy(true);
    setWrongDoor(null);
    try {
      const { devCode } = await requestCode(phone, mode);
      setResendAt(Date.now() + 60_000);
      setNow(Date.now());
      if (devCode) {
        flash('Development code filled in');
        setOtp(devCode);
      } else {
        flash(`Code sent to +91 ${phone}`);
        codeRef.current?.focus();
      }
    } catch (e) {
      if (e instanceof AuthError && (e.accountExists || e.noAccount)) {
        setWrongDoor(e.accountExists ? 'exists' : 'none');
      } else {
        flash(e instanceof Error ? e.message : 'Could not send a code');
      }
    } finally {
      setBusy(false);
    }
  };

  // Go through the other door with the same number, ready to send a code.
  const switchDoor = () => {
    setWrongDoor(null);
    setOtp('');
    setResendAt(0);
    go('signup', { mode: signingIn ? 'signup' : 'signin' });
  };

  const verify = async () => {
    if (!complete) return flash('Enter all six digits');
    setBusy(true);
    try {
      await verifyCode(phone, otp, mode);
      celebrate(signingIn ? 'Signed in' : 'Number verified');
      // Returning users go straight to the app; setup is for the first run.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const route = await postSignInRoute(user?.id ?? '');
      if (route === 'home') reset('home');
      else go('setup');
    } catch (e) {
      if (e instanceof AuthError && (e.accountExists || e.noAccount)) {
        setWrongDoor(e.accountExists ? 'exists' : 'none');
      } else {
        flash(e instanceof Error ? e.message : 'That code is not right');
      }
      // Clear it, or the auto-submit cannot fire again for a retry.
      setOtp('');
      codeRef.current?.focus();
    } finally {
      setBusy(false);
    }
  };

  // On the web this never returns -- the page redirects to Google and back,
  // and AuthProvider's postAuthRoute takes over routing on that fresh load.
  // Native stays on this screen the whole time, so it routes itself here,
  // the same way verify() does above.
  const googleSignIn = async () => {
    setGoogleBusy(true);
    try {
      await signInWithGoogle(mode);
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) {
        const route = await postSignInRoute(user.id);
        if (route === 'home') reset('home');
        else go('setup');
      }
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
      celebrate('Signed in');
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const route = await postSignInRoute(user?.id ?? '');
      if (route === 'home') reset('home');
      else go('setup');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not sign in');
    } finally {
      setPwBusy(false);
    }
  };

  const label = (s: string, extra?: TextStyle) => (
    <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={back} hitSlop={10}>
          <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
        </Pressable>

        <RNText style={tx('800', 27, t.colors.ink, { letterSpacing: -0.81, marginTop: 22 })}>
          {copy.title}
        </RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
          {copy.sub}
        </RNText>

        {/* All three ways in one place: Google, then the phone code or a
            username + password. Google goes first because it is one tap. */}
        <Pressable
          onPress={googleSignIn}
          disabled={googleBusy}
          style={({ pressed }) => ({
            marginTop: 22,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
            paddingVertical: 15,
            alignItems: 'center',
            opacity: googleBusy ? 0.6 : 1,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          {googleBusy ? (
            <ActivityIndicator color={t.colors.ink} />
          ) : (
            <RNText style={tx('600', 15, t.colors.ink)}>Continue with Google</RNText>
          )}
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
          <RNText style={tx('400', 12, t.colors.muted)}>or</RNText>
          <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
        </View>


        {signingIn ? (
          <View style={{ flexDirection: 'row', marginTop: 18, backgroundColor: t.colors.surface2, borderRadius: 12, padding: 4 }}>
            {(['phone', 'password'] as const).map((m) => (
              <Pressable
                key={m}
                onPress={() => setMethod(m)}
                accessibilityRole="tab"
                accessibilityState={{ selected: method === m }}
                style={{ flex: 1, paddingVertical: 10, borderRadius: 9, alignItems: 'center', backgroundColor: method === m ? t.colors.bg : 'transparent' }}
              >
                <RNText style={tx('700', 14, method === m ? t.colors.ink : t.colors.muted)}>
                  {m === 'phone' ? 'Phone' : 'Username'}
                </RNText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {method === 'password' && signingIn ? (
          <>
            <Field
              label="Username"
              value={username}
              onChangeText={(v) => setUsername(v.replace(/[^a-zA-Z0-9_@]/g, '').toLowerCase())}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="yourname"
              left={<RNText style={tx('600', 15, t.colors.muted)}>@</RNText>}
              style={{ marginTop: 22 }}
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
            <PrimaryButton label="Sign in" onPress={() => void passwordSignIn()} busy={pwBusy} style={{ marginTop: 20 }} />
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 12, lineHeight: 18, textAlign: 'center' })}>
              Forgot your password? Sign in with your phone, then set a new one in Settings → Security.
            </RNText>
          </>
        ) : (
          <>
        {label('MOBILE NUMBER', { marginTop: 26 })}
        <View {...ring}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            marginTop: 11,
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            // Same bordered box as the six code boxes below: without it this
            // field reads as a flat patch rather than a field.
            borderWidth: 1,
            borderColor: phone.length === 10 ? t.colors.ink : t.colors.line,
            paddingVertical: 15,
            paddingHorizontal: 16,
          }}
        >
          <RNText style={tx('400', 15, t.colors.muted)}>+91</RNText>
          <View style={{ width: 1, height: 18, backgroundColor: t.colors.line }} />
          <TextInput
            value={phone}
            onChangeText={(v) => {
              setPhone(v.replace(/[^0-9]/g, '').slice(0, 10));
              setWrongDoor(null);
            }}
            onSubmitEditing={() => void sendCode()}
            returnKeyType="send"
            placeholder="98765 43210"
            placeholderTextColor={t.colors.muted}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={10}
            style={tx('400', 16, t.colors.ink, { flex: 1, padding: 0 })}
          />
        </View>

        {/* Sending the code belongs with the number you are sending it to, so
            this row sits between the phone block and the code block. */}
        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 12,
          }}
        >
          <RNText style={tx('400', 13, t.colors.muted)}>
            {resendAt && phone.length === 10 ? `Sent to +91 •••• ••${phone.slice(-4)}` : 'Enter your number'}
          </RNText>
          <Pressable onPress={sendCode} hitSlop={8} disabled={busy || waitSec > 0}>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>
              {busy
                ? 'Sending…'
                : waitSec > 0
                  ? `Resend in 0:${String(waitSec).padStart(2, '0')}`
                  : resendAt
                    ? 'Resend code'
                    : 'Send code'}
            </RNText>
          </Pressable>
        </View>

        {wrongDoor ? (
          <View
            style={{
              marginTop: 14,
              backgroundColor: t.colors.accentSoft,
              borderWidth: 1,
              borderColor: t.colors.accentBorder,
              borderRadius: 14,
              padding: 14,
            }}
          >
            <RNText style={tx('700', 14, t.colors.ink)}>
              {wrongDoor === 'exists' ? 'You already have an account' : 'No account for this number yet'}
            </RNText>
            <RNText style={tx('400', 13, t.colors.muted, { marginTop: 4, lineHeight: 19 })}>
              {wrongDoor === 'exists'
                ? `+91 ${phone} is already registered on TaskDrop. Sign in to continue.`
                : `Create an account with +91 ${phone} — it only takes a minute.`}
            </RNText>
            <Pressable
              onPress={switchDoor}
              accessibilityRole="button"
              style={({ pressed }) => ({
                marginTop: 12,
                alignSelf: 'flex-start',
                backgroundColor: t.colors.accent,
                borderRadius: 999,
                paddingVertical: 9,
                paddingHorizontal: 16,
                transform: [{ scale: pressed ? 0.97 : 1 }],
              })}
            >
              <RNText style={tx('700', 13, t.colors.onAccent)}>
                {wrongDoor === 'exists' ? 'Sign in instead' : 'Create account instead'}
              </RNText>
            </Pressable>
          </View>
        ) : null}

        {label('6-DIGIT CODE · SENT BY SMS', { marginTop: 24 })}
        <Pressable onPress={() => codeRef.current?.focus()}>
          <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const v = otp[i] ?? '';
              // While typing the code, the box the next digit lands in lights up.
              const active = codeFocused && i === Math.min(otp.length, 5);
              return (
                <View
                  key={i}
                  style={{
                    flex: 1,
                    height: 54,
                    borderRadius: 12,
                    backgroundColor: t.colors.surface2,
                    borderWidth: 1,
                    borderColor: v ? t.colors.ink : active ? t.colors.accent : t.colors.line,
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <RNText style={tx('700', 20, t.colors.ink)}>{v}</RNText>
                </View>
              );
            })}
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
            style={{
              position: 'absolute',
              top: 11,
              left: 0,
              right: 0,
              height: 54,
              opacity: 0,
            }}
          />
        </Pressable>

        <Pressable
          onPress={verify}
          style={({ pressed }) => ({
            marginTop: 24,
            borderRadius: 12,
            paddingVertical: 16,
            alignItems: 'center',
            backgroundColor: complete ? t.colors.accent : t.colors.surface2,
            transform: [{ scale: pressed ? 0.96 : 1 }],
            ...(complete
              ? {
                  shadowColor: t.colors.accent,
                  shadowOpacity: 0.35,
                  shadowRadius: 22,
                  shadowOffset: { width: 0, height: 8 },
                  elevation: 6,
                }
              : null),
          })}
        >
          {busy ? (
            <ActivityIndicator color={complete ? t.colors.onAccent : t.colors.muted} />
          ) : (
            <RNText style={tx('700', 15, complete ? t.colors.onAccent : t.colors.muted)}>
              {complete ? 'Verify and continue' : 'Enter the 6-digit code'}
            </RNText>
          )}
        </Pressable>

          </>
        )}


        {/* The other door. Pushing rather than replacing keeps the back arrow
            meaningful -- it still leads out to the welcome screen. */}
        <Pressable
          onPress={() => go('signup', { mode: signingIn ? 'signup' : 'signin' })}
          hitSlop={8}
          style={{ marginTop: 22, flexDirection: 'row', justifyContent: 'center', gap: 6 }}
        >
          <RNText style={tx('400', 14, t.colors.muted)}>{copy.switchPrompt}</RNText>
          <RNText style={tx('700', 14, t.colors.accent)}>{copy.switchAction}</RNText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
