import { useEffect, useRef, useState } from 'react';
import { Animated, Platform, Pressable, View } from 'react-native';
import { useReducedMotion } from '../../lib/motion';
import { createRotator } from '../../lib/landingRotation';
import { LandingRippleMap } from './LandingRippleMap';
import { LandingRealApp } from './LandingRealApp';

/**
 * The art area of the desktop sign-in landing: the ripple map (A) for 20 s, a crossfade to the real app (B)
 * for 20 s, and back, forever. Two small dots under it show which is on and switch on click (the click
 * restarts the 20 s wait). The wait is paused while the browser tab is hidden. Reduce Motion: no fades.
 */
const FADE_MS = 600;
const VIEWS = [
  { key: 'map', label: 'Show the ripple map', Comp: LandingRippleMap },
  { key: 'app', label: 'Show the real app', Comp: LandingRealApp },
];

export function LandingArt() {
  const reduced = useReducedMotion();
  const [idx, setIdx] = useState(0);
  const [prev, setPrev] = useState<number | null>(null);
  const mix = useRef(new Animated.Value(1)).current;
  const shown = useRef(0);
  const rot = useRef<ReturnType<typeof createRotator> | null>(null);

  const change = (i: number) => {
    if (i === shown.current) return;
    setPrev(shown.current);
    shown.current = i;
    setIdx(i);
  };
  const changeRef = useRef(change);
  changeRef.current = change;

  useEffect(() => {
    const r = createRotator({ count: VIEWS.length, onChange: (i) => changeRef.current(i) });
    rot.current = r;
    r.start();
    const onVis = () => {
      if (typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') r.pause();
      else r.resume();
    };
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVis);
      onVis();
    }
    return () => {
      r.stop();
      if (Platform.OS === 'web' && typeof document !== 'undefined') document.removeEventListener('visibilitychange', onVis);
    };
  }, []);

  // Crossfade whenever the shown view changes; the old one is unmounted when the fade ends.
  useEffect(() => {
    if (prev === null) return;
    if (reduced) {
      mix.setValue(1);
      setPrev(null);
      return;
    }
    mix.setValue(0);
    const a = Animated.timing(mix, { toValue: 1, duration: FADE_MS, useNativeDriver: Platform.OS !== 'web' });
    a.start(({ finished }) => {
      if (finished) setPrev(null);
    });
    return () => a.stop();
  }, [idx, prev, reduced, mix]);

  const Cur = VIEWS[idx].Comp;
  const Old = prev !== null ? VIEWS[prev].Comp : null;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View style={{ flex: 1, minHeight: 0 }}>
        {Old && (
          <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, opacity: mix.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
            <Old />
          </Animated.View>
        )}
        <Animated.View
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{ flex: 1, minHeight: 0, opacity: Old ? mix : 1 }}
        >
          <Cur />
        </Animated.View>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 2, marginTop: 4 }}>
        {VIEWS.map((v, i) => (
          <Pressable
            key={v.key}
            accessibilityRole="button"
            accessibilityLabel={v.label}
            accessibilityState={{ selected: i === idx }}
            onPress={() => rot.current?.select(i)}
            hitSlop={6}
            style={{ paddingHorizontal: 6, paddingVertical: 6 }}
          >
            <View
              style={{
                width: i === idx ? 20 : 8,
                height: 8,
                borderRadius: 4,
                backgroundColor: i === idx ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
              }}
            />
          </Pressable>
        ))}
      </View>
    </View>
  );
}
