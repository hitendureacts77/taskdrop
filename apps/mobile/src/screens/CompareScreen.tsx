import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  Animated,
  ScrollView,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { Screen, formatINR } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { fontFamilyFor, type Theme } from '../theme';

type Quote = {
  who: string;
  rating: number;
  pro: boolean;
  meta: string;
  priceMinor: number;
  eta: string;
};

// _design_source.jsx lines 235-239
const COMPARE_DATA: Quote[] = [
  { who: 'Tasker 4172', rating: 4.7, pro: false, meta: '18 jobs · 5 km away', priceMinor: 420000, eta: 'by 9 Sep, 6 PM' },
  { who: 'Tasker 2098', rating: 4.9, pro: true, meta: '42 jobs · 2 km away', priceMinor: 450000, eta: 'by 9 Sep, 6 PM' },
  { who: 'Tasker 8830', rating: 4.6, pro: false, meta: '9 jobs · 8 km away', priceMinor: 510000, eta: 'by 8 Sep, 7 PM' },
  { who: 'Tasker 3315', rating: 4.9, pro: true, meta: '61 jobs · 4 km away', priceMinor: 540000, eta: 'by 10 Sep, 12 PM' },
];

const FALLBACK_BENCH_MINOR = 120000; // ₹1,200 — poster fallback task price

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

/** Fades + slides content in on mount, ~ the markup's tdIn keyframe. Cleans up on unmount. */
function FadeIn({
  children,
  duration = 260,
  delay = 0,
  translateY = 0,
  style,
}: {
  children: React.ReactNode;
  duration?: number;
  delay?: number;
  translateY?: number;
  style?: ViewStyle;
}) {
  const opacity = useRef(new Animated.Value(0)).current;
  const ty = useRef(new Animated.Value(translateY)).current;
  useEffect(() => {
    const anim = Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration, delay, useNativeDriver: true }),
      Animated.timing(ty, { toValue: 0, duration, delay, useNativeDriver: true }),
    ]);
    anim.start();
    return () => anim.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View style={[style, { opacity, transform: [{ translateY: ty }] }]}>{children}</Animated.View>
  );
}

/** Scale-down press feedback, matching the markup's style-active="{{press}}"/"{{cardPress}}". */
function Pressy({
  onPress,
  scaleTo = 0.985,
  style,
  children,
}: {
  onPress?: () => void;
  scaleTo?: number;
  style?: ViewStyle;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [style, { transform: [{ scale: pressed ? scaleTo : 1 }] }]}
    >
      {children}
    </Pressable>
  );
}

/** Poster flow: incoming bids on a posted task, sortable, each lockable into escrow.
 * Pixel parity with docs/design/_design_markup.html lines 752-801. Data/handlers
 * mirror docs/design/_design_source.jsx lines 696-716. */
export function CompareScreen() {
  const t = useTheme();
  const { params, go, back } = useNav();
  const [sortLow, setSortLow] = useState(true);
  const [picked, setPicked] = useState(COMPARE_DATA[0]!.who);

  const title = typeof params.title === 'string' ? params.title : 'Assemble a wardrobe';
  const benchMinor = typeof params.priceMinor === 'number' ? params.priceMinor : FALLBACK_BENCH_MINOR;

  const sorted = useMemo(() => {
    const rows = COMPARE_DATA.slice();
    rows.sort((a, b) => (sortLow ? a.priceMinor - b.priceMinor : b.rating - a.rating));
    return rows;
  }, [sortLow]);

  const pickRow = sorted.find((r) => r.who === picked) ?? sorted[0]!;

  const handleLock = () => {
    go('escrow', { priceMinor: pickRow.priceMinor, title, who: pickRow.who });
  };

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={back} hitSlop={10}>
          <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
        </Pressable>

        <RNText style={tx('700', 10, t.colors.blue, { letterSpacing: 1.6, marginTop: 16 })}>OPEN · 12 QUOTES</RNText>
        <RNText style={tx('800', 23, t.colors.ink, { letterSpacing: -0.69, marginTop: 9 })}>{title}</RNText>

        <View
          style={{
            flexDirection: 'row',
            gap: 22,
            marginTop: 16,
            paddingVertical: 13,
            borderTopWidth: 1,
            borderBottomWidth: 1,
            borderColor: t.colors.line,
          }}
        >
          <View>
            <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>BENCHMARK</RNText>
            <RNText style={tx('800', 19, t.colors.accentDeep, { marginTop: 4 })}>{formatINR(benchMinor)}</RNText>
          </View>
          <View>
            <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>COMPLETE BY</RNText>
            <RNText style={tx('700', 19, t.colors.ink, { marginTop: 4 })}>9 Sep, 6 PM</RNText>
          </View>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
          <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54 })}>INCOMING QUOTES</RNText>
          <Pressable onPress={() => setSortLow((v) => !v)}>
            <RNText style={tx('700', 12, t.colors.accentDeep)}>Sort: {sortLow ? 'lowest' : 'rating'} ▾</RNText>
          </Pressable>
        </View>

        {sorted.map((row, i) => {
          const selected = row.who === picked;
          return (
            <FadeIn key={row.who} duration={340} delay={i * 70} style={{ marginTop: 11 }}>
              <Pressy
                onPress={() => setPicked(row.who)}
                scaleTo={0.985}
                style={{
                  backgroundColor: selected ? t.colors.accentSoft : t.colors.surface,
                  borderWidth: 1,
                  borderColor: selected ? t.colors.accent : t.colors.line,
                  borderRadius: 14,
                  padding: 14,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 999,
                      backgroundColor: t.colors.surface2,
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <RNText style={tx('400', 14, t.colors.muted)}>☺</RNText>
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                      <RNText style={tx('700', 15, t.colors.ink)}>{row.who}</RNText>
                      <RNText style={tx('400', 12, t.colors.muted)}>★ {row.rating.toFixed(1)}</RNText>
                      {row.pro && (
                        <View style={{ backgroundColor: t.colors.accent, borderRadius: 4, paddingVertical: 2, paddingHorizontal: 5 }}>
                          <RNText style={tx('800', 9, t.colors.onAccent, { letterSpacing: 1.08 })}>PRO</RNText>
                        </View>
                      )}
                    </View>
                    <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>{row.meta}</RNText>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <RNText style={tx('800', 17, t.colors.ink)}>{formatINR(row.priceMinor)}</RNText>
                    <RNText style={tx('400', 11, t.colors.muted, { marginTop: 2 })}>{row.eta}</RNText>
                  </View>
                </View>
                {selected && (
                  <View
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 7,
                      marginTop: 11,
                      paddingTop: 11,
                      borderTopWidth: 1,
                      borderTopColor: t.colors.accentBorder,
                    }}
                  >
                    <View style={{ width: 5, height: 5, borderRadius: 999, backgroundColor: t.colors.accent }} />
                    <RNText style={tx('700', 11, t.colors.accentDeep, { letterSpacing: 1.54 })}>SELECTED</RNText>
                  </View>
                )}
              </Pressy>
            </FadeIn>
          );
        })}
      </ScrollView>

      <View style={{ paddingHorizontal: 20, paddingTop: 14, paddingBottom: 24 }}>
        <Pressy
          onPress={handleLock}
          scaleTo={0.96}
          style={{
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
          }}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>Lock quote · {formatINR(pickRow.priceMinor)}</RNText>
        </Pressy>
        <RNText style={tx('400', 12, t.colors.muted, { textAlign: 'center', marginTop: 10, lineHeight: 18 })}>
          Names and contacts unmask when the task starts.
        </RNText>
      </View>
    </Screen>
  );
}
