import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { rupees } from './kit';
import { tx } from './primitives';

export type MoneyBar = {
  /** Short label under the bar: "Wk 2", "Sep". */
  label: string;
  /** Longer label for the selected bar: "8 – 14 Sep", "September 2026". */
  range: string;
  /** Whole rupees. */
  value: number;
};

const H = 140;

/** "₹1.2k", "₹950" -- short enough for an axis. */
function short(n: number): string {
  if (n >= 100000) return `₹${(n / 100000).toFixed(n >= 1000000 ? 0 : 1)}L`;
  if (n >= 1000) return `₹${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(n)}`;
}

/** A round top for the axis: 1, 2 or 5 times a power of ten. */
function niceMax(n: number): number {
  if (n <= 0) return 100;
  const p = Math.pow(10, Math.floor(Math.log10(n)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= n) return m * p;
  return 10 * p;
}

/**
 * Money over time as bars: one per week or month, rounded, growing in on
 * first show. The best period is drawn solid, the rest softer; a dashed line
 * marks the average. Tap a bar for its amount and dates.
 */
export function MoneyBars({ bars, color, verb }: { bars: MoneyBar[]; color: string; verb: 'earned' | 'spent' }) {
  const t = useTheme();
  const max = niceMax(Math.max(0, ...bars.map((b) => b.value)));
  const best = bars.reduce((bi, b, i) => (b.value > (bars[bi]?.value ?? 0) ? i : bi), 0);
  const nonZero = bars.filter((b) => b.value > 0);
  const avg = nonZero.length ? nonZero.reduce((n, b) => n + b.value, 0) / nonZero.length : 0;
  const [picked, setPicked] = useState<number | null>(null);
  const grow = useRef(new Animated.Value(0)).current;

  const key = bars.map((b) => b.value).join(',');
  useEffect(() => {
    grow.setValue(0);
    setPicked(null);
    Animated.timing(grow, { toValue: 1, duration: 520, useNativeDriver: false }).start();
  }, [key, grow]);

  const sel = picked !== null ? bars[picked] : bars[best];
  const selIndex = picked ?? best;

  return (
    <View>
      {/* The bar in focus: the tapped one, or the best one. */}
      {sel ? (
        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
          <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>{rupees(sel.value)}</RNText>
          <RNText style={tx('500', 12, t.colors.muted)}>
            {verb} · {sel.range}
            {picked === null && sel.value > 0 ? ' · best' : ''}
          </RNText>
        </View>
      ) : null}

      <View style={{ height: H, flexDirection: 'row' }}>
        {/* Gridlines with their amounts. */}
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} pointerEvents="none">
          {[1, 0.5, 0].map((f) => (
            <View key={f} style={{ position: 'absolute', left: 0, right: 0, top: (1 - f) * (H - 1) }}>
              <View style={{ borderTopWidth: 1, borderColor: t.colors.line, borderStyle: f === 0 ? 'solid' : 'dashed', marginRight: 40 }} />
              <RNText style={tx('500', 10, t.colors.muted, { position: 'absolute', right: 0, top: -7 })}>
                {short(max * f)}
              </RNText>
            </View>
          ))}
          {avg > 0 ? (
            <View style={{ position: 'absolute', left: 0, right: 40, top: (1 - avg / max) * (H - 1) }}>
              <View style={{ borderTopWidth: 1.5, borderColor: color, borderStyle: 'dashed', opacity: 0.55 }} />
            </View>
          ) : null}
        </View>

        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 8, marginRight: 46 }}>
          {bars.map((b, i) => {
            const h = b.value > 0 ? Math.max(4, (b.value / max) * (H - 2)) : 2;
            const on = i === selIndex;
            return (
              <Pressable
                key={b.label + i}
                onPress={() => setPicked(i === picked ? null : i)}
                accessibilityRole="button"
                accessibilityLabel={`${b.range}: ${rupees(b.value)} ${verb}`}
                style={{ flex: 1, height: H, justifyContent: 'flex-end' }}
              >
                <Animated.View
                  style={{
                    height: grow.interpolate({ inputRange: [0, 1], outputRange: [2, h] }),
                    borderTopLeftRadius: 7,
                    borderTopRightRadius: 7,
                    borderBottomLeftRadius: 2,
                    borderBottomRightRadius: 2,
                    backgroundColor: b.value > 0 ? color : t.colors.line,
                    opacity: b.value === 0 ? 1 : on ? 1 : 0.38,
                  }}
                />
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ flexDirection: 'row', gap: 8, marginRight: 46, marginTop: 8 }}>
        {bars.map((b, i) => (
          <RNText
            key={b.label + i}
            style={tx(i === selIndex ? '700' : '500', 10, i === selIndex ? t.colors.ink : t.colors.muted, { flex: 1, textAlign: 'center' })}
            numberOfLines={1}
          >
            {b.label}
          </RNText>
        ))}
      </View>
      {avg > 0 ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 }}>
          <View style={{ width: 14, borderTopWidth: 1.5, borderColor: color, borderStyle: 'dashed', opacity: 0.7 }} />
          <RNText style={tx('500', 11, t.colors.muted)}>
            Average {rupees(Math.round(avg))} {verb} per active {bars.length > 5 ? 'month' : 'week'}
          </RNText>
        </View>
      ) : null}
    </View>
  );
}
