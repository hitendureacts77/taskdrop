import { useContext, useEffect, useRef } from 'react';
import { View, Text as RNText, Pressable, Animated, Easing } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';
import { useNav } from '../providers/NavProvider';
import { TopInsetUsedCtx } from '../components/topInsetUsed';
import { tx } from '../components/primitives';
import { dark } from '../theme';
import { useReducedMotion } from '../lib/motion';

/** Every edge but the top, for when the staging ribbon or a banner has already used the status-bar gap. */
const SIDES_AND_BOTTOM: Edge[] = ['right', 'bottom', 'left'];

/** The four rings the drop sends out, from the design's splash (ST01). */
const RINGS = [
  { size: 180, width: 2.5, alpha: 0.85 },
  { size: 300, width: 2, alpha: 0.6 },
  { size: 440, width: 1.5, alpha: 0.38 },
  { size: 600, width: 1, alpha: 0.22 },
];

/**
 * A value that follows an easing curve over a stretch of the clock. The
 * native driver rejects `easing` inside an interpolation, so the curve is laid
 * out as many straight segments instead.
 */
function eased(from: number, to: number, start: number, end: number, easing: (n: number) => number, steps = 12) {
  const inputRange: number[] = [];
  const outputRange: number[] = [];
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    inputRange.push(start + (end - start) * p);
    outputRange.push(from + (to - from) * easing(p));
  }
  return { inputRange, outputRange, extrapolate: 'clamp' as const };
}

/** Milliseconds, on one clock: the drop lands at 1000 and the rings go out. */
const LAND = 1000;
const RING_STEP = 220;

/**
 * The splash (SYS-Motion "The drop"): the drop falls for a second, squashes
 * on impact, glows, and four rings spread out at 220 ms steps; the wordmark
 * and tagline rise in after it. The splash is always the dark brand ground,
 * as the app opens in dark. Reduce Motion shows the still mark instead.
 */
