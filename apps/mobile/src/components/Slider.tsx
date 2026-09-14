import { useRef, useState } from 'react';
import { View, PanResponder, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';

/**
 * A slider you can actually move.
 *
 * The one this replaces was a drawing: a filled bar hard-coded to 58% with a
 * circle sitting on top of it and the words "12 km" written underneath. It
 * could not be dragged and nothing read it.
 *
 * The thumb is positioned from `value` rather than from gesture state, so the
 * control has one source of truth and a parent that clamps or rounds the value
 * sees the thumb follow. Track width is measured rather than assumed, because
 * the screen it sits on is padded differently at each breakpoint.
 */
export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  accessibilityLabel,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  const [width, setWidth] = useState(0);

  // A drag reads these every frame; the PanResponder is built once and would
  // otherwise close over the first render's values forever.
  const widthRef = useRef(0);
  widthRef.current = width;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const fraction = max === min ? 0 : (value - min) / (max - min);
  const clamped = Math.min(1, Math.max(0, fraction));

  const emitFor = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const f = Math.min(1, Math.max(0, x / w));
    const raw = min + f * (max - min);
    const snapped = Math.round(raw / step) * step;
    onChangeRef.current(Math.min(max, Math.max(min, snapped)));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // An ancestor ScrollView must not steal a sideways drag on the track.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      // Tapping anywhere on the track jumps there, which is what people expect
      // and what makes the control usable without a precise drag.
      onPanResponderGrant: (e) => emitFor(e.nativeEvent.locationX),
      onPanResponderMove: (e) => emitFor(e.nativeEvent.locationX),
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setWidth(Math.round(e.nativeEvent.layout.width));

  return (
    <View
      {...pan.panHandlers}
      onLayout={onLayout}
      accessibilityRole="adjustable"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min, max, now: value }}
      // Generous vertical padding: the visible track is 3px, which is far
      // below a usable touch target on its own.
      style={{ paddingVertical: 14, marginTop: 2 }}
    >
      <View style={{ height: 3, backgroundColor: t.colors.line, borderRadius: 2 }}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${clamped * 100}%`,
            backgroundColor: t.colors.accent,
            borderRadius: 2,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${clamped * 100}%`,
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
    </View>
  );
}
