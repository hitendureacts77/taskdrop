import React, { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, type TextStyle } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { fontFamilyFor } from '../theme';

/**
 * Sign up · OTP — pixel parity with docs/design/_design_markup.html lines
 * 529-558. Tapping a box fills the next digit and "Autofill" completes the code,
 * mirroring the design's otpBoxes/fillOtp/verifyOtp handlers.
 */

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

export function SignupScreen() {
  const t = useTheme();
  const { go, back } = useNav();
  const { celebrate, flash } = useApp();
  const [otp, setOtp] = useState('');

  const complete = otp.length === 6;

  const tapBox = (i: number) => setOtp((prev) => (prev + String((i % 9) + 1)).slice(0, 6));

  const verify = () => {
    if (!complete) return flash('Enter all six digits');
    go('setup');
    celebrate('Number verified');
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
          <RNText style={tx('400', 16, t.colors.ink)}>98765 43210</RNText>
        </View>

        {label('6-DIGIT CODE · SENT BY SMS', { marginTop: 24 })}
        <View style={{ flexDirection: 'row', gap: 9, marginTop: 11 }}>
          {[0, 1, 2, 3, 4, 5].map((i) => {
            const v = otp[i] ?? '';
            return (
              <Pressable
                key={i}
                onPress={() => tapBox(i)}
                style={{
                  flex: 1,
                  height: 54,
                  borderRadius: 12,
                  backgroundColor: t.colors.surface2,
                  borderWidth: 1,
                  borderColor: v ? t.colors.ink : t.colors.line,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <RNText style={tx('700', 20, t.colors.ink)}>{v}</RNText>
              </Pressable>
            );
          })}
        </View>

        <View
          style={{
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 14,
          }}
        >
          <RNText style={tx('400', 13, t.colors.muted)}>Sent to +91 •••• ••3210</RNText>
          <Pressable onPress={() => setOtp('482173')} hitSlop={8}>
            <RNText style={tx('700', 13, t.colors.accentDeep)}>Autofill</RNText>
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
          <RNText style={tx('700', 15, complete ? t.colors.onAccent : t.colors.muted)}>
            {complete ? 'Verify and continue' : 'Enter the 6-digit code'}
          </RNText>
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
