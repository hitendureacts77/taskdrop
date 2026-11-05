import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { View, Text as RNText } from 'react-native';
import { ageOn, parseBirthDate } from '@taskdrop/rules';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import { clampDay, daysInMonth, days, months, years, type BirthDateItem, type BirthDateParts } from '../lib/birthDate';
import { fontFamilyFor } from '../theme';

// Same names as BirthDateField.tsx, so every importer works on both builds.
export { EMPTY_BIRTH_DATE } from '../lib/birthDate';
export type { BirthDateParts } from '../lib/birthDate';

/**
 * Web build: three real <select> dropdowns (Day / Month / Year, Instagram
 * style). A scroll wheel cannot be driven with a desktop mouse, a dropdown can
 * be clicked, typed into and used with the keyboard. Nothing is pre-chosen: the
 * first option of each dropdown is its name and means "not chosen".
 */
export function BirthDateField({
  value,
  onChange,
  onSubmit,
  autoFocus,
}: {
  value: BirthDateParts;
  onChange: (v: BirthDateParts) => void;
  /** Called when Enter is pressed on a dropdown. */
  onSubmit?: () => void;
  /** Focuses the Day dropdown on mount. */
  autoFocus?: boolean;
}) {
  const t = useTheme();
  const dayRef = useRef<HTMLSelectElement>(null);
  const [monthList] = useState(months);
  const [yearList] = useState(() => years());
  const all = value.day && value.month && value.year;
  const birth = parseBirthDate(value.day, value.month, value.year);

  useEffect(() => {
    if (autoFocus) dayRef.current?.focus();
  }, [autoFocus]);

  const dayList = days().slice(0, daysInMonth(value.month, value.year));

  let line = 'Pick your day, month and year';
  if (all) line = birth ? `You are ${ageOn(birth)} years old` : 'That date does not exist. Check the day.';

  const selectStyle = (chosen: boolean): CSSProperties => ({
    width: '100%',
    minWidth: 0,
    height: 52,
    padding: '0 12px',
    borderRadius: 14,
    border: `1.5px solid ${t.colors.line}`,
    backgroundColor: t.colors.surface,
    color: chosen ? t.colors.ink : t.colors.muted,
    fontFamily: `${fontFamilyFor('600')}, system-ui, sans-serif`,
    fontSize: 16,
    cursor: 'pointer',
    colorScheme: t.isDark ? 'dark' : 'light',
  });

  const onKeyDown = (e: { key: string }) => {
    if (e.key === 'Enter' && onSubmit) onSubmit();
  };

  const field = (
    name: 'Day' | 'Month' | 'Year',
    items: BirthDateItem[],
    current: string,
    pick: (v: string) => void,
    flex: number,
    ref?: React.Ref<HTMLSelectElement>,
  ) => (
    <View style={{ flex }}>
      <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, textAlign: 'center', height: 24 })}>{name.toUpperCase()}</RNText>
      <select
        ref={ref}
        aria-label={`Birth ${name.toLowerCase()}`}
        value={current}
        onChange={(e) => pick(e.target.value)}
        onKeyDown={onKeyDown}
        style={selectStyle(!!current)}
      >
        <option value="">{name}</option>
        {items.map((it) => (
          <option key={it.value} value={it.value}>
            {it.label}
          </option>
        ))}
      </select>
    </View>
  );

  return (
    <View>
      <View
        style={{
          borderRadius: 26,
          backgroundColor: t.colors.surface2,
          paddingHorizontal: 18,
          paddingTop: 12,
          paddingBottom: 18,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {field('Day', dayList, value.day, (day) => onChange({ ...value, day }), 1, dayRef)}
          {field('Month', monthList, value.month, (month) => onChange({ ...value, month, day: clampDay(value.day, month, value.year) }), 1.6)}
          {field('Year', yearList, value.year, (year) => onChange({ ...value, year, day: clampDay(value.day, value.month, year) }), 1.2)}
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
