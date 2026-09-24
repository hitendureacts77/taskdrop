import { useState } from 'react';
import { View, Text as RNText } from 'react-native';
import Svg, { Path, Line, Circle } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { rupees } from './kit';
import { tx } from './primitives';

export type FlowPoint = { label: string; income: number; expense: number };

const H = 150;
const PAD_L = 6;
const PAD_R = 6;

/**
 * Money in against money out, per bucket, as two smoothed lines with a soft
 * fill -- the shape of the "Money flow" card. Values are whole rupees.
 * Tapping a column shows its two figures.
 */
export function MoneyFlowChart({ points }: { points: FlowPoint[] }) {
  const t = useTheme();
  const [w, setW] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const max = Math.max(1, ...points.flatMap((p) => [p.income, p.expense]));
  const n = points.length;
  const x = (i: number) => (n <= 1 ? w / 2 : PAD_L + (i * (w - PAD_L - PAD_R)) / (n - 1));
  const y = (v: number) => H - 8 - (v / max) * (H - 24);

  const line = (key: 'income' | 'expense') => {
    if (n === 0 || w === 0) return '';
    let d = `M ${x(0)} ${y(points[0]![key])}`;
    for (let i = 1; i < n; i++) {
      const x0 = x(i - 1);
      const x1 = x(i);
      const cx = (x0 + x1) / 2;
      d += ` C ${cx} ${y(points[i - 1]![key])}, ${cx} ${y(points[i]![key])}, ${x1} ${y(points[i]![key])}`;
    }
    return d;
  };
  const area = (key: 'income' | 'expense') => {
    const d = line(key);
    return d ? `${d} L ${x(n - 1)} ${H} L ${x(0)} ${H} Z` : '';
  };

  const income = t.colors.accent;
  const expense = t.colors.signal;
  const sel = picked !== null ? points[picked] : null;

  return (
    <View>
      <View
        style={{ height: H }}
        onLayout={(e) => setW(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onResponderRelease={(e) => {
          if (n === 0 || w === 0) return;
          const lx = e.nativeEvent.locationX;
          const i = Math.round(((lx - PAD_L) / Math.max(1, w - PAD_L - PAD_R)) * (n - 1));
          setPicked(Math.max(0, Math.min(n - 1, i)));
        }}
      >
        {w > 0 ? (
          <Svg width={w} height={H}>
            {[0.25, 0.5, 0.75].map((f) => (
              <Line key={f} x1={0} x2={w} y1={H * f} y2={H * f} stroke={t.colors.line} strokeWidth={1} strokeDasharray="3 4" />
            ))}
            <Path d={area('income')} fill={income} opacity={0.12} />
            <Path d={area('expense')} fill={expense} opacity={0.1} />
            <Path d={line('income')} stroke={income} strokeWidth={2.4} fill="none" />
            <Path d={line('expense')} stroke={expense} strokeWidth={2.4} fill="none" />
            {picked !== null && sel ? (
              <>
                <Line x1={x(picked)} x2={x(picked)} y1={0} y2={H} stroke={t.colors.muted} strokeWidth={1} />
                <Circle cx={x(picked)} cy={y(sel.income)} r={4} fill={income} />
                <Circle cx={x(picked)} cy={y(sel.expense)} r={4} fill={expense} />
              </>
            ) : null}
          </Svg>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
        {points.map((p, i) =>
          i === 0 || i === n - 1 || i === Math.floor(n / 2) ? (
            <RNText key={p.label + i} style={tx('400', 10, t.colors.muted)}>{p.label}</RNText>
          ) : null,
        )}
      </View>
      {sel ? (
        <RNText style={tx('600', 12, t.colors.ink, { marginTop: 8 })}>
          {sel.label}: <RNText style={{ color: income }}>in {rupees(sel.income)}</RNText> ·{' '}
          <RNText style={{ color: expense }}>out {rupees(sel.expense)}</RNText>
        </RNText>
      ) : null}
    </View>
  );
}
