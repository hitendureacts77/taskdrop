import { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  TextInput,
  Pressable,
  Animated,
  Easing,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { Screen } from '../components/ui';
import { Icon } from '../components/Icon';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { useMode } from '../providers/ModeProvider';
import { useApp } from '../providers/AppStateProvider';
import { searchTasks } from '../data/api';
import { fontFamilyFor, type Theme } from '../theme';
import type { Enums } from '@taskdrop/db-types';
import { FadeIn, Pressy, tx } from '../components/primitives';

/**
 * Search screen — pixel parity with docs/design/_design_markup.html lines
 * 140-203 (search field, location row, radius/budget toggles + reveals,
 * pillar chips, saved searches, "Show N tasks" CTA). Data/handlers mirror
 * docs/design/_design_source.jsx renderVals() lines 290-312.
 */

const FILTER_LABELS = ['Services', 'Goods & products', 'Local help'];
// Chip index -> the pillar enum stored on tasks.
const FILTER_PILLARS: Enums<'pillar'>[] = ['services', 'procurement', 'local_intel'];

const BUDGET_MIN_MINOR = 50000; // ₹500
const BUDGET_MAX_MINOR = 800000; // ₹8,000

const SAVED_SEARCHES = [
  { title: 'Camera gear under ₹6k', meta: 'Products · 12 km · 4 new' },
  { title: 'Weekend moving jobs', meta: 'Services · 8 km · 2 new' },
  { title: 'Local intel, Indiranagar', meta: 'Local Intel · 3 km · no new' },
];

const SWITCH_WIDTH = 42;
const SWITCH_HEIGHT = 24;
const KNOB_SIZE = 18;
const KNOB_TRAVEL = SWITCH_WIDTH - KNOB_SIZE - 6; // padding 3px each side

function FilterChip({
  label,
  active,
  onPress,
  t,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  t: Theme;
}) {
  return (
    <Pressy
      onPress={onPress}
      scaleTo={0.96}
      style={{
        backgroundColor: active ? t.colors.accentSoft : 'transparent',
        borderWidth: 1,
        borderColor: active ? t.colors.accent : t.colors.line,
        borderRadius: 999,
        paddingVertical: 8,
        paddingHorizontal: 13,
      }}
    >
      <RNText style={tx('600', 12, active ? t.colors.ink : t.colors.muted)} numberOfLines={1}>
        {label}
      </RNText>
    </Pressy>
  );
}

function LocationPinIcon({ size = 16, color }: { size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21s7-6.1 7-11a7 7 0 1 0-14 0c0 4.9 7 11 7 11Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={2.6} stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

function ToggleSwitch({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  const anim = useRef(new Animated.Value(value ? 1 : 0)).current;

  const toggle = () => {
    const next = !value;
    onChange(next);
    Animated.timing(anim, {
      toValue: next ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  };

  const trackColor = anim.interpolate({
    inputRange: [0, 1],
    outputRange: [t.colors.line, t.colors.accent],
  });
  const knobX = anim.interpolate({ inputRange: [0, 1], outputRange: [0, KNOB_TRAVEL] });

  return (
    <Pressable onPress={toggle} hitSlop={8}>
      <Animated.View
        style={{
          width: SWITCH_WIDTH,
          height: SWITCH_HEIGHT,
          borderRadius: 999,
          padding: 3,
          backgroundColor: trackColor,
        }}
      >
        <Animated.View
          style={{
            width: KNOB_SIZE,
            height: KNOB_SIZE,
            borderRadius: 999,
            backgroundColor: '#FFFFFF',
            transform: [{ translateX: knobX }],
            shadowColor: '#000',
            shadowOpacity: 0.25,
            shadowRadius: 4,
            shadowOffset: { width: 0, height: 1 },
            elevation: 2,
          }}
        />
      </Animated.View>
    </Pressable>
  );
}

export function SearchScreen() {
  const t = useTheme();
  const { go } = useNav();
  const { mode } = useMode();
  const { flash } = useApp();
  const worker = mode === 'worker';

  const [query, setQuery] = useState('');
  const [radiusOn, setRadiusOn] = useState(true);
  const [budgetOn, setBudgetOn] = useState(false);
  // Pillar is an optional filter: null means every pillar, and tapping the
  // active chip clears it again.
  const [pillar, setPillar] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);

  const filters = {
    q: query,
    pillar: pillar === null ? null : FILTER_PILLARS[pillar]!,
    minMinor: budgetOn ? BUDGET_MIN_MINOR : null,
    maxMinor: budgetOn ? BUDGET_MAX_MINOR : null,
  };

  // Live result count as the filters change. Debounced so typing doesn't fire a
  // request per keystroke; `alive` drops answers that arrive out of order.
  useEffect(() => {
    let alive = true;
    setCount(null);
    const id = setTimeout(() => {
      searchTasks({ ...filters, limit: 60 })
        .then((rows) => alive && setCount(rows.length))
        .catch(() => alive && setCount(0));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pillar, budgetOn]);

  const runSaved = (title: string) => {
    go('home', { q: title });
    flash('Running "' + title + '"');
  };

  const applyFilters = () => {
    go('home', {
      q: query.trim() || undefined,
      pillar: filters.pillar ?? undefined,
      minMinor: filters.minMinor ?? undefined,
      maxMinor: filters.maxMinor ?? undefined,
    });
  };

  const ctaLabel =
    count === null ? 'Searching…' : count === 1 ? 'Show 1 task' : `Show ${count} tasks`;

  return (
    <Screen scroll padded={false}>
      <FadeIn duration={260} style={{ paddingHorizontal: 20, paddingTop: 6 }}>
        <RNText style={tx('800', 24, t.colors.ink, { letterSpacing: -0.72 })}>Search</RNText>

        <View
          style={{
            marginTop: 15,
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            paddingVertical: 13,
            paddingHorizontal: 15,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
          }}
        >
          <Icon name="search" size={17} color={t.colors.muted} strokeWidth={1.8} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={worker ? 'Find a task or a service' : 'Find a worker or a service'}
            placeholderTextColor={t.colors.muted}
            style={{ flex: 1, fontFamily: fontFamilyFor('400'), fontSize: 14, color: t.colors.ink, padding: 0 }}
            autoFocus
          />
        </View>

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 24 })}>LOCATION</RNText>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 11,
            marginTop: 11,
            backgroundColor: t.colors.surface2,
            borderRadius: 12,
            paddingVertical: 12,
            paddingHorizontal: 15,
          }}
        >
          <LocationPinIcon color={t.colors.muted} />
          <RNText style={tx('400', 14, t.colors.ink, { flex: 1 })}>Indiranagar, Bengaluru</RNText>
          <Pressy onPress={() => flash('Using your location')}>
            <RNText style={tx('600', 12, t.colors.accentDeep)}>Use my location</RNText>
          </Pressy>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 }}>
          <RNText style={tx('400', 11, t.colors.muted, { flex: 1, letterSpacing: 1.54 })}>RADIUS FROM THERE</RNText>
          <ToggleSwitch value={radiusOn} onChange={setRadiusOn} />
        </View>
        {radiusOn && (
          <FadeIn duration={260}>
            <View style={{ marginTop: 16, height: 3, backgroundColor: t.colors.line, borderRadius: 2, position: 'relative' }}>
              <View
                style={{
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  bottom: 0,
                  width: '58%',
                  backgroundColor: t.colors.accent,
                  borderRadius: 2,
                }}
              />
              <View
                style={{
                  position: 'absolute',
                  left: '58%',
                  top: -7,
                  width: 17,
                  height: 17,
                  marginLeft: -8.5,
                  borderRadius: 999,
                  backgroundColor: t.colors.accent,
                  shadowColor: t.colors.accent,
                  shadowOpacity: 0.4,
                  shadowRadius: 8,
                  shadowOffset: { width: 0, height: 3 },
                  elevation: 3,
                }}
              />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 10 }}>
              <RNText style={tx('400', 12, t.colors.muted)}>1 km</RNText>
              <RNText style={tx('700', 12, t.colors.ink)}>12 km</RNText>
              <RNText style={tx('400', 12, t.colors.muted)}>25 km</RNText>
            </View>
          </FadeIn>
        )}

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 22 })}>PILLAR</RNText>
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 11 }}>
          {FILTER_LABELS.map((label, i) => (
            <FilterChip
              key={label}
              label={label}
              active={pillar === i}
              onPress={() => setPillar((cur) => (cur === i ? null : i))}
              t={t}
            />
          ))}
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 }}>
          <RNText style={tx('400', 11, t.colors.muted, { flex: 1, letterSpacing: 1.54 })}>BUDGET</RNText>
          <ToggleSwitch value={budgetOn} onChange={setBudgetOn} />
        </View>
        {budgetOn && (
          <FadeIn duration={260} style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
            <View style={{ flex: 1, backgroundColor: t.colors.surface2, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 15 }}>
              <RNText style={tx('400', 10, t.colors.muted)}>MIN</RNText>
              <RNText style={tx('700', 15, t.colors.ink, { marginTop: 3 })}>₹500</RNText>
            </View>
            <View style={{ flex: 1, backgroundColor: t.colors.surface2, borderRadius: 12, paddingVertical: 13, paddingHorizontal: 15 }}>
              <RNText style={tx('400', 10, t.colors.muted)}>MAX</RNText>
              <RNText style={tx('700', 15, t.colors.ink, { marginTop: 3 })}>₹8,000</RNText>
            </View>
          </FadeIn>
        )}

        <RNText style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 24 })}>SAVED SEARCHES</RNText>
        {SAVED_SEARCHES.map((s, i) => (
          <FadeIn key={s.title} duration={340} delay={i * 70} translateY={10}>
            <Pressy
              onPress={() => runSaved(s.title)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 12,
                paddingVertical: 15,
                borderBottomWidth: 1,
                borderBottomColor: t.colors.line,
              }}
            >
              <Icon name="search" size={15} color={t.colors.muted} strokeWidth={1.9} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <RNText style={tx('400', 15, t.colors.ink)}>{s.title}</RNText>
                <RNText style={tx('400', 12, t.colors.muted, { marginTop: 2 })}>{s.meta}</RNText>
              </View>
              <RNText style={tx('600', 12, t.colors.accentDeep)}>Alerts on</RNText>
            </Pressy>
          </FadeIn>
        ))}

        <Pressy
          onPress={applyFilters}
          style={{
            marginTop: 22,
            backgroundColor: t.colors.accent,
            borderRadius: 999,
            paddingVertical: 16,
            alignItems: 'center',
            shadowColor: t.colors.accent,
            shadowOpacity: 0.4,
            shadowRadius: 14,
            shadowOffset: { width: 0, height: 8 },
            elevation: 4,
          }}
        >
          <RNText style={tx('700', 16, t.colors.onAccent)}>{ctaLabel}</RNText>
        </Pressy>
      </FadeIn>
    </Screen>
  );
}
