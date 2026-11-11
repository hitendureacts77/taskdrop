import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, Text as RNText, TextInput, View } from 'react-native';
import { BottomSheet, PrimaryButton } from './kit';
import { Icon } from './Icon';
import { FadeIn, Pressy, tx } from './primitives';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';
import { openLocationSettings, searchPlaces, type PickedPlace } from '../lib/location';
import type { LiveStatus } from '../lib/locationAsk';

/** Long enough that typing does not fire a request per keystroke. */
const TYPING_PAUSE = 350;

/** A pin inside two soft pulsing rings, in the mode's colour (still under reduced motion). */
function PinArt() {
  const t = useTheme();
  const reduced = useReducedMotion();
  const a = useRef(new Animated.Value(0)).current;
  const b = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    if (reduced) return;
    const mk = (v: Animated.Value, from: number) => {
      v.setValue(from);
      return Animated.loop(
        Animated.sequence([
          Animated.timing(v, { toValue: 1, duration: (1 - from) * 2200, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
          Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: Platform.OS !== 'web' }),
          Animated.timing(v, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        ]),
      );
    };
    const l1 = mk(a, 0);
    const l2 = mk(b, 0.5);
    l1.start();
    l2.start();
    return () => {
      l1.stop();
      l2.stop();
    };
  }, [a, b, reduced]);

  const ring = (p: Animated.Value, staticOpacity: number, staticScale: number) => (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: 120,
        height: 120,
        borderRadius: 60,
        backgroundColor: t.colors.accentSoft,
        borderWidth: 1,
        borderColor: t.colors.accentBorder,
        opacity: reduced ? staticOpacity : p.interpolate({ inputRange: [0, 1], outputRange: [0.9, 0] }),
        transform: [{ scale: reduced ? staticScale : p.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) }],
      }}
    />
  );

  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={{ width: 120, height: 120, alignItems: 'center', justifyContent: 'center', alignSelf: 'center' }}
    >
      {ring(b, 0.5, 1)}
      {ring(a, 0.9, 0.72)}
      <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: t.colors.accent, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="pin" size={28} color="#FFFFFF" />
      </View>
    </View>
  );
}

