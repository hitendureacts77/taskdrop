import { useCallback, useMemo, useRef } from 'react';
import { View, Text as RNText, Pressable, PanResponder, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, Line, G } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';

/**
 * An actual clock face for picking a time — drag the hand round, or tap a
 * number. Lists of hours and minutes are not a clock; this is what people mean
 * when they say "clock format", and it is what every phone's own time picker
 * does.
 *
 * The geometry, once, so the rest reads plainly:
 *   12 o'clock is straight up, which is -90° in screen coordinates.
 *   An hour is 30° apart, a minute 6°.
 *   Dragging converts the touch point back to an angle with atan2 and snaps it
 *   to the nearest step.
 */

const SIZE = 248;
const CENTER = SIZE / 2;
const RING = SIZE / 2 - 26; // where the numbers sit
const KNOB = 15;

type Mode = 'hour' | 'minute';

function pointOnDial(angleDeg: number, radius: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: CENTER + radius * Math.cos(rad), y: CENTER + radius * Math.sin(rad) };
}

/** Touch point -> the value it is pointing at. */
function valueFromTouch(x: number, y: number, mode: Mode): number {
  let deg = (Math.atan2(y - CENTER, x - CENTER) * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;

  if (mode === 'hour') {
    const h = Math.round(deg / 30) % 12;
    return h === 0 ? 12 : h;
  }
  // Snap minutes to 5 so the hand lands where the numbers are.
  return (Math.round(deg / 30) * 5) % 60;
}

export function ClockDial({
  hour,
  minute,
  mode,
  onChange,
  onModeChange,
}: {
  hour: number;
  minute: number;
  mode: Mode;
  onChange: (next: { hour?: number; minute?: number }) => void;
  onModeChange: (next: Mode) => void;
}) {
  const t = useTheme();

  // PanResponder is created once, so anything its handlers read must come
  // through a ref rather than a closed-over prop.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  const apply = useCallback((e: GestureResponderEvent) => {
    const { locationX, locationY } = e.nativeEvent;
    const value = valueFromTouch(locationX, locationY, modeRef.current);
    if (modeRef.current === 'hour') changeRef.current({ hour: value });
    else changeRef.current({ minute: value });
  }, []);

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: apply,
      onPanResponderMove: apply,
    }),
  ).current;

  const activeValue = mode === 'hour' ? hour : minute;
  const angle = mode === 'hour' ? (hour % 12) * 30 : minute * 6;
  const handEnd = pointOnDial(angle, RING);

  // 1..12 for hours; 00,05..55 for minutes — both sit on the same twelve marks.
  const marks = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const step = i + 1; // 1..12 clockwise from 1 o'clock
        const label = mode === 'hour' ? String(step) : String((step * 5) % 60).padStart(2, '0');
        const value = mode === 'hour' ? step : (step * 5) % 60;
        return { label, value, at: pointOnDial(step * 30, RING) };
      }),
    [mode],
  );

  return (
    <View style={{ alignItems: 'center' }}>
      {/* Tapping the hour or the minute chooses what the dial edits, exactly
          like the system pickers people already know. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 14 }}>
        <Pressable
          onPress={() => onModeChange('hour')}
          accessibilityRole="button"
          accessibilityLabel="Set the hour"
          accessibilityState={{ selected: mode === 'hour' }}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: mode === 'hour' ? t.colors.accentSoft : 'transparent',
          }}
        >
          <RNText style={tx('800', 40, mode === 'hour' ? t.colors.accentDeep : t.colors.ink, { letterSpacing: -1 })}>
            {String(hour).padStart(2, '0')}
          </RNText>
        </Pressable>

        <RNText style={tx('800', 40, t.colors.muted, { letterSpacing: -1 })}>:</RNText>

        <Pressable
          onPress={() => onModeChange('minute')}
          accessibilityRole="button"
          accessibilityLabel="Set the minutes"
          accessibilityState={{ selected: mode === 'minute' }}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 10,
            backgroundColor: mode === 'minute' ? t.colors.accentSoft : 'transparent',
          }}
        >
          <RNText
            style={tx('800', 40, mode === 'minute' ? t.colors.accentDeep : t.colors.ink, { letterSpacing: -1 })}
          >
            {String(minute).padStart(2, '0')}
          </RNText>
        </Pressable>
      </View>

      <View
        {...pan.panHandlers}
        // The whole face is the control; the numbers are decoration on top of it.
        accessibilityRole="adjustable"
        accessibilityLabel={mode === 'hour' ? 'Hour dial' : 'Minute dial'}
        accessibilityValue={{ text: String(activeValue) }}
        style={{ width: SIZE, height: SIZE }}
      >
        <Svg width={SIZE} height={SIZE}>
          <Circle cx={CENTER} cy={CENTER} r={CENTER - 2} fill={t.colors.surface2} />

          <G>
            <Line
              x1={CENTER}
              y1={CENTER}
              x2={handEnd.x}
              y2={handEnd.y}
              stroke={t.colors.accent}
              strokeWidth={2.5}
              strokeLinecap="round"
            />
            <Circle cx={CENTER} cy={CENTER} r={4.5} fill={t.colors.accent} />
            <Circle cx={handEnd.x} cy={handEnd.y} r={KNOB} fill={t.colors.accent} />
          </G>
        </Svg>

        {marks.map((m) => {
          const on = m.value === activeValue;
          return (
            <View
              key={m.label}
              // Numbers are positioned over the dial; the dial itself handles
              // the gesture, so these must not swallow touches.
              pointerEvents="none"
              style={{
                position: 'absolute',
                left: m.at.x - 15,
                top: m.at.y - 15,
                width: 30,
                height: 30,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <RNText style={tx(on ? '800' : '600', 14, on ? t.colors.onAccent : t.colors.ink)}>
                {m.label}
              </RNText>
            </View>
          );
        })}
      </View>
    </View>
  );
}
