import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { MapPicker } from './MapPicker';
import {
  resolveCurrentPlace,
  searchPlaces,
  searchProvider,
  describeCoords,
  type PickedPlace,
} from '../lib/location';
import { rememberPlace, recentPlaces, loadRecentPlaces } from '../lib/recentPlaces';

export type { PickedPlace };

/**
 * Setting a location, the way the delivery apps do it.
 *
 * Three ways in, one way out. Whether you use your current position, search for
 * a place, or type an area, you land on the same map with the pin already on
 * your best guess — and you confirm or nudge it from there. That last step is
 * the point: an address string is rarely the exact gate, door or block, and a
 * pin the user has personally agreed to is worth far more than one we inferred.
 *
 * Only "recent" skips the map, because those are places the user already
 * confirmed once.
 */

/** Bengaluru, only ever used when there is nothing at all to centre on. */
const FALLBACK = { lat: 12.9716, lng: 77.5946 };

function PinIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M12 21s7-5.6 7-11a7 7 0 1 0-14 0c0 5.4 7 11 7 11Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Circle cx={12} cy={10} r={2.6} stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

function MapIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z"
        stroke={color}
        strokeWidth={1.7}
        strokeLinejoin="round"
      />
      <Path d="M9 4v13M15 6.5v13" stroke={color} strokeWidth={1.7} />
    </Svg>
  );
}

type Mode = 'options' | 'search' | 'map';

