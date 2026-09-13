import React, { useState } from 'react';
import { View, Text as RNText, Pressable, ScrollView, TextInput, type TextStyle } from 'react-native';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode, type Mode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { fontFamilyFor } from '../theme';

/**
 * Profile setup — pixel parity with docs/design/_design_markup.html lines
 * 561-595. Skills only show in worker mode (the design's setupWorker gate) and
 * are capped at 5 picks, per _design_source.jsx lines 573-579.
 */

function tx(weight: string, size: number, color: string, extra?: TextStyle): TextStyle {
  return { fontFamily: fontFamilyFor(weight), fontSize: size, color, ...extra };
}

const SKILLS = ['Sourcing', 'Local intel', 'Carpentry', 'Delivery', 'Repairs', 'Photography', 'Research', 'Errands'];

const START_MODES: { key: Mode; label: string; sub: string }[] = [
  { key: 'poster', label: 'Post a Request', sub: 'Ask for something' },
  { key: 'worker', label: 'Find Work', sub: 'Browse and quote' },
];

export function SetupScreen() {
  const t = useTheme();
  const { reset, back } = useNav();
  const { mode, setMode } = useMode();
  const { celebrate } = useApp();
  const [skills, setSkills] = useState<number[]>([0, 1, 4]);
  const [name, setName] = useState('Narasimha Raju');
  const [place, setPlace] = useState('Indiranagar, Bengaluru');

  const worker = mode === 'worker';

  const toggleSkill = (i: number) =>
    setSkills((prev) =>
      prev.includes(i) ? prev.filter((x) => x !== i) : prev.length >= 5 ? prev : [...prev, i],
    );

  const finish = () => {
    reset('home');
    celebrate('Welcome to TaskDrop');
  };

  const label = (s: string, extra?: TextStyle) => (
    <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, ...extra })}>{s}</RNText>
  );

  return (
    <Screen padded={false}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 8, paddingBottom: 26 }}
        showsVerticalScrollIndicator={false}
      >
        <Pressable onPress={back} hitSlop={10}>
          <RNText style={tx('400', 20, t.colors.ink)}>←</RNText>
        </Pressable>

        <RNText style={tx('800', 25, t.colors.ink, { letterSpacing: -0.75, marginTop: 20 })}>
          Set up your profile
        </RNText>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 20 }}>
          <View
            style={{
              width: 64,
              height: 64,
              borderRadius: 999,
              backgroundColor: t.colors.surface2,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: t.colors.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('400', 20, t.colors.muted)}>+</RNText>
          </View>
          <View>
            <RNText style={tx('700', 15, t.colors.ink)}>Add a photo</RNText>
            <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>
              Profiles with photos get 3× more quotes
            </RNText>
          </View>
        </View>

        {label('DISPLAY NAME', { marginTop: 22 })}
        <View
          style={{
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 16,
            marginTop: 10,
          }}
        >
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={t.colors.muted}
            style={tx('400', 15, t.colors.ink, { padding: 0 })}
          />
        </View>

        {label('LOCATION', { marginTop: 20 })}
        <View
          style={{
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            paddingVertical: 14,
            paddingHorizontal: 16,
            marginTop: 10,
            flexDirection: 'row',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <TextInput
            value={place}
            onChangeText={setPlace}
            placeholder="Where are you based?"
            placeholderTextColor={t.colors.muted}
            style={tx('400', 15, t.colors.ink, { flex: 1, padding: 0 })}
          />
          <RNText style={tx('600', 13, t.colors.accentDeep)}>Change</RNText>
        </View>

        {worker && (
          <>
            {label('SKILLS · PICK UP TO 5', { marginTop: 20 })}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 11 }}>
              {SKILLS.map((s, i) => {
                const on = skills.includes(i);
                return (
                  <Pressable
                    key={s}
                    onPress={() => toggleSkill(i)}
                    style={({ pressed }) => ({
                      borderRadius: 999,
                      paddingVertical: 9,
                      paddingHorizontal: 15,
                      backgroundColor: on ? t.colors.accentSoft : 'transparent',
                      borderWidth: 1,
                      borderColor: on ? t.colors.accent : t.colors.line,
                      transform: [{ scale: pressed ? 0.96 : 1 }],
                    })}
                  >
                    <RNText style={tx('600', 13, on ? t.colors.ink : t.colors.muted)}>{s}</RNText>
                  </Pressable>
                );
              })}
            </View>
          </>
        )}

        {label('START IN', { marginTop: 22 })}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 11 }}>
          {START_MODES.map((m) => {
            const on = mode === m.key;
            return (
              <Pressable
                key={m.key}
                onPress={() => setMode(m.key)}
                style={({ pressed }) => ({
                  flex: 1,
                  borderRadius: 12,
                  padding: 15,
                  backgroundColor: on ? t.colors.accentSoft : t.colors.surface2,
                  borderWidth: 1,
                  borderColor: on ? t.colors.accent : t.colors.line,
                  transform: [{ scale: pressed ? 0.985 : 1 }],
                })}
              >
                <RNText style={tx('700', 15, on ? t.colors.ink : t.colors.muted)}>{m.label}</RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 5 })}>{m.sub}</RNText>
              </Pressable>
            );
          })}
        </View>

        <Pressable
          onPress={finish}
          style={({ pressed }) => ({
            marginTop: 24,
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.35,
            shadowRadius: 22,
            shadowOffset: { width: 0, height: 8 },
            elevation: 6,
            transform: [{ scale: pressed ? 0.96 : 1 }],
          })}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>Finish setup</RNText>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}
