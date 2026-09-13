import React from 'react';
import { View, Text as RNText, Pressable, ScrollView, type TextStyle } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useApp } from '../providers/AppStateProvider';
import { fontFamilyFor } from '../theme';

/**
 * Verified Pro — pixel parity with docs/design/_design_markup.html lines
 * 1058-1094. Band header with the PRO chip, the perks list with the design's
 * circle-check svg, and the three verification steps
 * (_design_source.jsx lines 880-891).
 */

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

const PERKS = [
  { title: 'Verified badge on every quote', sub: 'Posters see you passed ID and skill checks' },
  { title: 'Your quotes stand out', sub: 'Pro quotes are marked in the compare list' },
  { title: 'Priority in search', sub: 'Ranked above unverified taskers on matching tasks' },
  { title: 'Faster clearing', sub: 'Payouts clear in 2 days instead of 7' },
];

function CircleCheck({ color }: { color: string }) {
  return (
    <Svg width={19} height={19} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={10} stroke={color} strokeWidth={1.7} />
      <Path
        d="m8 12.4 2.6 2.6L16 9.6"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function ProScreen() {
  const t = useTheme();
  const { back } = useNav();
  const { flash } = useApp();

  const band = t.isDark ? '#062B1E' : '#0B3D2C';

  const steps = [
    {
      num: '✓',
      label: 'Government ID',
      state: 'Verified',
      bg: t.colors.accent,
      line: t.colors.accent,
      numInk: t.colors.onAccent,
      ink: t.colors.muted,
      stateInk: t.colors.accentDeep,
    },
    {
      num: '2',
      label: 'Selfie match',
      state: 'In review',
      bg: 'transparent',
      line: t.colors.gold,
      numInk: t.colors.gold,
      ink: t.colors.ink,
      stateInk: t.colors.gold,
    },
    {
      num: '3',
      label: 'Skill proof · 3 completed jobs',
      state: '1 of 3',
      bg: 'transparent',
      line: t.colors.line,
      numInk: t.colors.muted,
      ink: t.colors.ink,
      stateInk: t.colors.muted,
    },
  ];

  return (
    <Screen padded={false}>
      {/* Band header */}
      <View style={{ backgroundColor: band, paddingHorizontal: 20, paddingTop: 8, paddingBottom: 22 }}>
        <Pressable onPress={back} hitSlop={10}>
          <RNText style={tx('400', 20, '#FFFFFF')}>←</RNText>
        </Pressable>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, marginTop: 16 }}>
          <View
            style={{
              backgroundColor: t.colors.accent,
              borderRadius: 5,
              paddingVertical: 4,
              paddingHorizontal: 8,
            }}
          >
            <RNText style={tx('800', 10, t.colors.onAccent, { letterSpacing: 1.6 })}>PRO</RNText>
          </View>
          <RNText style={tx('400', 11, 'rgba(255,255,255,0.7)', { letterSpacing: 1.54 })}>
            VERIFIED TASKER
          </RNText>
        </View>
        <RNText style={tx('800', 26, '#FFFFFF', { letterSpacing: -0.78, marginTop: 12, lineHeight: 31.2 })}>
          Win more work with{'\n'}a verified badge
        </RNText>
        <RNText style={tx('400', 14, 'rgba(255,255,255,0.75)', { marginTop: 8, lineHeight: 20.3 })}>
          Verified Pros get 2.4× more accepted quotes.
        </RNText>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 18 }}
        showsVerticalScrollIndicator={false}
      >
        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>WHAT YOU GET</RNText>
        {PERKS.map((p) => (
          <View
            key={p.title}
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 13,
              paddingVertical: 11,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.line,
            }}
          >
            <View style={{ marginTop: 1 }}>
              <CircleCheck color={t.colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <RNText style={tx('700', 15, t.colors.ink)}>{p.title}</RNText>
              <RNText style={tx('400', 13, t.colors.muted, { marginTop: 3, lineHeight: 18.9 })}>
                {p.sub}
              </RNText>
            </View>
          </View>
        ))}

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 18 })}>
          VERIFICATION STEPS
        </RNText>
        {steps.map((s) => (
          <View
            key={s.label}
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 13,
              paddingVertical: 12,
              borderBottomWidth: 1,
              borderBottomColor: t.colors.line,
            }}
          >
            <View
              style={{
                width: 24,
                height: 24,
                borderRadius: 999,
                backgroundColor: s.bg,
                borderWidth: 1,
                borderColor: s.line,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx('800', 11, s.numInk)}>{s.num}</RNText>
            </View>
            <RNText style={tx('400', 15, s.ink, { flex: 1 })}>{s.label}</RNText>
            <RNText style={tx('600', 12, s.stateInk)}>{s.state}</RNText>
          </View>
        ))}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 12, paddingBottom: 24 }}>
        <Pressable
          onPress={() => flash('Selfie match is still in review')}
          style={({ pressed }) => ({
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 15,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <RNText style={tx('700', 15, t.colors.onAccent)}>Continue verification</RNText>
        </Pressable>
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10 })}>
          ₹499 one-time · refunded if rejected
        </RNText>
      </View>
    </Screen>
  );
}
