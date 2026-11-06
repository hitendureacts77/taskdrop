import { useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, Platform, type NativeScrollEvent, type NativeSyntheticEvent, type ScrollViewInstance } from 'react-native';
import { ageOn, parseBirthDate } from '@taskdrop/rules';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import { days, months, years, type BirthDateItem, type BirthDateParts } from '../lib/birthDate';

// Re-exported so every existing importer keeps working. The web build loads
// BirthDateField.web.tsx instead (three native dropdowns).
export { EMPTY_BIRTH_DATE } from '../lib/birthDate';
export type { BirthDateParts } from '../lib/birthDate';

const ROW = 50;
const ROWS = 5;

type Item = BirthDateItem;

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
  const ref = useRef<ScrollViewInstance>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Where the wheel is right now, and whether a finger is on it.
  const offset = useRef(0);
  const dragging = useRef(false);
  // The row this wheel went to by itself, so only a change from outside moves it again.
  const landed = useRef(-1);
  const rows: Item[] = [{ value: '', label }, ...items];
  const chosen = Math.max(0, rows.findIndex((r) => r.value === value));
  const [near, setNear] = useState(chosen);

  // Follow the value when it is set from outside (a reset, or a clamped day).
  useEffect(() => {
    if (landed.current === chosen) return;
    setNear(chosen);
    ref.current?.scrollTo({ y: chosen * ROW, animated: false });
  }, [chosen]);

  useEffect(
    () => () => {
      if (settleTimer.current) clearTimeout(settleTimer.current);
    },
    [],
  );

  const rowAt = (y: number) => Math.min(rows.length - 1, Math.max(0, Math.round(y / ROW)));

  const goTo = (i: number) => {
    landed.current = i;
    ref.current?.scrollTo({ y: i * ROW, animated: true });
    setNear(i);
    if (rows[i].value !== value) onPick(rows[i].value);
  };

  // Only once the wheel has stopped. A finger back on it means it is not over yet.
  const settle = () => {
    if (!dragging.current) goTo(rowAt(offset.current));
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offset.current = e.nativeEvent.contentOffset.y;
    const i = rowAt(offset.current);
    if (i !== near) setNear(i);
  };

  const step = (by: number) => goTo(Math.min(rows.length - 1, Math.max(0, near + by)));

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
        // Every screen with these wheels scrolls too. Without this Android gives
        // the swipe to the page and the wheel never moves.
        nestedScrollEnabled
        overScrollMode="never"
        snapToInterval={ROW}
        decelerationRate="fast"
        scrollEventThrottle={16}
        onScroll={onScroll}
        onScrollBeginDrag={() => {
          dragging.current = true;
          if (settleTimer.current) clearTimeout(settleTimer.current);
        }}
        onScrollEndDrag={() => {
          dragging.current = false;
          // A flick carries on after the finger lifts, and landing here would stop it dead.
          // Give the fling a moment to start; iOS sends no fling event for a slow lift.
          settleTimer.current = setTimeout(settle, 120);
        }}
        onMomentumScrollBegin={() => {
          if (settleTimer.current) clearTimeout(settleTimer.current);
        }}
        onMomentumScrollEnd={settle}
      >
        {rows.map((r, i) => {
          const d = Math.abs(i - near);
          const size = d === 0 ? 23 : d === 1 ? 18 : 16;
          return (
            // A tap on a row picks it too, for anyone who finds the wheel fiddly.
            <Pressable key={r.label} onPress={() => goTo(i)} style={{ height: ROW, alignItems: 'center', justifyContent: 'center' }}>
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
            </Pressable>
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
  // Two wheels can land before the screen redraws. Each must build on what the
  // other just picked, or the second overwrites the first and that wheel jumps back.
  const latest = useRef(value);
  latest.current = value;
  const pick = (part: Partial<BirthDateParts>) => {
    latest.current = { ...latest.current, ...part };
    onChange(latest.current);
  };

  let line = 'Swipe each column, or tap a row';
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
          <Wheel label="Day" items={dayList} value={value.day} onPick={(day) => pick({ day })} flex={1} />
          <Wheel label="Month" items={monthList} value={value.month} onPick={(month) => pick({ month })} flex={1.6} />
          <Wheel label="Year" items={yearList} value={value.year} onPick={(year) => pick({ year })} flex={1.2} />
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
