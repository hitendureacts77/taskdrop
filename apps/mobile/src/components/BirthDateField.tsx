import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, ScrollView, Platform, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import { ageOn, parseBirthDate } from '@taskdrop/rules';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';

export type BirthDateParts = { day: string; month: string; year: string };

export const EMPTY_BIRTH_DATE: BirthDateParts = { day: '', month: '', year: '' };

const ROW = 50;
const ROWS = 5;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type Item = { value: string; label: string };

function days(): Item[] {
  return Array.from({ length: 31 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
}
function months(): Item[] {
  return MONTHS.map((label, i) => ({ value: String(i + 1), label }));
}
/** Newest first: most people are born in the last 20 to 40 years, so the swipe is short. */
function years(now = new Date()): Item[] {
  const top = now.getFullYear();
  return Array.from({ length: top - 1920 + 1 }, (_, i) => ({ value: String(top - i), label: String(top - i) }));
}

/**
 * One scroll wheel. Row 0 is always the column's name ("Day", "Month", "Year")
 * and means "not chosen": the wheel starts there and nothing is pre-filled, so
 * the answer stays honest. Rows 1.. are the real values.
 */
function Wheel({
  label,
  items,
  value,
  onPick,
  flex,
}: {
  label: string;
  items: Item[];
  value: string;
  onPick: (value: string) => void;
  flex: number;
}) {
  const t = useTheme();
  const ref = useRef<ScrollView>(null);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rows: Item[] = [{ value: '', label }, ...items];
  const chosen = Math.max(0, rows.findIndex((r) => r.value === value));
  const [near, setNear] = useState(chosen);

  // Follow the value when it is set from outside (a reset, or a clamped day).
  useEffect(() => {
    setNear(chosen);
    ref.current?.scrollTo({ y: chosen * ROW, animated: false });
  }, [chosen]);

  const settleAt = (y: number) => {
    const i = Math.min(rows.length - 1, Math.max(0, Math.round(y / ROW)));
    ref.current?.scrollTo({ y: i * ROW, animated: true });
    setNear(i);
    if (rows[i].value !== value) onPick(rows[i].value);
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const i = Math.min(rows.length - 1, Math.max(0, Math.round(y / ROW)));
    if (i !== near) setNear(i);
    // The web has no momentum-end event: settle shortly after the scrolling stops.
    if (Platform.OS === 'web') {
      if (settle.current) clearTimeout(settle.current);
      settle.current = setTimeout(() => settleAt(y), 140);
    }
  };

  const step = (by: number) => {
    const i = Math.min(rows.length - 1, Math.max(0, near + by));
    ref.current?.scrollTo({ y: i * ROW, animated: true });
    setNear(i);
    onPick(rows[i].value);
  };

  return (
    <View
      style={{ flex }}
      accessible
      accessibilityRole="adjustable"
      accessibilityLabel={`Birth ${label.toLowerCase()}`}
      accessibilityValue={{ text: value ? rows[chosen].label : 'not chosen' }}
      accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
      onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? -1 : 1)}
      {...(Platform.OS === 'web'
        ? ({
            tabIndex: 0,
            onKeyDown: (e: { key: string; preventDefault: () => void }) => {
              if (e.key === 'ArrowDown') (e.preventDefault(), step(1));
              if (e.key === 'ArrowUp') (e.preventDefault(), step(-1));
            },
          } as object)
        : null)}
    >
      <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, textAlign: 'center', height: 28 })}>{label.toUpperCase()}</RNText>
      <ScrollView
        ref={ref}
        style={{ height: ROW * ROWS }}
        contentContainerStyle={{ paddingVertical: ROW * 2 }}
        showsVerticalScrollIndicator={false}
        snapToInterval={ROW}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onMomentumScrollEnd={(e) => Platform.OS !== 'web' && settleAt(e.nativeEvent.contentOffset.y)}
        onScrollEndDrag={(e) => Platform.OS !== 'web' && settleAt(e.nativeEvent.contentOffset.y)}
      >
        {rows.map((r, i) => {
          const d = Math.abs(i - near);
          const size = d === 0 ? 23 : d === 1 ? 18 : 16;
          return (
            <View key={r.label} style={{ height: ROW, alignItems: 'center', justifyContent: 'center' }}>
              <RNText
                numberOfLines={1}
                style={tx(
                  d === 0 && i > 0 ? '800' : '600',
                  i === 0 ? 19 : size,
                  i === 0 ? t.colors.muted : t.colors.ink,
                  { opacity: d === 0 ? 1 : d === 1 ? 0.55 : 0.28, fontVariant: ['tabular-nums'] },
                )}
              >
                {r.label}
              </RNText>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * The birth date as three scroll wheels, in the order Indian forms use: day,
 * month, year. Nothing is chosen until each wheel has been moved, and no year
 * is pre-filled: a neutral blank is what keeps the answer honest. Once all
 * three are set a quiet line says the age, so a wrong year shows before Continue.
 */
export function BirthDateField({
  value,
  onChange,
}: {
  value: BirthDateParts;
  onChange: (v: BirthDateParts) => void;
  /** Kept for callers that submit from the keyboard; the wheels have no Enter key. */
  onSubmit?: () => void;
  /** Kept for callers; wheels have nothing to focus. */
  autoFocus?: boolean;
}) {
  const t = useTheme();
  const [dayList] = useState(days);
  const [monthList] = useState(months);
  const [yearList] = useState(() => years());
  const all = value.day && value.month && value.year;
  const birth = parseBirthDate(value.day, value.month, value.year);

  let line = 'Scroll each column to pick your date';
  if (all) line = birth ? `You are ${ageOn(birth)} years old` : 'That date does not exist. Check the day.';

  return (
    <View>
      <View
        style={{
          borderRadius: 26,
          backgroundColor: t.colors.surface2,
          paddingHorizontal: 18,
          paddingTop: 12,
          paddingBottom: 10,
        }}
      >
        <View pointerEvents="none" style={{ position: 'absolute', left: 10, right: 10, top: 12 + 28 + ROW * 2, height: ROW, borderRadius: 14, backgroundColor: t.colors.surface, borderWidth: 1, borderColor: t.colors.line }} />
        <View style={{ flexDirection: 'row', gap: 6 }}>
          <Wheel label="Day" items={dayList} value={value.day} onPick={(day) => onChange({ ...value, day })} flex={1} />
          <Wheel label="Month" items={monthList} value={value.month} onPick={(month) => onChange({ ...value, month })} flex={1.6} />
          <Wheel label="Year" items={yearList} value={value.year} onPick={(year) => onChange({ ...value, year })} flex={1.2} />
        </View>
      </View>
      <View style={{ alignItems: 'center', marginTop: 14 }}>
        <View
          style={{
            height: 30,
            borderRadius: 999,
            paddingHorizontal: 12,
            justifyContent: 'center',
            backgroundColor: birth ? t.colors.accentSoft : t.colors.surface2,
          }}
        >
          <RNText style={tx('600', 13, birth ? t.colors.accentDeep : t.colors.muted)} accessibilityLiveRegion="polite">
            {line}
          </RNText>
        </View>
      </View>
    </View>
  );
}
