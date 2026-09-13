import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput, ActivityIndicator, type TextStyle } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { useAuth } from '../providers/AuthProvider';
import { getProfile } from '../data/api';
import { supabase } from '../lib/supabase';
import { tx } from '../components/primitives';

export function SignupScreen() {
  const t = useTheme();
  const { go, back, reset } = useNav();
  const { celebrate, flash } = useApp();
  const { requestCode, verifyCode } = useAuth();
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [busy, setBusy] = useState(false);

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

  // No SMS gateway yet, so the function hands the code back and we fill it in.
  const autofill = async () => {
    if (phone.replace(/[^0-9]/g, '').length !== 10) return flash('Enter a 10-digit mobile number');
    setBusy(true);
    try {
      const { devCode } = await requestCode(phone);
      if (devCode) setOtp(devCode);
      flash('Code sent');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not send a code');
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    if (!complete) return flash('Enter all six digits');
    setBusy(true);
    try {
      await verifyCode(phone, otp);
      celebrate('Number verified');
      // Returning users go straight to the app; setup is for the first run.
      const {
        data: { user },
      } = await supabase.auth.getUser();
      let onboarded = false;
      if (user) {
        try {
          onboarded = Boolean((await getProfile(user.id))?.onboarded_at);
        } catch {
          /* treat an unreadable profile as first run */
        }
      }
      if (onboarded) reset('home');
      else go('setup');
    } catch (e) {
      flash(e instanceof Error ? e.message : 'That code is not right');
      // Clear it, or the auto-submit cannot fire again for a retry.
      setOtp('');
      codeRef.current?.focus();
    } finally {
      setBusy(false);
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
          Create your account
        </RNText>
        <RNText style={tx('400', 14, t.colors.muted, { marginTop: 8, lineHeight: 21 })}>
          One account covers posting and working.
        </RNText>

        {label('MOBILE NUMBER', { marginTop: 26 })}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            marginTop: 11,
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            paddingVertical: 15,
            paddingHorizontal: 16,
          }}
        >
          <RNText style={tx('400', 15, t.colors.muted)}>+91</RNText>
          <View style={{ width: 1, height: 18, backgroundColor: t.colors.line }} />
          <TextInput
            value={phone}
            onChangeText={(v) => setPhone(v.replace(/[^0-9]/g, '').slice(0, 10))}
            onSubmitEditing={() => void autofill()}
            returnKeyType="send"
            placeholder="98765 43210"
            placeholderTextColor={t.colors.muted}
            keyboardType="number-pad"
            inputMode="numeric"
            maxLength={10}
            style={tx('400', 16, t.colors.ink, { flex: 1, padding: 0 })}
          />
        </View>

        {label('6-DIGIT CODE · SENT BY SMS', { marginTop: 24 })}
        <Pressable onPress={() => codeRef.current?.focus()}>
          <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const v = otp[i] ?? '';
              // The box the next digit lands in gets the focus ring.
              const active = i === Math.min(otp.length, 5);
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

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 14,
          }}
        >
          <RNText style={tx('400', 13, t.colors.muted)}>
            {phone.length === 10 ? `Sent to +91 •••• ••${phone.slice(-4)}` : 'Enter your number'}
          </RNText>
          <Pressable onPress={autofill} hitSlop={8} disabled={busy}>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>
              {busy ? 'Sending…' : 'Send code'}
            </RNText>
          </Pressable>
        </View>

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

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 22 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
          <RNText style={tx('400', 12, t.colors.muted)}>or</RNText>
          <View style={{ flex: 1, height: 1, backgroundColor: t.colors.line }} />
        </View>

        <Pressable
          onPress={() => go('setup')}
          style={({ pressed }) => ({
            marginTop: 20,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 12,
            paddingVertical: 15,
            alignItems: 'center',
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <RNText style={tx('600', 15, t.colors.ink)}>Continue with Google</RNText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
