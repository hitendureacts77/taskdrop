import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, PanResponder, Animated, Easing, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Line } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';
import { tx } from './primitives';
import {
  MINUTES,
  MINUTE_STEP,
  from24,
  isTimeAllowed,
  nearestAllowedMinute,
  pointToHour,
  pointToMinute,
  polar,
  to24,
  type TimeLimits,
} from '../lib/clockTime';

/**
 * A clock face for picking a time (plan 1.21 B): tap or drag the hour on the
 * dial, then the minute in 5-minute steps, with AM or PM beside it. Works with
 * touch, mouse and keyboard (arrow keys on the dial). It paints in the theme's
 * accent, so it is jade on the Hire side and blue on the Earn side.
 */

const MAX_SIZE = 248;

export function ClockFace({
  day,
  h24,
  minute,
  limits,
  onChange,
  onRejected,
}: {
  /** The day the time belongs to; only used to tell which times are already gone. */
  day: Date;
  h24: number;
  minute: number;
  limits?: TimeLimits;
  onChange: (h24: number, minute: number) => void;
  /** Called with a short reason when a tap lands on a time that is not allowed. */
  onRejected?: (msg: string) => void;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<'hour' | 'minute'>('hour');
  const [width, setWidth] = useState(MAX_SIZE);
  const size = Math.max(180, Math.min(MAX_SIZE, width));
  const c = size / 2;
  const { h12, pm } = from24(h24);

  // Always read the latest props inside the gesture handlers.
  const live = useRef({ day, h24, minute, limits, mode, size, onChange, onRejected });
  live.current = { day, h24, minute, limits, mode, size, onChange, onRejected };

  const ok = (h: number, m: number) => isTimeAllowed(day, h, m, limits);
  const hourOpen = (h: number) => MINUTES.some((m) => ok(h, m));

  const chooseHour = (h: number, final: boolean) => {
    const L = live.current;
    const nh = to24(h, from24(L.h24).pm);
    const nm = nearestAllowedMinute(L.day, nh, L.minute, L.limits);
    if (nm === null) {
      if (final) L.onRejected?.('That hour has already gone by.');
      return;
    }
    L.onChange(nh, nm);
    if (final) setMode('minute');
  };
  const chooseMinute = (m: number, final: boolean) => {
    const L = live.current;
    if (!isTimeAllowed(L.day, L.h24, m, L.limits)) {
      if (final) L.onRejected?.('That time has already gone by.');
      return;
    }
    L.onChange(L.h24, m);
  };

  const touch = (x: number, y: number, final: boolean) => {
    const L = live.current;
    const cc = L.size / 2;
    if (L.mode === 'hour') chooseHour(pointToHour(x, y, cc, cc), final);
    else chooseMinute(pointToMinute(x, y, cc, cc), final);
  };

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: (e) => touch(e.nativeEvent.locationX, e.nativeEvent.locationY, false),
        onPanResponderMove: (e) => touch(e.nativeEvent.locationX, e.nativeEvent.locationY, false),
        onPanResponderRelease: (e) => touch(e.nativeEvent.locationX, e.nativeEvent.locationY, true),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const toggleAmPm = (wantPm: boolean) => {
    if (wantPm === pm) return;
    const nh = to24(h12, wantPm);
    const nm = nearestAllowedMinute(day, nh, minute, limits);
    if (nm === null) {
      onRejected?.('That time has already gone by.');
      return;
    }
    onChange(nh, nm);
  };

  // Keyboard on the dial: arrows step the hour or the minute, Enter moves on.
  const step = (dir: 1 | -1) => {
    if (mode === 'hour') {
      let h = h12;
      for (let i = 0; i < 12; i++) {
        h = ((h - 1 + dir + 12) % 12) + 1;
        if (hourOpen(to24(h, pm))) {
          chooseHour(h, false);
          return;
        }
      }
    } else {
      const idx = Math.max(0, MINUTES.indexOf(minute));
      for (let i = 1; i <= MINUTES.length; i++) {
        const m = MINUTES[(((idx + dir * i) % MINUTES.length) + MINUTES.length) % MINUTES.length]!;
        if (ok(h24, m)) {
          onChange(h24, m);
          return;
        }
      }
    }
  };
  const onKeyDown = (e: { key: string; preventDefault?: () => void }) => {
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') step(1);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') step(-1);
    else if (e.key === 'Enter' || e.key === ' ') setMode((m) => (m === 'hour' ? 'minute' : 'hour'));
    else return;
    e.preventDefault?.();
  };

  // The hand glides to a new place; with reduced motion it just jumps.
  const handValue = mode === 'hour' ? h12 % 12 : minute / MINUTE_STEP;
  const handCount = mode === 'hour' ? 12 : MINUTES.length;
  const angle = useRef(new Animated.Value((handValue / handCount) * 360)).current;
  const lastAngle = useRef((handValue / handCount) * 360);
  useEffect(() => {
    let target = (handValue / handCount) * 360;
    // Take the short way round the dial.
    const diff = ((((target - lastAngle.current) % 360) + 540) % 360) - 180;
    target = lastAngle.current + diff;
    lastAngle.current = target;
    if (reduced) {
      angle.setValue(target);
      return;
    }
    const anim = Animated.timing(angle, { toValue: target, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true });
    anim.start();
    return () => anim.stop();
  }, [handValue, handCount, reduced, angle]);
  const rotate = angle.interpolate({ inputRange: [-3600, 3600], outputRange: ['-3600deg', '3600deg'] });

  const ringR = c - 22;
  const labels = mode === 'hour' ? Array.from({ length: 12 }, (_, i) => (i === 0 ? 12 : i)) : MINUTES;
  const selectedLabel = mode === 'hour' ? h12 : minute;
  const handEnd = polar(handValue, handCount, ringR, c, c);

  const seg = (label: string, on: boolean, onPress: () => void, a11y: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      accessibilityState={{ selected: on }}
      style={{
        minWidth: 64,
        minHeight: 52,
        paddingHorizontal: 10,
        borderRadius: 12,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? t.colors.accentSoft : t.colors.surface2,
        borderWidth: on ? 1.5 : 1,
        borderColor: on ? t.colors.accent : t.colors.line,
      }}
    >
      <RNText style={tx('800', 28, on ? t.colors.accentDeep : t.colors.ink, { fontVariant: ['tabular-nums'] })}>{label}</RNText>
    </Pressable>
  );
  const ampm = (label: string, on: boolean, wantPm: boolean) => (
    <Pressable
      onPress={() => toggleAmPm(wantPm)}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: on }}
      style={{
        minHeight: 24,
        flex: 1,
        borderRadius: 10,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: on ? t.colors.btn : t.colors.surface2,
        borderWidth: 1,
        borderColor: on ? t.colors.btn : t.colors.line,
      }}
    >
      <RNText style={tx('700', 13, on ? t.colors.onAccent : t.colors.muted)}>{label}</RNText>
    </Pressable>
  );

  return (
    <View style={{ alignItems: 'center' }} onLayout={(e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width)}>
      {/* The reading: hour : minute and AM / PM. Tap either number to switch the dial. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        {seg(String(h12), mode === 'hour', () => setMode('hour'), `Hour ${h12}. Tap to change the hour`)}
        <RNText style={tx('800', 28, t.colors.muted)}>:</RNText>
        {seg(String(minute).padStart(2, '0'), mode === 'minute', () => setMode('minute'), `Minute ${minute}. Tap to change the minute`)}
        <View style={{ gap: 6, marginLeft: 6, width: 56, height: 52 }}>
          {ampm('AM', !pm, false)}
          {ampm('PM', pm, true)}
        </View>
      </View>

      <RNText style={tx('500', 12, t.colors.muted, { marginTop: 10 })}>
        {mode === 'hour' ? 'Tap or drag to the hour' : 'Now the minute (steps of 5)'}
      </RNText>

      {/* The dial. This layer takes the touches; everything inside ignores them so the position is exact. */}
      <View
        {...pan.panHandlers}
        {...({ onKeyDown, tabIndex: 0 } as object)}
        focusable
        accessible
        accessibilityRole="adjustable"
        accessibilityLabel={mode === 'hour' ? `Hour dial, ${h12}` : `Minute dial, ${minute}`}
        accessibilityValue={{ text: `${h12}:${String(minute).padStart(2, '0')} ${pm ? 'PM' : 'AM'}` }}
        accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
        onAccessibilityAction={(e) => step(e.nativeEvent.actionName === 'increment' ? 1 : -1)}
        style={{ width: size, height: size, marginTop: 8, borderRadius: size / 2, backgroundColor: t.colors.surface2 }}
      >
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: size, height: size }}>
          <Svg width={size} height={size}>
            <Circle cx={c} cy={c} r={c - 1} fill="none" stroke={t.colors.line} strokeWidth={1} />
            {reduced ? <Line x1={c} y1={c} x2={handEnd.x} y2={handEnd.y} stroke={t.colors.accent} strokeWidth={2} /> : null}
            <Circle cx={c} cy={c} r={4} fill={t.colors.accent} />
          </Svg>
          {!reduced ? (
            <>
              {/* The hand and its knob turn about the middle of the dial. */}
              <Animated.View
                style={{
                  position: 'absolute',
                  left: c - 1,
                  top: c - ringR,
                  width: 2,
                  height: ringR,
                  backgroundColor: t.colors.accent,
                  transform: [{ translateY: ringR / 2 }, { rotate }, { translateY: -ringR / 2 }],
                }}
              />
              <Animated.View
                style={{
                  position: 'absolute',
                  left: c - 19,
                  top: c - ringR - 19,
                  width: 38,
                  height: 38,
                  borderRadius: 19,
                  backgroundColor: t.colors.accent,
                  transform: [{ translateY: ringR }, { rotate }, { translateY: -ringR }],
                }}
              />
            </>
          ) : (
            <View
              style={{ position: 'absolute', left: handEnd.x - 19, top: handEnd.y - 19, width: 38, height: 38, borderRadius: 19, backgroundColor: t.colors.accent }}
            />
          )}
          {labels.map((v, i) => {
            const idx = mode === 'hour' ? v % 12 : i;
            const p = polar(idx, handCount, ringR, c, c);
            const on = v === selectedLabel;
            const open = mode === 'hour' ? hourOpen(to24(v, pm)) : ok(h24, v);
            return (
              <View
                key={`${mode}${v}`}
                style={{ position: 'absolute', left: p.x - 19, top: p.y - 19, width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}
              >
                <RNText
                  style={tx(on ? '800' : '600', 15, on ? t.colors.onAccent : t.colors.ink, {
                    opacity: open ? 1 : 0.3,
                    fontVariant: ['tabular-nums'],
                  })}
                >
                  {mode === 'minute' ? String(v).padStart(2, '0') : v}
                </RNText>
              </View>
            );
          })}
        </View>
      </View>
    </View>
  );
}
