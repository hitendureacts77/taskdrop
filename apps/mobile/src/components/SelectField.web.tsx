import { useState, type CSSProperties } from 'react';
import { View, Text as RNText } from 'react-native';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import { fontFamilyFor } from '../theme';

/**
 * Web build of SelectField: the same labelled box, with a real <select> inside
 * so it can be clicked, typed into (jump to "Te..." for Telugu) and used with
 * the keyboard.
 */
export function SelectField({
  label,
  value,
  options,
  onChange,
  placeholder = 'Choose',
  style,
}: {
  label?: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  placeholder?: string;
  style?: object;
}) {
  const t = useTheme();
  const [focused, setFocused] = useState(false);
  const select: CSSProperties = {
    width: '100%',
    border: 'none',
    outline: 'none',
    background: 'transparent',
    padding: 0,
    margin: 0,
    height: 24,
    color: value ? t.colors.ink : t.colors.muted,
    fontFamily: `${fontFamilyFor('500')}, system-ui, sans-serif`,
    fontSize: 15,
    cursor: 'pointer',
    colorScheme: t.isDark ? 'dark' : 'light',
  };
  return (
    <View style={style}>
      <View
        style={{
          backgroundColor: t.colors.surface,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: focused ? t.colors.accent : t.colors.line,
          paddingVertical: label ? 11 : 14,
          paddingHorizontal: 14,
          ...(focused ? ({ boxShadow: `0 0 0 4px ${t.colors.accentSoft}` } as object) : null),
        }}
      >
        {label ? (
          <RNText style={tx('700', 11, focused ? t.colors.accentDeep : t.colors.muted, { letterSpacing: 1, marginBottom: 5 })}>
            {label.toUpperCase()}
          </RNText>
        ) : null}
        <select
          aria-label={label ?? placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={select}
        >
          <option value="">{placeholder}</option>
          {options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      </View>
    </View>
  );
}
