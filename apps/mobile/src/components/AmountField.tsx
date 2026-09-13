import React, { useState } from 'react';
import { TextInput, type TextStyle, type StyleProp } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';

/**
 * A rupee amount the user can either step with +/− or type directly.
 *
 * While focused it shows raw digits so the keypad is easy to use; when blurred
 * it reformats to "₹1,200". Works in whole rupees — callers holding paise should
 * convert at the boundary.
 */
export function AmountField({
  rupees,
  onChangeRupees,
  style,
  min = 0,
  align = 'center',
}: {
  rupees: number;
  onChangeRupees: (next: number) => void;
  style?: StyleProp<TextStyle>;
  min?: number;
  align?: TextStyle['textAlign'];
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<string | null>(null);

  const display = draft ?? `₹${rupees.toLocaleString('en-IN')}`;

  return (
    <TextInput
      value={display}
      onFocus={() => setDraft(String(rupees))}
      onChangeText={(text) => {
        const digits = text.replace(/[^0-9]/g, '');
        setDraft(digits);
        onChangeRupees(digits === '' ? 0 : Number(digits));
      }}
      onBlur={() => {
        setDraft(null);
        if (rupees < min) onChangeRupees(min);
      }}
      keyboardType="number-pad"
      inputMode="numeric"
      selectTextOnFocus
      style={[{ padding: 0, textAlign: align, color: t.colors.ink }, style]}
      placeholderTextColor={t.colors.muted}
    />
  );
}
