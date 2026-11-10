import { useEffect, useRef } from 'react';
import { Animated, PanResponder, Platform, Pressable, View, type ViewInstance } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';

/** A drag this long (px), or a quick flick, moves the sheet to its other height. */
const FLICK = 40;
const FLICK_SPEED = 0.5;
/** One wheel turn moves the sheet once; more turns inside this time are ignored. */
const WHEEL_PAUSE_MS = 600;

/**
 * The phone map's one bottom sheet (plans D14, D24). It rests low as a slim bar so the map
 * fills the screen (owner video, 10 Nov), or pulled up, showing the whole list with the map
 * still peeking above. While low the whole bar can be dragged, tapped or scrolled (mouse wheel
 * or trackpad on the web) to pull the list up; pulled up, the handle and header drag it back
 * down. The sheet follows the finger and springs to the nearer height.
 */
export function MapSheet({
  up,
  onChange,
  low,
  high,
  bottomInset,
  header,
  children,
}: {
  /** Drawn under the handle; dragging it moves the sheet too. */
  header?: React.ReactNode;
  up: boolean;
  onChange: (up: boolean) => void;
  /** Its height resting low and pulled up. */
  low: number;
  high: number;
  bottomInset: number;
  children: React.ReactNode;
}) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const height = useRef(new Animated.Value(up ? high : low)).current;

  const settle = (to: number) => {
    if (reduced) Animated.timing(height, { toValue: to, duration: 120, useNativeDriver: false }).start();
    else Animated.spring(height, { toValue: to, damping: 22, stiffness: 220, mass: 0.9, useNativeDriver: false }).start();
  };
  useEffect(() => {
    settle(up ? high : low);
    // `settle` only reads `reduced`, which is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [up, low, high, reduced]);

  // The handlers are made once, so they read the latest values through refs.
  const state = useRef({ up, onChange, low, high, settle });
  state.current = { up, onChange, low, high, settle };
  const drag = useRef(
    (() => {
      const wants = (_e: unknown, g: { dx: number; dy: number }) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx);
      return PanResponder.create({
        onMoveShouldSetPanResponder: wants,
        // Taken before a button under the finger: a tap still taps, a drag always moves the sheet.
        onMoveShouldSetPanResponderCapture: wants,
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_e, g) => {
          const s = state.current;
          const from = s.up ? s.high : s.low;
          height.setValue(Math.min(s.high, Math.max(s.low, from - g.dy)));
        },
        onPanResponderRelease: (_e, g) => {
          const s = state.current;
          const toUp = s.up ? !(g.dy > FLICK || g.vy > FLICK_SPEED) : g.dy < -FLICK || g.vy < -FLICK_SPEED;
          if (toUp !== s.up) s.onChange(toUp);
          // Same state: spring back to where it rests.
          else s.settle(s.up ? s.high : s.low);
        },
        onPanResponderTerminate: () => {
          const s = state.current;
          s.settle(s.up ? s.high : s.low);
        },
      });
    })(),
  ).current;

  // Web: the mouse wheel or a trackpad swipe over the low bar pulls the list up; over the handle
  // or header of the pulled-up sheet, scrolling up folds it back down. The list itself scrolls as usual.
  const box = useRef<ViewInstance>(null);
  const head = useRef<ViewInstance>(null);
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = box.current as unknown as HTMLElement | null;
    if (!el || typeof el.addEventListener !== 'function') return;
    let last = 0;
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || Math.abs(e.deltaY) < 8) return;
      const s = state.current;
      const top = head.current as unknown as HTMLElement | null;
      const onHead = Boolean(top && e.target instanceof Node && top.contains(e.target));
      if (s.up && !(onHead && e.deltaY < 0)) return;
      e.preventDefault();
      if (Date.now() - last < WHEEL_PAUSE_MS) return;
      last = Date.now();
      s.onChange(!s.up);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handle = (
    <Pressable
      onPress={() => onChange(!up)}
      accessibilityRole="button"
      accessibilityLabel={up ? 'Show more of the map' : 'Pull up for the list'}
      style={{ alignSelf: 'center', width: 96, height: 22, alignItems: 'center', justifyContent: 'center' }}
    >
      <View style={{ width: 44, height: 5, borderRadius: 3, backgroundColor: t.colors.muted, opacity: 0.45 }} />
    </Pressable>
  );

  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        height: Animated.add(height, bottomInset),
        borderTopLeftRadius: 28,
        borderTopRightRadius: 28,
        backgroundColor: t.colors.surface,
        borderTopWidth: 1,
        borderColor: t.colors.line,
        paddingBottom: bottomInset,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOpacity: 0.25,
        shadowRadius: 24,
        shadowOffset: { width: 0, height: -8 },
        elevation: 12,
      }}
    >
      <View ref={box} collapsable={false} style={{ flex: 1 }}>
        {up ? (
          <>
            <View ref={head} collapsable={false} {...drag.panHandlers}>
              {handle}
              {header}
            </View>
            <View style={{ flex: 1 }}>{children}</View>
          </>
        ) : (
          // Low: the whole bar is the drag area.
          <View ref={head} collapsable={false} style={{ flex: 1 }} {...drag.panHandlers}>
            {handle}
            {header}
            <View style={{ flex: 1 }}>{children}</View>
          </View>
        )}
      </View>
    </Animated.View>
  );
}
