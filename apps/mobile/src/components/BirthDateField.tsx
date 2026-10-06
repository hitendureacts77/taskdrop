import { useRef, useState } from 'react';
import { View, Text as RNText, TextInput } from 'react-native';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';

export type BirthDateParts = { day: string; month: string; year: string };

export const EMPTY_BIRTH_DATE: BirthDateParts = { day: '', month: '', year: '' };

/**
 * Day / month / year as three small boxes, in the order Indian forms use.
 * No picker and no year pre-filled: a neutral blank is what keeps the answer
 * honest, and typing a year is quicker than scrolling to it. Focus moves on as
 * each box fills.
 */
export function BirthDateField({
  value,
  onChange,
  onSubmit,
  autoFocus,
}: {
  value: BirthDateParts;
  onChange: (v: BirthDateParts) => void;
  onSubmit?: () => void;
  autoFocus?: boolean;
}) {
  const t = useTheme();
  const monthRef = useRef<TextInput>(null);
  const yearRef = useRef<TextInput>(null);
  const [focused, setFocused] = useState<keyof BirthDateParts | null>(null);

  const box = (
    key: keyof BirthDateParts,
    label: string,
    placeholder: string,
    max: number,
    next?: React.RefObject<TextInput | null>,
    ref?: React.RefObject<TextInput | null>,
  ) => (
    <View style={{ flex: key === 'year' ? 1.5 : 1 }}>
      <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2 })}>{label}</RNText>
      <TextInput
        ref={ref}
        value={value[key]}
        onChangeText={(v) => {
          const digits = v.replace(/[^0-9]/g, '').slice(0, max);
          onChange({ ...value, [key]: digits });
          if (digits.length === max) next?.current?.focus();
        }}
        onFocus={() => setFocused(key)}
        onBlur={() => setFocused(null)}
        onSubmitEditing={key === 'year' ? onSubmit : () => next?.current?.focus()}
        returnKeyType={key === 'year' ? 'done' : 'next'}
        autoFocus={autoFocus && key === 'day'}
        placeholder={placeholder}
        placeholderTextColor={t.colors.muted}
        keyboardType="number-pad"
        inputMode="numeric"
        maxLength={max}
        accessibilityLabel={`Birth ${label.toLowerCase()}`}
        style={tx('700', 22, t.colors.ink, {
          marginTop: 8,
          paddingVertical: 12,
          paddingHorizontal: 14,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: focused === key ? t.colors.accent : t.colors.line,
          backgroundColor: t.colors.surface,
          textAlign: 'center',
          letterSpacing: 1,
        })}
      />
    </View>
  );

  return (
    <View style={{ flexDirection: 'row', gap: 10 }}>
      {box('day', 'DAY', 'DD', 2, monthRef)}
      {box('month', 'MONTH', 'MM', 2, yearRef, monthRef)}
      {box('year', 'YEAR', 'YYYY', 4, undefined, yearRef)}
    </View>
  );
}
