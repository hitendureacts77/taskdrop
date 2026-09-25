import { useState } from 'react';
import { TextInput, type TextStyle, type StyleProp } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';

/**
 * A rupee amount the user can either step with +/− or type directly.
 *
 * While focused it shows raw digits so the keypad is easy to use; when blurred
 * it reformats to "₹1,200". Works in whole rupees — callers holding paise should
 * convert at the boundary.
 *
 * `rupees` may be null for "not set yet", which renders the placeholder instead
 * of a number. A screen that pre-fills an amount is deciding for the user, so
 * the amount they publish should start empty.
 */
export function AmountField({
  rupees,
  onChangeRupees,
  style,
  min = 0,
  align = 'center',
  placeholder = '₹0',
}: {
  rupees: number | null;
  onChangeRupees: (next: number | null) => void;
  style?: StyleProp<TextStyle>;
  min?: number;
  align?: TextStyle['textAlign'];
  placeholder?: string;
}) {
  const t = useTheme();
  const [draft, setDraft] = useState<string | null>(null);

  const display = draft ?? (rupees === null ? '' : `₹${rupees.toLocaleString('en-IN')}`);

  return (
    <TextInput
      value={display}
      onFocus={() => setDraft(rupees === null ? '' : String(rupees))}
      onChangeText={(text) => {
        const digits = text.replace(/[^0-9]/g, '').slice(0, 10);
        setDraft(digits);
        onChangeRupees(digits === '' ? null : Number(digits));
      }}
      onBlur={() => {
        setDraft(null);
        // Only enforce the floor on an amount the user actually entered;
        // clamping an empty field would silently invent a value.
        if (rupees !== null && rupees < min) onChangeRupees(min);
      }}
      keyboardType="number-pad"
      inputMode="numeric"
      selectTextOnFocus
      placeholder={placeholder}
      style={[{ padding: 0, textAlign: align, color: t.colors.ink }, style]}
      placeholderTextColor={t.colors.muted}
    />
  );
}
