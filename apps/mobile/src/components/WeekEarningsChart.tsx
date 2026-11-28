import { useMemo, useState } from 'react';
import { View, Text as RNText, Pressable } from 'react-native';
import Svg, { Rect, Line } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { formatINR, cardSurface } from './ui';
import { tx } from './primitives';
import { hasEarnings, trimToCovered, weeklyEarnings, type LedgerLike } from '../lib/weeklyEarnings';

/**
 * "Show my earnings by week" (Ideas board): the last eight weeks of money sent to the helper, as one bar per
 * week. One series, so one hue (the mode accent: royal blue on Earn) and no legend; a single baseline rule, no
 * grid. Tapping a bar shows that week's figure; without a tap the line under the title says this week's.
 * Nothing is drawn until there is something earned, so a new helper does not see an empty chart.
 */
/** `full`: the ledger read came back at its cap, so the oldest weeks may be incomplete and are left off. */
export function WeekEarningsChart({ rows, full = false }: { rows: LedgerLike[]; full?: boolean }) {
  const t = useTheme();
  const weeks = useMemo(() => trimToCovered(weeklyEarnings(rows), rows, full), [rows, full]);
  const [picked, setPicked] = useState<number | null>(null);
  if (!hasEarnings(weeks)) return null;

  const W = 300;
  const H = 84;
  const gap = 8;
  const bw = W / weeks.length - gap;
  const max = Math.max(1, ...weeks.map((w) => w.minor));
  const shown = picked !== null ? weeks[picked]! : weeks[weeks.length - 1]!;
  const caption = picked !== null ? `Week of ${shown.label}` : 'This week';

  return (
    <View style={{ ...cardSurface(t, 16), marginTop: 16, padding: 16 }}>
      <RNText style={tx('800', 15, t.colors.ink)}>Earned each week</RNText>
      <RNText style={tx('400', 12.5, t.colors.muted, { marginTop: 3 })}>
        {caption}:{' '}
        <RNText style={tx('800', 12.5, t.colors.accentDeep, { fontVariant: ['tabular-nums'] })}>{formatINR(shown.minor)}</RNText>
        {picked === null ? ' · tap a bar for another week' : ''}
      </RNText>
      <View style={{ height: H + 4, marginTop: 14 }}>
        <Svg width="100%" height={H + 4} viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none">
          {weeks.map((w, i) => {
            const h = (w.minor / max) * H;
            const on = picked === i;
            return (
              <Rect
                key={w.start}
                x={i * (bw + gap) + gap / 2}
                y={H - h}
                width={bw}
                height={Math.max(h, w.minor > 0 ? 2 : 0)}
                rx={3}
                fill={on ? t.colors.accentDeep : t.colors.accent}
                opacity={picked === null || on ? 1 : 0.45}
              />
            );
          })}
          <Line x1={0} y1={H} x2={W} y2={H} stroke={t.colors.line} strokeWidth={1} />
        </Svg>
        {/* Tap targets over the bars, one per week. */}
        <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row' }}>
          {weeks.map((w, i) => (
            <Pressable
              key={w.start}
              onPress={() => setPicked(picked === i ? null : i)}
              accessibilityRole="button"
              accessibilityLabel={`Week of ${w.label}: ${formatINR(w.minor)} earned`}
              style={{ flex: 1 }}
            />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        <RNText style={tx('500', 11, t.colors.muted)}>{weeks.length > 1 ? weeks[0]!.label : ''}</RNText>
        <RNText style={tx('500', 11, t.colors.muted)}>This week</RNText>
      </View>
    </View>
  );
}