export function SplashScreen() {
  const { reset } = useNav();
  const reduced = useReducedMotion();
  const topUsed = useContext(TopInsetUsedCtx);

  const clock = useRef(new Animated.Value(0)).current;
  const fallY = useRef(new Animated.Value(-300)).current;
  const sx = useRef(new Animated.Value(0.86)).current;
  const sy = useRef(new Animated.Value(1.14)).current;

  useEffect(() => {
    if (reduced) {
      clock.setValue(4000);
      fallY.setValue(0);
      sx.setValue(1);
      sy.setValue(1);
      return;
    }
    const t = (v: Animated.Value, toValue: number, duration: number, easing = Easing.bezier(0.2, 0.8, 0.3, 1)) =>
      Animated.timing(v, { toValue, duration, easing, useNativeDriver: true });
    const fall = Animated.sequence([
      Animated.parallel([
        t(fallY, 0, LAND, Easing.bezier(0.55, 0, 1, 0.45)),
        t(sy, 1.16, LAND, Easing.linear),
      ]),
      // Impact: wide and flat, then a little rebound, then still.
      Animated.parallel([t(fallY, 5, 250), t(sx, 1.16, 250), t(sy, 0.82, 250)]),
      Animated.parallel([t(fallY, -3, 350), t(sx, 0.97, 350), t(sy, 1.04, 350)]),
      Animated.parallel([t(fallY, 0, 400), t(sx, 1, 400), t(sy, 1, 400)]),
    ]);
    const time = Animated.timing(clock, { toValue: 4000, duration: 4000, easing: Easing.linear, useNativeDriver: true });
    fall.start();
    time.start();
    return () => {
      fall.stop();
      time.stop();
    };
  }, [reduced, clock, fallY, sx, sy]);

  // The design continues on tap, but a splash with no affordance reads as a
  // hung app -- so move on once the drop has landed and the rings are out.
  // Tapping still skips ahead.
  useEffect(() => {
    const id = setTimeout(() => reset('welcome'), 2600);
    return () => clearTimeout(id);
  }, [reset]);

  const ringEase = Easing.bezier(0.15, 0.6, 0.3, 1);
  const riseEase = Easing.bezier(0.2, 0.8, 0.2, 1);
  const rise = (at: number) => ({
    opacity: clock.interpolate({ inputRange: [at, at + 600], outputRange: [0, 1], extrapolate: 'clamp' }),
    transform: [{ translateY: clock.interpolate(eased(12, 0, at, at + 600, riseEase)) }],
  });

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: dark.bg }} edges={topUsed ? SIDES_AND_BOTTOM : undefined}>
      <Pressable onPress={() => reset('welcome')} style={{ flex: 1, overflow: 'hidden' }} accessibilityLabel="Continue">
        {/* The stage: everything is centred on the point where the drop lands. */}
        <View pointerEvents="none" style={{ position: 'absolute', left: '50%', top: '45%', width: 0, height: 0 }}>
          {/* The glow of the splash. */}
          <Animated.View
            style={{
              position: 'absolute',
              left: -130,
              top: -130,
              width: 260,
              height: 260,
              borderRadius: 999,
              backgroundColor: dark.accent,
              opacity: clock.interpolate({
                inputRange: [LAND - 50, LAND + 50, 2500],
                outputRange: [0, 0.22, 0],
                extrapolate: 'clamp',
              }),
              transform: [
                { scale: clock.interpolate(eased(0.2, 1, LAND - 50, 2500, ringEase)) },
              ],
            }}
          />
          {RINGS.map((r, i) => {
            const start = LAND - 50 + i * RING_STEP;
            return (
              <Animated.View
                key={r.size}
                style={{
                  position: 'absolute',
                  left: -r.size / 2,
                  top: -r.size / 2,
                  width: r.size,
                  height: r.size,
                  borderRadius: 999,
                  borderWidth: r.width,
                  borderColor: dark.accent,
                  opacity: clock.interpolate({
                    inputRange: [start, start + 200, start + 2800],
                    outputRange: [0, r.alpha, 0],
                    extrapolate: 'clamp',
                  }),
                  transform: [
                    { scale: clock.interpolate(eased(0.15, 1, start, start + 2800, ringEase)) },
                  ],
                }}
              />
            );
          })}
          {/* The drop, squashing from its base as it lands. Drawn large and as a vector so it stays crisp. */}
          <Animated.View
            style={{
              position: 'absolute',
              left: -66,
              top: -66,
              width: 132,
              height: 132,
              opacity: fallY.interpolate({ inputRange: [-300, -260, 0], outputRange: [0, 1, 1] }),
              transform: [{ translateY: 62 }, { translateY: fallY }, { scaleX: sx }, { scaleY: sy }, { translateY: -62 }],
            }}
          >
            <Svg width={132} height={132} viewBox="0 0 100 100">
              <Path d="M50 5C62 22 82 40 82 62A32 32 0 0 1 18 62C18 40 38 22 50 5Z" fill={dark.accent} />
              <Path d="M29 62c0-11 5-20 12-28" fill="none" stroke="#FFFFFF" strokeOpacity={0.35} strokeWidth={4} strokeLinecap="round" />
              <Path
                d="M36 63l9 9 19-21"
                fill="none"
                stroke={dark.bg}
                strokeWidth={7.5}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>
        </View>

        <Animated.View style={[{ position: 'absolute', left: 0, right: 0, top: '45%', marginTop: 104, alignItems: 'center' }, rise(900)]}>
          <RNText style={tx('800', 48, dark.ink, { letterSpacing: -2 })}>
            taskdrop<RNText style={{ color: dark.accent }}>.</RNText>
          </RNText>
        </Animated.View>

        <Animated.View style={[{ position: 'absolute', left: 24, right: 24, bottom: 64, alignItems: 'center' }, rise(1200)]}>
          <RNText style={tx('400', 15, dark.muted, { textAlign: 'center' })}>Ask for anything. Someone gets it done for you.</RNText>
        </Animated.View>
      </Pressable>
    </SafeAreaView>
  );
}
