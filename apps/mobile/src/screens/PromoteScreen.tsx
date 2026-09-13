import React, { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, type TextStyle } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { fontFamilyFor } from '../theme';

/**
 * Promote — pixel parity with docs/design/_design_markup.html lines 995-1054.
 * Budget/duration chips, optional audience narrowing and the estimated-reach
 * card, using the design's reach formula (_design_source.jsx lines 265-269).
 */

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

const DURATIONS = [
  { label: '1 day', days: 1 },
  { label: '3 days', days: 3 },
  { label: '7 days', days: 7 },
];

export function PromoteScreen() {
  const t = useTheme();
  const { go, back } = useNav();
  const { mode } = useMode();
  const { celebrate } = useApp();

  const worker = mode === 'worker';
  const [budgetIdx, setBudgetIdx] = useState(1);
  const [durIdx, setDurIdx] = useState(1);
  const [audienceOn, setAudienceOn] = useState(false);

  const budgets = worker ? [50, 80, 150] : [80, 150, 300];
  const budget = budgets[budgetIdx]!;
  const days = DURATIONS[durIdx]!.days;
  const total = budget * days;

  // Design's reach model: base band, narrowed to 55% when the audience filter is
  // on, scaled by the chosen budget relative to the middle tier.
  const base = worker ? [900, 1600] : [1800, 3400];
  const scale = (audienceOn ? 0.55 : 1) * (budget / budgets[1]!);
  const reach = base.map((n) => Math.round(n * scale).toLocaleString('en-IN'));

  const label = (s: string, extra?: TextStyle, color?: string) => (
    <RNText style={tx('400', 11, color ?? t.colors.muted, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  const chipRow = (
    items: string[],
    active: number,
    onPick: (i: number) => void,
    extra?: TextStyle,
  ) => (
    <View style={{ flexDirection: 'row', gap: 8, ...extra }}>
      {items.map((it, i) => {
        const on = active === i;
        return (
          <Pressable
            key={it}
            onPress={() => onPick(i)}
            style={({ pressed }) => ({
              flex: 1,
              borderRadius: 10,
              paddingVertical: 10,
              alignItems: 'center',
              backgroundColor: on ? t.colors.accentSoft : 'transparent',
              borderWidth: 1,
              borderColor: on ? t.colors.accent : t.colors.line,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            <RNText style={tx('600', 13, on ? t.colors.ink : t.colors.muted)}>{it}</RNText>
          </Pressable>
        );
      })}
    </View>
  );

  const start = () => {
    celebrate('Campaign live · sponsored placement');
    go(worker ? 'home' : 'orders');
  };

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
          <Pressable onPress={back} hitSlop={10}>
            <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
          </Pressable>
          <RNText style={tx('700', 17, t.colors.ink)}>
            {worker ? 'Promote this service' : 'Promote this task'}
          </RNText>
        </View>

        <View
          style={{
            marginTop: 14,
            backgroundColor: t.colors.surface,
            borderWidth: 1,
            borderColor: t.colors.line,
            borderRadius: 14,
            padding: 13,
            flexDirection: 'row',
            gap: 12,
            alignItems: 'center',
          }}
        >
          <View
            style={{
              width: 42,
              height: 42,
              borderRadius: 11,
              backgroundColor: t.colors.surface2,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('400', 16, t.colors.muted)}>▤</RNText>
          </View>
          <View style={{ flex: 1, minWidth: 0 }}>
            <RNText style={tx('700', 15, t.colors.ink)}>
              {worker ? 'Bespoke carpentry and joinery' : 'Vintage 35mm film camera'}
            </RNText>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>
              {worker ? '₹1,200 rate · 61 jobs done' : '₹4,500 · open · 12 quotes'}
            </RNText>
          </View>
        </View>

        {label('DAILY BUDGET', { marginTop: 18 })}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'baseline',
            gap: 8,
            marginTop: 9,
            paddingBottom: 10,
            borderBottomWidth: 1,
            borderBottomColor: t.colors.accent,
          }}
        >
          <RNText style={tx('800', 29, t.colors.ink)}>₹{budget}</RNText>
          <RNText style={tx('400', 12, t.colors.muted, { marginLeft: 'auto' })}>
            ₹{total.toLocaleString('en-IN')} over {DURATIONS[durIdx]!.label}
          </RNText>
        </View>
        {chipRow(budgets.map((b) => `₹${b}`), budgetIdx, setBudgetIdx, { marginTop: 11 })}

        {label('RUN FOR', { marginTop: 18 })}
        {chipRow(DURATIONS.map((d) => d.label), durIdx, setDurIdx, { marginTop: 10 })}

        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginTop: 20,
          }}
        >
          <View style={{ flex: 1 }}>
            {label('SHOW IT TO · OPTIONAL')}
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 4 })}>
              {audienceOn ? 'Narrowing who sees it' : 'Off · everyone in your city'}
            </RNText>
          </View>
          <Pressable
            onPress={() => setAudienceOn((v) => !v)}
            style={{
              width: 42,
              height: 24,
              borderRadius: 999,
              padding: 3,
              backgroundColor: audienceOn ? t.colors.accent : t.colors.line,
              justifyContent: 'center',
            }}
          >
            <View
              style={{
                width: 18,
                height: 18,
                borderRadius: 999,
                backgroundColor: '#FFFFFF',
                transform: [{ translateX: audienceOn ? 18 : 0 }],
              }}
            />
          </Pressable>
        </View>

        {audienceOn && (
          <View style={{ marginTop: 14 }}>
            {[
              worker ? 'Posters within 15 km' : 'Workers within 12 km',
              worker ? 'Services' : 'Services · Products',
            ].map((row, i) => (
              <View
                key={row}
                style={{
                  flexDirection: 'row',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  paddingTop: i === 0 ? 0 : 11,
                  paddingBottom: 11,
                  borderBottomWidth: 1,
                  borderBottomColor: t.colors.line,
                }}
              >
                <RNText style={tx('400', 15, t.colors.ink)}>{row}</RNText>
                <RNText style={tx('600', 13, t.colors.accentDeep)}>Change</RNText>
              </View>
            ))}
          </View>
        )}

        <View
          style={{
            marginTop: 16,
            backgroundColor: t.colors.accentSoft,
            borderWidth: 1,
            borderColor: t.colors.accentBorder,
            borderRadius: 12,
            paddingVertical: 13,
            paddingHorizontal: 16,
          }}
        >
          {label('ESTIMATED REACH', {}, t.colors.accentDeep)}
          <RNText style={tx('800', 22, t.colors.ink, { marginTop: 4 })}>
            {reach[0]} – {reach[1]}
          </RNText>
          <RNText style={tx('400', 12, t.colors.accentDeep, { marginTop: 3 })}>
            {worker ? 'posters' : 'workers'} per day
            {audienceOn ? ' in your radius' : ' across your city'}
          </RNText>
        </View>
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressable
          onPress={start}
          style={({ pressed }) => ({
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>
            Start campaign · ₹{total.toLocaleString('en-IN')}
          </RNText>
        </Pressable>
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10 })}>
          Pause or stop any time. You are charged for days run.
        </RNText>
      </View>
    </Screen>
  );
}