export function LocationSheet({
  visible,
  onCancel,
  onPick,
}: {
  visible: boolean;
  onCancel: () => void;
  onPick: (place: PickedPlace) => void;
}) {
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('options');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedPlace[]>([]);
  const [recents, setRecents] = useState<PickedPlace[]>(recentPlaces());
  const provider = searchProvider();

  // What the map is showing, and what we will hand back if they confirm.
  const [pin, setPin] = useState<{ lat: number; lng: number }>(FALLBACK);
  const [pinLabel, setPinLabel] = useState<string>('');
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setMode('options');
    setError(null);
    let alive = true;
    void loadRecentPlaces().then((r) => alive && setRecents(r));
    return () => {
      alive = false;
    };
  }, [visible]);

  /**
   * Name whatever the pin is sitting on. Each drag supersedes the last, so a
   * slow reverse-geocode from an earlier position can never overwrite a newer
   * one — hence the token.
   */
  const namingToken = useRef(0);
  const nameThePin = async (at: { lat: number; lng: number }) => {
    const mine = ++namingToken.current;
    setNaming(true);
    try {
      const label = await describeCoords(at.lat, at.lng);
      if (mine === namingToken.current) setPinLabel(label);
    } catch {
      if (mine === namingToken.current) {
        setPinLabel(`${at.lat.toFixed(4)}, ${at.lng.toFixed(4)}`);
      }
    } finally {
      if (mine === namingToken.current) setNaming(false);
    }
  };

  /** Open the map on a point, and start working out what it is called. */
  const openMapAt = (at: { lat: number; lng: number }, label?: string) => {
    setPin(at);
    setPinLabel(label ?? '');
    setMode('map');
    setError(null);
    if (!label) void nameThePin(at);
  };

  const useCurrent = async () => {
    setError(null);
    setBusy(true);
    try {
      const place = await resolveCurrentPlace();
      if (place.lat !== null && place.lng !== null) {
        // Straight onto the map rather than done: GPS gets you to the building,
        // not the door, and the user is the one who knows the difference.
        openMapAt({ lat: place.lat, lng: place.lng }, place.label);
      } else {
        onPick(place);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read your location');
    } finally {
      setBusy(false);
    }
  };

  const search = async () => {
    const q = query.trim();
    if (!q) return;
    setError(null);
    setBusy(true);
    setResults([]);
    try {
      const hits = await searchPlaces(q);
      setResults(hits.length > 0 ? hits : [{ label: q, lat: null, lng: null }]);
      if (hits.length === 0) setError('No match found — you can still use what you typed');
    } catch {
      setResults([{ label: q, lat: null, lng: null }]);
    } finally {
      setBusy(false);
    }
  };

  /** A search hit drops the pin there; typed text with no match has nowhere to drop. */
  const pickResult = (r: PickedPlace) => {
    if (r.lat !== null && r.lng !== null) openMapAt({ lat: r.lat, lng: r.lng }, r.label);
    else finish(r);
  };

  const finish = (place: PickedPlace) => {
    rememberPlace(place);
    onPick(place);
  };

  const confirmPin = () => {
    finish({
      label: pinLabel || `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`,
      lat: pin.lat,
      lng: pin.lng,
    });
  };

  const optionCard = (
    icon: React.ReactNode,
    title: string,
    sub: string,
    onPress: () => void,
  ) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={title}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        borderRadius: 14,
        backgroundColor: t.colors.surface,
        borderWidth: 1,
        borderColor: t.colors.line,
        marginTop: 12,
        transform: [{ scale: pressed ? 0.985 : 1 }],
      })}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 12,
          backgroundColor: t.colors.accentSoft,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {icon}
      </View>
      <View style={{ flex: 1 }}>
        <RNText style={tx('700', 15, t.colors.ink)}>{title}</RNText>
        <RNText style={tx('400', 12, t.colors.muted, { marginTop: 3 })}>{sub}</RNText>
      </View>
      <RNText style={tx('400', 16, t.colors.muted)}>›</RNText>
    </Pressable>
  );

  const backLink = (to: Mode, label: string) => (
    <Pressable
      onPress={() => {
        setMode(to);
        setError(null);
      }}
      accessibilityRole="button"
      style={{ marginTop: 16 }}
    >
      <RNText style={tx('600', 14, t.colors.muted)}>← {label}</RNText>
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={onCancel} accessibilityLabel="Close" />
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: 24,
            maxHeight: '88%',
          }}
        >
          <View style={{ paddingTop: 12, alignItems: 'center' }}>
            <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: t.colors.line }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>
              {mode === 'map' ? 'Move the pin' : 'Location'}
            </RNText>

            {mode === 'options' && (
              <>
                {optionCard(
                  <PinIcon color={t.colors.accentDeep} />,
                  'Use my current location',
                  'Find where you are, then fine-tune it',
                  () => void useCurrent(),
                )}
                {optionCard(
                  <MapIcon color={t.colors.accentDeep} />,
                  'Search for a place',
                  provider === 'google'
                    ? 'Powered by Google Places'
                    : 'Areas and landmarks, worldwide',
                  () => setMode('search'),
                )}
                {optionCard(
                  <MapIcon color={t.colors.accentDeep} />,
                  'Pin it on the map',
                  'Drag to the exact spot',
                  () => openMapAt(recents[0]?.lat != null
                    ? { lat: recents[0].lat!, lng: recents[0].lng! }
                    : FALLBACK),
                )}

                {recents.length > 0 && (
                  <>
                    <RNText
                      style={tx('400', 11, t.colors.muted, { letterSpacing: 1.54, marginTop: 20 })}
                    >
                      RECENT
                    </RNText>
                    {recents.map((r) => (
                      <Pressable
                        key={r.label}
                        onPress={() => finish(r)}
                        accessibilityRole="button"
                        accessibilityLabel={r.label}
                        style={{
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 12,
                          paddingVertical: 13,
                          borderBottomWidth: 1,
                          borderBottomColor: t.colors.line,
                        }}
                      >
                        <PinIcon color={t.colors.muted} />
                        <RNText style={tx('400', 15, t.colors.ink, { flex: 1 })} numberOfLines={1}>
                          {r.label}
                        </RNText>
                      </Pressable>
                    ))}
                  </>
                )}
              </>
            )}

            {mode === 'search' && (
              <>
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    marginTop: 14,
                    backgroundColor: t.colors.surface2,
                    borderRadius: 12,
                    paddingVertical: 13,
                    paddingHorizontal: 14,
                  }}
                >
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    onSubmitEditing={() => void search()}
                    returnKeyType="search"
                    blurOnSubmit={false}
                    autoFocus
                    placeholder="Search an area, e.g. Indiranagar"
                    placeholderTextColor={t.colors.muted}
                    style={tx('400', 15, t.colors.ink, { flex: 1, padding: 0 })}
                  />
                  <Pressable onPress={() => void search()} hitSlop={8} accessibilityRole="button">
                    <RNText style={tx('700', 13, t.colors.accentDeep)}>Search</RNText>
                  </Pressable>
                </View>

                {results.map((r, i) => (
                  <Pressable
                    key={`${r.label}-${i}`}
                    onPress={() => pickResult(r)}
                    accessibilityRole="button"
                    accessibilityLabel={r.label}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 12,
                      paddingVertical: 14,
                      borderBottomWidth: 1,
                      borderBottomColor: t.colors.line,
                    }}
                  >
                    <PinIcon color={t.colors.muted} />
                    <RNText style={tx('400', 15, t.colors.ink, { flex: 1 })}>{r.label}</RNText>
                  </Pressable>
                ))}

                {provider === 'osm' && (
                  <RNText style={tx('400', 12, t.colors.muted, { marginTop: 14, lineHeight: 18 })}>
                    Results from OpenStreetMap. Set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY to use Google
                    Places instead.
                  </RNText>
                )}

                {backLink('options', 'Back to options')}
              </>
            )}

            {mode === 'map' && (
              <>
                <RNText style={tx('400', 13, t.colors.muted, { marginTop: 8, lineHeight: 19 })}>
                  Drag the map so the pin sits on the exact spot.
                </RNText>

                <View style={{ marginTop: 12 }}>
                  <MapPicker
                    lat={pin.lat}
                    lng={pin.lng}
                    onMoved={(next) => {
                      setPin(next);
                      void nameThePin(next);
                    }}
                  />
                </View>

                <View
                  style={{
                    marginTop: 12,
                    padding: 13,
                    borderRadius: 12,
                    backgroundColor: t.colors.surface,
                    borderWidth: 1,
                    borderColor: t.colors.line,
                  }}
                >
                  <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>
                    PIN IS ON
                  </RNText>
                  <RNText style={tx('700', 14, t.colors.ink, { marginTop: 4 })} numberOfLines={2}>
                    {naming ? 'Working out where that is…' : pinLabel || 'Somewhere off the map'}
                  </RNText>
                  <RNText style={tx('400', 11, t.colors.muted, { marginTop: 3 })}>
                    {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
                  </RNText>
                </View>

                <Pressable
                  onPress={confirmPin}
                  accessibilityRole="button"
                  accessibilityLabel="Confirm this location"
                  style={({ pressed }) => ({
                    marginTop: 14,
                    backgroundColor: t.colors.accent,
                    borderRadius: 999,
                    paddingVertical: 15,
                    alignItems: 'center',
                    transform: [{ scale: pressed ? 0.97 : 1 }],
                  })}
                >
                  <RNText style={tx('700', 15, t.colors.onAccent)}>Confirm this location</RNText>
                </Pressable>

                {backLink('options', 'Back to options')}
              </>
            )}

            {busy && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 16 }}>
                <ActivityIndicator color={t.colors.accent} />
                <RNText style={tx('400', 13, t.colors.muted)}>Working…</RNText>
              </View>
            )}
            {error && (
              <RNText style={tx('600', 13, t.colors.signal, { marginTop: 14 })}>{error}</RNText>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
