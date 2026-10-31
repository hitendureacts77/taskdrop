import { useState } from 'react';
import { View, Text as RNText, Pressable, TextInput, ScrollView, Platform } from 'react-native';
import { CATEGORIES, TOP_CATEGORIES } from '../lib/taskBrief';
import { useTheme } from '../providers/ThemeProvider';
import { BottomSheet } from './kit';
import { Icon } from './Icon';
import { tx } from './primitives';

/**
 * The category on the post check: six chips (the picked one always among them)
 * and a dashed chip that opens a search over all of them.
 */
export function CategoryPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const t = useTheme();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const chips: string[] = TOP_CATEGORIES.includes(value as (typeof TOP_CATEGORIES)[number])
    ? [...TOP_CATEGORIES]
    : [value, ...TOP_CATEGORIES];
  const needle = q.trim().toLowerCase();
  const results = CATEGORIES.filter((c) => c.toLowerCase().includes(needle));

  const close = () => {
    setOpen(false);
    setQ('');
  };
  const pick = (c: string) => {
    onChange(c);
    close();
  };

  /** The matched letters in bold, so it is clear why a row is listed. */
  const marked = (c: string) => {
    const i = needle ? c.toLowerCase().indexOf(needle) : -1;
    if (i < 0) return <RNText style={tx('600', 16, t.colors.ink)}>{c}</RNText>;
    return (
      <RNText style={tx('600', 16, t.colors.ink)}>
        {c.slice(0, i)}
        <RNText style={tx('800', 16, t.colors.accentDeep, { backgroundColor: t.colors.accentSoft })}>{c.slice(i, i + needle.length)}</RNText>
        {c.slice(i + needle.length)}
      </RNText>
    );
  };

  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {chips.map((c) => {
          const on = value === c;
          return (
            <Pressable
              key={c}
              onPress={() => onChange(c)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={c}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                height: 36,
                paddingHorizontal: 14,
                borderRadius: 999,
                borderWidth: 1.5,
                borderColor: on ? t.colors.accent : t.colors.line,
                backgroundColor: on ? t.colors.accentSoft : t.colors.surface,
                transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
              })}
            >
              {on ? <Icon name="check" size={14} color={t.colors.accentDeep} strokeWidth={2.6} /> : null}
              <RNText style={tx(on ? '700' : '600', 13.5, on ? t.colors.accentDeep : t.colors.text)}>{c}</RNText>
            </Pressable>
          );
        })}
        <Pressable
          onPress={() => setOpen(true)}
          accessibilityRole="button"
          accessibilityLabel={`Search all ${CATEGORIES.length} categories`}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            height: 36,
            paddingHorizontal: 14,
            borderRadius: 999,
            borderWidth: 1.5,
            borderStyle: 'dashed',
            borderColor: t.colors.accentBorder,
            transform: [{ scale: pressed ? t.motion.pressScale : 1 }],
          })}
        >
          <Icon name="search" size={14} color={t.colors.accentDeep} strokeWidth={2.2} />
          <RNText style={tx('700', 13.5, t.colors.accentDeep)}>Search all {CATEGORIES.length}</RNText>
        </Pressable>
      </View>

      <BottomSheet visible={open} onClose={close} title="All categories">
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
            height: 48,
            paddingHorizontal: 14,
            borderRadius: 14,
            borderWidth: 1.5,
            borderColor: t.colors.accent,
            backgroundColor: t.colors.surface,
          }}
        >
          <Icon name="search" size={18} color={t.colors.muted} />
          <TextInput
            value={q}
            onChangeText={setQ}
            autoFocus
            placeholder="Search categories"
            placeholderTextColor={t.colors.muted}
            accessibilityLabel="Search categories"
            style={tx('500', 16, t.colors.ink, { flex: 1, padding: 0, ...(Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null) })}
          />
        </View>
        <RNText style={tx('700', 11, t.colors.muted, { letterSpacing: 1.2, marginTop: 14, marginBottom: 4 })}>
          {needle ? `${results.length} OF ${CATEGORIES.length} MATCH` : `ALL ${CATEGORIES.length}`}
        </RNText>
        <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
          {results.length === 0 ? (
            <RNText style={tx('400', 14, t.colors.muted, { paddingVertical: 14 })}>No category matches. “Other” is always there.</RNText>
          ) : (
            results.map((c) => (
              <Pressable
                key={c}
                onPress={() => pick(c)}
                accessibilityRole="button"
                accessibilityState={{ selected: value === c }}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 48, opacity: pressed ? 0.6 : 1 })}
              >
                <View style={{ flex: 1 }}>{marked(c)}</View>
                {value === c ? <Icon name="check" size={18} color={t.colors.accentDeep} strokeWidth={2.6} /> : null}
              </Pressable>
            ))
          )}
        </ScrollView>
      </BottomSheet>
    </>
  );
}
