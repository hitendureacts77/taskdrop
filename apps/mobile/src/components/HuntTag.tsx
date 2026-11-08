import { useEffect, useState } from 'react';
import { View, Text as RNText } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { rupees } from './kit';
import { tx } from './primitives';
import { huntTimeLeft } from '../lib/hunt';

/** Ticks once a minute, so "1 h 12 m left" stays true on screen. */
export function useMinute(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

/** City Hunt (D19) on an Earn card: "HUNT · REWARD ₹300" in gold, and the time left to find it. */
export function HuntTag({ task }: { task: { benchmark_minor: number; hunt_until: string | null } }) {
  const t = useTheme();
  const now = useMinute();
  const left = huntTimeLeft(task.hunt_until, now);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
      <View style={{ backgroundColor: t.colors.goldSoft, borderRadius: 6, paddingHorizontal: 7, paddingVertical: 3 }}>
        <RNText style={tx('800', 10.5, t.colors.goldInk, { letterSpacing: 0.8 })}>
          HUNT · REWARD {rupees(task.benchmark_minor / 100)}
        </RNText>
      </View>
      {left ? <RNText style={tx('700', 12, t.colors.signalDeep)}>{left}</RNText> : null}
    </View>
  );
}
