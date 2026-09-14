import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text as RNText,
  Pressable,
  ScrollView,
  Modal,
  TextInput,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
 * Setting a location.
 *
 * There is one screen and it is the map. Not a menu that leads to a map, not
 * three modes to choose between — the map is up from the moment the screen
 * opens, and everything else floats on top of it.
 *
 * Search, the current-location button and the recent list are all just ways of
 * *moving* that map. None of them ends the flow. The flow ends one way: the pin
 * is where you want it and you tap Confirm. That is the whole design, and it is
 * why the address panel is always on screen — at every moment you can see the
 * point you are about to hand over and what it is called.
 *
 * The alternative, which this replaces, was a form whose answer got turned into
 * a pin behind your back. It saved a tap and cost you the one thing that
 * matters: seeing where the pin actually landed.
 */

/** Bengaluru, only ever used when there is nothing at all to centre on. */
const FALLBACK = { lat: 12.9716, lng: 77.5946 };

/** Long enough that typing does not fire a request per keystroke. */
const TYPING_PAUSE = 350;

function PinIcon({ color, size = 20 }: { color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
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

function SearchIcon({ color }: { color: string }) {
  return (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Circle cx={11} cy={11} r={6.5} stroke={color} strokeWidth={1.8} />
      <Path d="m16 16 4.5 4.5" stroke={color} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function CrosshairIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Circle cx={12} cy={12} r={6} stroke={color} strokeWidth={1.8} />
      <Circle cx={12} cy={12} r={1.8} fill={color} />
      <Path
        d="M12 2v3M12 19v3M2 12h3M19 12h3"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
      />
    </Svg>
  );
}

function BackIcon({ color }: { color: string }) {
  return (
    <Svg width={20} height={20} viewBox="0 0 24 24" fill="none">
      <Path
        d="M15 5l-7 7 7 7"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
  const insets = useSafeAreaInsets();
  const provider = searchProvider();

  // Where the map is looking. `nonce` exists so that picking the same place
  // twice still recentres: the coordinates would be identical, and MapPicker
  // only follows a genuine change.
  const [target, setTarget] = useState<{ lat: number; lng: number; nonce: number }>({
    ...FALLBACK,
    nonce: 0,
  });
  // Where the pin actually is, which after a drag is not where we sent it.
  const [pin, setPin] = useState<{ lat: number; lng: number }>(FALLBACK);
  const [pinLabel, setPinLabel] = useState('');
  const [naming, setNaming] = useState(false);

  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedPlace[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [recents, setRecents] = useState<PickedPlace[]>(recentPlaces());

  const [locating, setLocating] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // The address panel grows when there is a note or a long address, so the
  // button that floats above it has to be told how tall it actually got
  // rather than clearing a height someone guessed once.
  const [panelHeight, setPanelHeight] = useState(180);

  const inputRef = useRef<TextInput>(null);

  /**
   * Name whatever the pin is sitting on. Each move supersedes the last, so a
   * slow reverse-geocode from an earlier position can never overwrite a newer
   * one — hence the token.
   */
  const namingToken = useRef(0);
  const nameThePin = useCallback(async (at: { lat: number; lng: number }) => {
    const mine = ++namingToken.current;
    setNaming(true);
    try {
      const label = await describeCoords(at.lat, at.lng);
      if (mine === namingToken.current) setPinLabel(label);
    } catch {
      if (mine === namingToken.current) setPinLabel('');
    } finally {
      if (mine === namingToken.current) setNaming(false);
    }
  }, []);

  /** Move the map somewhere, and work out what is there. */
  const goTo = useCallback(
    (at: { lat: number; lng: number }, label?: string) => {
      setTarget((prev) => ({ ...at, nonce: prev.nonce + 1 }));
      setPin(at);
      setPinLabel(label ?? '');
      if (label) namingToken.current += 1; // a known name outranks any in-flight lookup
      else void nameThePin(at);
    },
    [nameThePin],
  );

  const findMe = useCallback(async () => {
    setNote(null);
    setLocating(true);
    try {
      const place = await resolveCurrentPlace();
      if (place.lat !== null && place.lng !== null) {
        goTo({ lat: place.lat, lng: place.lng }, place.label);
      } else {
        setNote('Found you, but not precisely — drag the pin to the right spot');
      }
    } catch (e) {
      setNote(e instanceof Error ? e.message : 'Could not read your location');
    } finally {
      setLocating(false);
    }
  }, [goTo]);

  // Opening the screen starts by looking for you. That is the common case, and
  // waiting to be asked for permission to be helpful is a tap wasted. If it
  // fails we quietly sit on the last place used instead.
  const opened = useRef(false);
  useEffect(() => {
    if (!visible) {
      opened.current = false;
      return;
    }
    if (opened.current) return;
    opened.current = true;

    setQuery('');
    setResults(null);
    setPanelOpen(false);
    setNote(null);

    let alive = true;
    void loadRecentPlaces().then((r) => {
      if (!alive) return;
      setRecents(r);
      const last = r.find((p) => p.lat != null && p.lng != null);
      if (last) goTo({ lat: last.lat!, lng: last.lng! }, last.label);
    });
    void findMe();
    return () => {
      alive = false;
    };
  }, [visible, goTo, findMe]);

  // Live search. Debounced, and each run is tagged so a slow early response
  // cannot land after a faster later one and show results for a stale query.
  const searchToken = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      setSearching(false);
      return;
    }
    const mine = ++searchToken.current;
    setSearching(true);
    const timer = setTimeout(() => {
      void searchPlaces(q)
        .then((hits) => {
          if (mine === searchToken.current) setResults(hits);
        })
        .catch(() => {
          if (mine === searchToken.current) setResults([]);
        })
        .finally(() => {
          if (mine === searchToken.current) setSearching(false);
        });
    }, TYPING_PAUSE);
    return () => clearTimeout(timer);
  }, [query]);

  const chooseResult = (r: PickedPlace) => {
    setNote(null);
    setPanelOpen(false);
    setQuery('');
    setResults(null);
    inputRef.current?.blur();
    if (r.lat != null && r.lng != null) goTo({ lat: r.lat, lng: r.lng }, r.label);
  };

  const confirm = () => {
    const place: PickedPlace = {
      label: pinLabel || `${pin.lat.toFixed(4)}, ${pin.lng.toFixed(4)}`,
      lat: pin.lat,
      lng: pin.lng,
    };
    rememberPlace(place);
    onPick(place);
  };

  // The address panel slides up once we have something to say, so the map is
  // unobstructed for the first beat.
  const rise = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(rise, {
      toValue: visible ? 1 : 0,
      useNativeDriver: true,
      friction: 9,
      tension: 70,
    }).start();
  }, [visible, rise]);

  const topInset = Math.max(insets.top, 12);
  const bottomInset = Math.max(insets.bottom, 12);

  const listRow = (place: PickedPlace, key: string, muted = false) => (
    <Pressable
      key={key}
      onPress={() => chooseResult(place)}
      accessibilityRole="button"
      accessibilityLabel={place.label}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        paddingVertical: 14,
        paddingHorizontal: 16,
        backgroundColor: pressed ? t.colors.surface2 : 'transparent',
      })}
    >
      <PinIcon color={muted ? t.colors.muted : t.colors.accentDeep} />
      <RNText style={tx('400', 15, t.colors.ink, { flex: 1 })} numberOfLines={2}>
        {place.label}
      </RNText>
    </Pressable>
  );

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
        {/* The map is the screen. Everything below is layered over it. */}
        <MapPicker
          lat={target.lat}
          lng={target.lng}
          radius={0}
          controlsTop={topInset + 76}
          onMoved={(next) => {
            // Placing the pin by hand answers whatever the note was warning about.
            setNote(null);
            setPin(next);
            void nameThePin(next);
          }}
        />

        {/* ---- floating search bar ---- */}
        <View
          style={{
            position: 'absolute',
            left: 12,
            right: 12,
            top: topInset,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 8,
            backgroundColor: t.colors.bg,
            borderRadius: 14,
            paddingHorizontal: 12,
            paddingVertical: Platform.OS === 'web' ? 10 : 6,
            borderWidth: 1,
            borderColor: t.colors.line,
            shadowColor: '#000',
            shadowOpacity: 0.16,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 4 },
            elevation: 4,
          }}
        >
          <Pressable
            onPress={() => {
              if (panelOpen) {
                setPanelOpen(false);
                setQuery('');
                inputRef.current?.blur();
              } else {
                onCancel();
              }
            }}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={panelOpen ? 'Close search' : 'Close'}
          >
            <BackIcon color={t.colors.ink} />
          </Pressable>
          <TextInput
            ref={inputRef}
            value={query}
            onChangeText={(v) => {
              setQuery(v);
              setPanelOpen(true);
            }}
            onFocus={() => setPanelOpen(true)}
            placeholder="Search an area, street or landmark"
            placeholderTextColor={t.colors.muted}
            returnKeyType="search"
            style={tx('400', 15, t.colors.ink, { flex: 1, paddingVertical: 8 })}
          />
          {searching ? <ActivityIndicator size="small" color={t.colors.accent} /> : null}
          {!searching && query.length === 0 ? <SearchIcon color={t.colors.muted} /> : null}
        </View>

        {/* ---- results / recents, over the map ---- */}
        {panelOpen && (
          <View
            style={{
              position: 'absolute',
              left: 12,
              right: 12,
              top: topInset + 62,
              maxHeight: '55%',
              backgroundColor: t.colors.bg,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: t.colors.line,
              overflow: 'hidden',
              shadowColor: '#000',
              shadowOpacity: 0.16,
              shadowRadius: 12,
              shadowOffset: { width: 0, height: 4 },
              elevation: 4,
            }}
          >
            <ScrollView keyboardShouldPersistTaps="handled">
              {query.trim().length < 2 && recents.length > 0 && (
                <>
                  <RNText
                    style={tx('400', 11, t.colors.muted, {
                      letterSpacing: 1.5,
                      paddingHorizontal: 16,
                      paddingTop: 14,
                      paddingBottom: 4,
                    })}
                  >
                    RECENT
                  </RNText>
                  {recents
                    .filter((r) => r.lat != null && r.lng != null)
                    .map((r, i) => listRow(r, `recent-${i}`, true))}
                </>
              )}

              {query.trim().length < 2 && recents.length === 0 && (
                <RNText style={tx('400', 13, t.colors.muted, { padding: 16, lineHeight: 19 })}>
                  Type an area and pick it from the list — the map will move there, and you can
                  still drag the pin to the exact spot.
                </RNText>
              )}

              {results?.map((r, i) => listRow(r, `hit-${i}`))}

              {results?.length === 0 && !searching && (
                <RNText style={tx('400', 13, t.colors.muted, { padding: 16, lineHeight: 19 })}>
                  Nothing matched “{query.trim()}”. Close this and drag the map instead — the pin is
                  what gets saved, not the text.
                </RNText>
              )}

              {provider === 'osm' && (results?.length ?? 0) > 0 && (
                <RNText
                  style={tx('400', 11, t.colors.muted, {
                    paddingHorizontal: 16,
                    paddingVertical: 10,
                  })}
                >
                  Results from OpenStreetMap.
                </RNText>
              )}
            </ScrollView>
          </View>
        )}

        {/* ---- current location, sitting just above the address panel ---- */}
        {!panelOpen && (
          <Pressable
            onPress={() => void findMe()}
            accessibilityRole="button"
            accessibilityLabel="Move the map to my current location"
            style={({ pressed }) => ({
              position: 'absolute',
              right: 14,
              bottom: panelHeight + 14,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 11,
              borderRadius: 999,
              backgroundColor: t.colors.bg,
              borderWidth: 1,
              borderColor: t.colors.line,
              shadowColor: '#000',
              shadowOpacity: 0.18,
              shadowRadius: 10,
              shadowOffset: { width: 0, height: 3 },
              elevation: 4,
              transform: [{ scale: pressed ? 0.96 : 1 }],
            })}
          >
            {locating ? (
              <ActivityIndicator size="small" color={t.colors.accent} />
            ) : (
              <CrosshairIcon color={t.colors.accentDeep} />
            )}
            <RNText style={tx('700', 13, t.colors.accentDeep)}>
              {locating ? 'Locating…' : 'Use my location'}
            </RNText>
          </Pressable>
        )}

        {/* ---- the address panel: always there, always the truth ---- */}
        <Animated.View
          onLayout={(e) => setPanelHeight(Math.round(e.nativeEvent.layout.height))}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            paddingHorizontal: 20,
            paddingTop: 18,
            paddingBottom: bottomInset + 6,
            backgroundColor: t.colors.bg,
            borderTopLeftRadius: 22,
            borderTopRightRadius: 22,
            shadowColor: '#000',
            shadowOpacity: 0.14,
            shadowRadius: 16,
            shadowOffset: { width: 0, height: -4 },
            elevation: 12,
            transform: [
              { translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [220, 0] }) },
            ],
          }}
        >
          <RNText style={tx('400', 10, t.colors.muted, { letterSpacing: 1.4 })}>
            PIN IS ON
          </RNText>
          <RNText style={tx('800', 17, t.colors.ink, { marginTop: 5, letterSpacing: -0.3 })} numberOfLines={2}>
            {naming ? 'Working out where that is…' : pinLabel || 'Drag the map to set your spot'}
          </RNText>
          <RNText style={tx('400', 11, t.colors.muted, { marginTop: 4 })}>
            {pin.lat.toFixed(5)}, {pin.lng.toFixed(5)}
          </RNText>

          {note && (
            <RNText style={tx('600', 12, t.colors.signal, { marginTop: 10, lineHeight: 17 })}>
              {note}
            </RNText>
          )}

          <Pressable
            onPress={confirm}
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
            <RNText style={tx('700', 15, t.colors.onAccent)}>Confirm location</RNText>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}
