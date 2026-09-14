import React, { useEffect, useState } from 'react';
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
import {
  resolveCurrentPlace,
  searchPlaces,
  searchProvider,
  type PickedPlace,
} from '../lib/location';
import { rememberPlace, recentPlaces, loadRecentPlaces } from '../lib/recentPlaces';

export type { PickedPlace };


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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedPlace[]>([]);
  const [recents, setRecents] = useState<PickedPlace[]>(recentPlaces());
  const provider = searchProvider();

  // Recents live on the device, so they load asynchronously the first time.
  useEffect(() => {
    if (!visible) return;
    let alive = true;
    void loadRecentPlaces().then((r) => alive && setRecents(r));
    return () => {
      alive = false;
    };
  }, [visible]);

  const useCurrent = async () => {
    setError(null);
    setBusy(true);
    try {
      const place = await resolveCurrentPlace();
      rememberPlace(place);
      onPick(place);
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
      // Whatever the providers said, the typed place stays selectable — but it
      // is marked so the caller knows it carries no coordinates.
      setResults(hits.length > 0 ? hits : [{ label: q, lat: null, lng: null }]);
      if (hits.length === 0) setError('No match found — you can still use what you typed');
    } catch {
      setResults([{ label: q, lat: null, lng: null }]);
    } finally {
      setBusy(false);
    }
  };

  const choose = (place: PickedPlace) => {
    rememberPlace(place);
    onPick(place);
  };

  const optionCard = (
    icon: React.ReactNode,
    title: string,
    sub: string,
    onPress: () => void,
  ) => (
    <Pressable
      onPress={onPress}
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

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
        <Pressable style={{ flex: 1 }} onPress={onCancel} />
        <View
          style={{
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            paddingBottom: 24,
            maxHeight: '86%',
          }}
        >
          <View style={{ paddingTop: 12, alignItems: 'center' }}>
            <View style={{ width: 38, height: 4, borderRadius: 999, backgroundColor: t.colors.line }} />
          </View>

          <ScrollView contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 16 }}>
            <RNText style={tx('800', 20, t.colors.ink, { letterSpacing: -0.4 })}>Location</RNText>

            {!searching ? (
              <>
                {optionCard(
                  <PinIcon color={t.colors.accentDeep} />,
                  'Use my current location',
                  'Find where you are right now',
                  useCurrent,
                )}
                {optionCard(
                  <MapIcon color={t.colors.accentDeep} />,
                  'Search for a place',
                  provider === 'google'
                    ? 'Powered by Google Places'
                    : 'Areas and landmarks, worldwide',
                  () => setSearching(true),
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
                        onPress={() => choose(r)}
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
            ) : (
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
                  <Pressable onPress={search} hitSlop={8}>
                    <RNText style={tx('700', 13, t.colors.accentDeep)}>Search</RNText>
                  </Pressable>
                </View>

                {results.map((r, i) => (
                  <Pressable
                    key={`${r.label}-${i}`}
                    onPress={() => choose(r)}
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

                <Pressable onPress={() => setSearching(false)} style={{ marginTop: 16 }}>
                  <RNText style={tx('600', 14, t.colors.muted)}>← Back to options</RNText>
                </Pressable>
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
