import { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView } from 'react-native';
import { BottomSheet } from './kit';
import { Icon } from './Icon';
import { tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';

/**
 * One simple dropdown: a labelled box that shows the choice, tap to pick from
 * a short list. Phone build (a bottom sheet); SelectField.web.tsx is the same
 * box with a real <select>, so a desktop mouse and keyboard work.
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
  const [open, setOpen] = useState(false);
  return (
    <View style={style}>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={label ? `${label}: ${value || placeholder}` : value || placeholder}
        style={{
          backgroundColor: t.colors.surface,
          borderRadius: 14,
          borderWidth: 1.5,
          borderColor: t.colors.line,
          paddingVertical: label ? 11 : 14,
          paddingHorizontal: 14,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <View style={{ flex: 1 }}>
          {label ? (
            <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1, marginBottom: 5 })}>{label.toUpperCase()}</RNText>
          ) : null}
          <RNText style={tx('500', 15, value ? t.colors.ink : t.colors.muted)} numberOfLines={1}>
            {value || placeholder}
          </RNText>
        </View>
        <View style={{ transform: [{ rotate: '90deg' }] }}>
          <Icon name="chevronRight" size={18} color={t.colors.muted} />
        </View>
      </Pressable>
      <BottomSheet visible={open} onClose={() => setOpen(false)} title={label ?? placeholder} maxHeight="70%">
        <ScrollView keyboardShouldPersistTaps="handled">
          {options.map((o) => (
            <Pressable
              key={o}
              onPress={() => {
                onChange(o);
                setOpen(false);
              }}
              accessibilityRole="button"
              style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14, gap: 10 }}
            >
              <RNText style={tx(o === value ? '700' : '500', 15, o === value ? t.colors.accentDeep : t.colors.ink, { flex: 1 })}>{o}</RNText>
              {o === value ? <Icon name="check" size={18} color={t.colors.accentDeep} /> : null}
            </Pressable>
          ))}
        </ScrollView>
      </BottomSheet>
    </View>
  );
}
