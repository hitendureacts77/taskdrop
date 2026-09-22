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
import { resolveCurrentPlace, locationPermission } from '../lib/location';
import { fontFamilyFor, type Theme } from '../theme';
import type { Enums } from '@taskdrop/db-types';
import { FadeIn, Pressy, tx } from '../components/primitives';
import { Slider } from '../components/Slider';
import { LocationSheet } from '../components/LocationSheet';

/**
 * Search screen — pixel parity with docs/design/_design_markup.html lines
 * 140-203 (search field, location row, radius/budget toggles + reveals,
 * pillar chips, saved searches, "Show N tasks" CTA). Data/handlers mirror
 * docs/design/_design_source.jsx renderVals() lines 290-312.
 */

// Must match the pillar names in CreateScreen.tsx exactly — see the note there.
const FILTER_LABELS = ['Services', 'Products', 'Local Intel'];
// Chip index -> the pillar enum stored on tasks.
const FILTER_PILLARS: Enums<'pillar'>[] = ['services', 'procurement', 'local_intel'];

const BUDGET_MIN_MINOR = 50000; // ₹500
const BUDGET_MAX_MINOR = 800000; // ₹8,000

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
  // Nothing is assumed about where the user is until they ask for it.
  const [place, setPlace] = useState<string | null>(null);
  // The point the radius is measured from. A label with no coordinates cannot
  // filter anything, so both are kept together or neither is.
  const [placeAt, setPlaceAt] = useState<{ lat: number; lng: number } | null>(null);
  const [radiusKm, setRadiusKm] = useState(12);
  const [locating, setLocating] = useState(false);
  // Checked on arrival, so the control can tell the truth before it is tapped.
  // A button that looks live and then says "declined" reads as a broken button.
  const [locationOff, setLocationOff] = useState(false);

  useEffect(() => {
    let alive = true;
    void locationPermission().then(({ granted, canAskAgain }) => {
      if (alive) setLocationOff(!granted && !canAskAgain);
    });
    return () => {
      alive = false;
    };
  }, []);
  const [pickingPlace, setPickingPlace] = useState(false);

  // Radius only means something once there is a point to measure from.
  const near = radiusOn && placeAt ? { ...placeAt, radiusKm } : null;

  const filters = {
    q: query,
    pillar: pillar === null ? null : FILTER_PILLARS[pillar]!,
    minMinor: budgetOn ? BUDGET_MIN_MINOR : null,
    maxMinor: budgetOn ? BUDGET_MAX_MINOR : null,
    near,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, pillar, budgetOn, radiusOn, radiusKm, placeAt?.lat, placeAt?.lng]);

  const useMyLocation = async () => {
    if (locating) return;
    setLocating(true);
    try {
      const found = await resolveCurrentPlace({
        // Move the search anchor the moment a cached fix exists, so tapping
        // this does something visible immediately rather than after a wait.
        onPartial: (at) => setPlaceAt(at),
      });
      setPlace(found.label);
      if (found.lat !== null && found.lng !== null) {
        setPlaceAt({ lat: found.lat, lng: found.lng });
      } else {
        // A label without a pin cannot anchor a radius; say so rather than
        // leaving the slider looking like it is doing something.
        setPlaceAt(null);
        flash('Found the area but not a precise point — pick it on the map to use a radius');
        return;
      }
      flash(found.label);
    } catch (e) {
      flash(e instanceof Error ? e.message : 'Could not read your location');
    } finally {
      setLocating(false);
    }
  };

  const applyFilters = () => {
    go('home', {
      q: query.trim() || undefined,
      pillar: filters.pillar ?? undefined,
      minMinor: filters.minMinor ?? undefined,
      maxMinor: filters.maxMinor ?? undefined,
      nearLat: near?.lat,
      nearLng: near?.lng,
      radiusKm: near?.radiusKm,
    });
  };

  const ctaLabel =
    count === null ? 'Searching…' : count === 1 ? 'Show 1 task' : `Show ${count} tasks`;

  const locationSheet = (
    <LocationSheet
      visible={pickingPlace}
      // A search radius needs a centre, not a doorstep.
      askForDetails={false}
      onCancel={() => setPickingPlace(false)}
      onPick={(picked) => {
        setPickingPlace(false);
        setPlace(picked.label);
        setPlaceAt(
          picked.lat !== null && picked.lng !== null
            ? { lat: picked.lat, lng: picked.lng }
            : null,
        );
      }}
    />
  );

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
          {/* The whole row opens the map, so a radius can be centred on any
              place — not only wherever the phone happens to be. */}
          <Pressy
            onPress={() => setPickingPlace(true)}
            label={place ? `Change the search location, currently ${place}` : 'Choose a search location'}
            style={{ flex: 1 }}
          >
            <RNText
              style={tx('400', 14, place ? t.colors.ink : t.colors.muted)}
              numberOfLines={1}
            >
              {place ?? 'Anywhere'}
            </RNText>
          </Pressy>
          <Pressy onPress={useMyLocation} label="Use my current location">
            <RNText style={tx('600', 12, locationOff ? t.colors.signal : t.colors.accentDeep)}>
              {locating ? 'Locating…' : locationOff ? 'Location is off' : 'Use my location'}
            </RNText>
          </Pressy>
        </View>

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 22 }}>
          <RNText style={tx('400', 11, t.colors.muted, { flex: 1, letterSpacing: 1.54 })}>{worker ? 'FIND WORK IN THE RADIUS' : 'FIND THE WORKER IN THE RADIUS'}</RNText>
          <ToggleSwitch value={radiusOn} onChange={setRadiusOn} />
        </View>
        {radiusOn && (
          <FadeIn duration={260}>
            <Slider
              value={radiusKm}
              min={1}
              max={25}
              onChange={setRadiusKm}
              accessibilityLabel="Search radius in kilometres"
            />
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <RNText style={tx('400', 12, t.colors.muted)}>1 km</RNText>
              <RNText style={tx('700', 12, t.colors.ink)}>{radiusKm} km</RNText>
              <RNText style={tx('400', 12, t.colors.muted)}>25 km</RNText>
            </View>
            {!placeAt && (
              <RNText style={tx('400', 12, t.colors.muted, { marginTop: 9, lineHeight: 18 })}>
                Set a location above and the radius will start filtering from there.
              </RNText>
            )}
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

        {/* There was a "SAVED SEARCHES" heading here over the words "saving a
            search is coming" — a section title for a feature that does not
            exist. The instruction underneath is the only part that was ever
            true, so that is all that is left. */}
        {/* Saved searches need somewhere to save to; until then, say so. */}
        <RNText style={tx('400', 13, t.colors.muted, { marginTop: 11, lineHeight: 20 })}>
          Set the filters you want, then tap below.
        </RNText>

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
      {locationSheet}
    </Screen>
  );
}
