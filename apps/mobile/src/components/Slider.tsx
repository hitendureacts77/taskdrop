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
  // otherwise close over the first render's values forever (the budget slider
  // stopped at its first maximum because of this).
  const widthRef = useRef(0);
  widthRef.current = width;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const rangeRef = useRef({ min, max, step });
  rangeRef.current = { min, max, step };
  // Where the finger came down, so the drag follows it from there.
  const startX = useRef(0);

  const fraction = max === min ? 0 : (value - min) / (max - min);
  const clamped = Math.min(1, Math.max(0, fraction));

  const emitFor = (x: number) => {
    const w = widthRef.current;
    if (w <= 0) return;
    const r = rangeRef.current;
    const f = Math.min(1, Math.max(0, x / w));
    const raw = r.min + f * (r.max - r.min);
    const snapped = Math.round(raw / r.step) * r.step;
    onChangeRef.current(Math.min(r.max, Math.max(r.min, snapped)));
  };

  // Only a sideways drag moves the value. A touch that lands on the track
  // while scrolling the page, or a tap, leaves it alone (owner, 2026-10-30:
  // the price changed by accident while scrolling).
  const sideways = (dx: number, dy: number) => Math.abs(dx) > 6 && Math.abs(dx) > Math.abs(dy) * 1.5;

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_e, g) => sideways(g.dx, g.dy),
      onMoveShouldSetPanResponderCapture: (_e, g) => sideways(g.dx, g.dy),
      // Once a sideways drag has started, an ancestor ScrollView must not steal it.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: (e, g) => {
        startX.current = e.nativeEvent.locationX - g.dx;
        emitFor(startX.current + g.dx);
      },
      onPanResponderMove: (_e, g) => emitFor(startX.current + g.dx),
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
      <View style={{ height: 6, backgroundColor: t.colors.surface2, borderRadius: 6 }}>
        <View
          style={{
            position: 'absolute',
            left: 0,
            top: 0,
            bottom: 0,
            width: `${clamped * 100}%`,
            backgroundColor: t.colors.accent,
            borderRadius: 6,
          }}
        />
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: `${clamped * 100}%`,
            top: -8,
            width: 22,
            height: 22,
            marginLeft: -11,
            borderRadius: 999,
            backgroundColor: t.colors.surface,
            borderWidth: 2,
            borderColor: t.colors.accent,
            shadowColor: t.colors.shadow,
            shadowOpacity: 0.18,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 3 },
            elevation: 3,
          }}
        />
      </View>
    </View>
  );
}