export function LocationPrompt({
  visible,
  status,
  onTurnOn,
  onPickTyped,
  onClose,
  initialStep = 'ask',
}: {
  visible: boolean;
  status: LiveStatus;
  /** Parent runs useLivePlace().locate(); true when a place was found (sheet closes). */
  onTurnOn: () => Promise<boolean>;
  /** A typed area was picked. */
  onPickTyped: (p: PickedPlace) => void;
  /** "Not now" or dismissed. */
  onClose: () => void;
  /** Open straight on the typing step (from the map's "Type my area"). Default 'ask'. */
  initialStep?: 'ask' | 'type';
}) {
  const t = useTheme();
  const [step, setStep] = useState<'ask' | 'type'>(initialStep);
  const [busy, setBusy] = useState(false);
  const [noProblem, setNoProblem] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<PickedPlace[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const alive = useRef(true);
  // The parent updates status after locate() resolves; read the latest in the click handler's wake.
  const statusRef = useRef(status);
  statusRef.current = status;
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // Fresh start each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    setStep(initialStep);
    setBusy(false);
    setNoProblem(false);
    setRefused(false);
    setQuery('');
    setResults([]);
    setSearching(false);
    setSearched(false);
  }, [visible, initialStep]);

  // Debounced place search.
  useEffect(() => {
    if (step !== 'type') return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      setSearched(false);
      return;
    }
    setSearching(true);
    let stale = false;
    const id = setTimeout(() => {
      void searchPlaces(q).then((r) => {
        if (stale) return;
        setResults(r);
        setSearching(false);
        setSearched(true);
      });
    }, TYPING_PAUSE);
    return () => {
      stale = true;
      clearTimeout(id);
    };
  }, [query, step]);

  // A refused system dialog: move on to typing. Android may report a first "no" as blocked already.
  useEffect(() => {
    if (refused && (status === 'denied' || status === 'blocked') && step === 'ask') {
      setRefused(false);
      setNoProblem(true);
      setStep('type');
    }
  }, [refused, status, step]);

  const native = Platform.OS !== 'web';
  const blocked = status === 'blocked';
  const servicesOff = status === 'services-off';

  const turnOn = async () => {
    if (busy) return;
    setBusy(true);
    let ok = false;
    try {
      ok = await onTurnOn();
    } catch {
      ok = false;
    }
    if (!alive.current) return;
    setBusy(false);
    if (!ok) setRefused(true);
  };

  const askStep = (
    <View style={{ gap: 16, paddingBottom: 8 }}>
      <PinArt />
      <RNText accessibilityRole="header" style={tx('800', 20, t.colors.ink, { textAlign: 'center' })}>
        Turn on location for the best Explore experience
      </RNText>
      <RNText style={tx('400', 14, t.colors.muted, { textAlign: 'center', lineHeight: 21 })}>
        See helpers and tasks right around you, and your own spot on the map. We only use it while TaskDrop is open.
        Others only ever see your area, never your exact spot.
      </RNText>
      {blocked && !native ? (
        <RNText style={tx('600', 13, t.colors.ink, { textAlign: 'center', lineHeight: 19 })}>
          Location is blocked for this site. Allow it from the icon beside the address, then tap Try again.
        </RNText>
      ) : null}
      {servicesOff ? (
        <RNText style={tx('600', 13, t.colors.ink, { textAlign: 'center', lineHeight: 19 })}>
          Location is switched off on this device. Turn it on, then try again.
        </RNText>
      ) : null}
      {blocked && native ? (
        <PrimaryButton label="Open settings" onPress={() => void openLocationSettings('blocked')} />
      ) : (
        <PrimaryButton label={blocked ? 'Try again' : 'Turn on location'} busy={busy} onPress={() => void turnOn()} />
      )}
      <PrimaryButton
        label="Type my area instead"
        tone="quiet"
        onPress={() => {
          setNoProblem(false);
          setStep('type');
        }}
      />
      <Pressy onPress={onClose} label="Not now" style={{ minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={tx('700', 14, t.colors.muted)}>Not now</RNText>
      </Pressy>
    </View>
  );

  const typeStep = (
    <View style={{ gap: 12, paddingBottom: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressy
          onPress={() => {
            setStep('ask');
            setNoProblem(false);
          }}
          label="Back"
          style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon name="back" size={22} color={t.colors.ink} />
        </Pressy>
        <RNText accessibilityRole="header" style={tx('800', 18, t.colors.ink, { flex: 1 })}>
          Type your area
        </RNText>
      </View>
      {noProblem ? <RNText style={tx('600', 13, t.colors.muted)}>No problem. Type your area instead.</RNText> : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          minHeight: 48,
          paddingHorizontal: 12,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: t.colors.line,
          backgroundColor: t.colors.surface2,
        }}
      >
        <Icon name="search" size={18} color={t.colors.muted} />
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Area or locality, e.g. Madhapur, Hyderabad"
          placeholderTextColor={t.colors.muted}
          returnKeyType="search"
          accessibilityLabel="Area or locality"
          style={tx('400', 15, t.colors.ink, { flex: 1, paddingVertical: 10 })}
        />
        {searching ? <ActivityIndicator size="small" color={t.colors.muted} /> : null}
      </View>
      {searching && results.length === 0 ? (
        <RNText style={tx('400', 13, t.colors.muted, { paddingVertical: 8 })}>Searching…</RNText>
      ) : null}
      {!searching && searched && results.length === 0 ? (
        <RNText style={tx('400', 13, t.colors.muted, { paddingVertical: 8, lineHeight: 19 })}>
          No places match. Try a nearby landmark or the city name.
        </RNText>
      ) : null}
      {results.map((p, i) => {
        const [first, ...rest] = p.label.split(',');
        const more = rest.join(',').trim();
        return (
          <FadeIn key={`${p.label}-${i}`}>
            <Pressy
              onPress={() => onPickTyped({ ...p, area: p.label })}
              label={p.label}
              style={{ minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 }}
            >
              <View style={{ width: 36, height: 36, borderRadius: 18, backgroundColor: t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="pin" size={18} color={t.colors.accent} />
              </View>
              <RNText style={{ flex: 1 }} numberOfLines={2}>
                <RNText style={tx('700', 14, t.colors.ink)}>{first}</RNText>
                {more ? <RNText style={tx('400', 14, t.colors.muted)}>{`, ${more}`}</RNText> : null}
              </RNText>
            </Pressy>
          </FadeIn>
        );
      })}
    </View>
  );

  return (
    <BottomSheet visible={visible} onClose={onClose}>
      {step === 'ask' ? askStep : typeStep}
    </BottomSheet>
  );
}
