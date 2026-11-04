import { useEffect, useRef } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';

/** A drag this long (px) moves the sheet to its other height. */
const FLICK = 40;

/**
 * The phone map's one bottom sheet (plan D14). It rests low, showing a short
 * summary over the map, or pulled up, showing the whole list with the map still
 * peeking above. Drag or tap the handle to move it; it springs between the two.
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

  useEffect(() => {
    const to = up ? high : low;
    if (reduced) Animated.timing(height, { toValue: to, duration: 120, useNativeDriver: false }).start();
    else Animated.spring(height, { toValue: to, damping: 22, stiffness: 220, mass: 0.9, useNativeDriver: false }).start();
  }, [up, low, high, reduced, height]);

  // The handler is made once, so it reads the latest values through refs.
  const state = useRef({ up, onChange });
  state.current = { up, onChange };
  const drag = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_e, g) => {
        const { up: isUp, onChange: change } = state.current;
        if (g.dy < -FLICK && !isUp) change(true);
        else if (g.dy > FLICK && isUp) change(false);
      },
    }),
  ).current;

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
      <View {...drag.panHandlers}>
        <Pressable
          onPress={() => onChange(!up)}
          accessibilityRole="button"
          accessibilityLabel={up ? 'Show more of the map' : 'Pull up for the list'}
          style={{ alignSelf: 'center', width: 80, height: 24, alignItems: 'center', justifyContent: 'center' }}
        >
          <View style={{ width: 40, height: 5, borderRadius: 3, backgroundColor: t.colors.line }} />
        </Pressable>
        {header}
      </View>
      <View style={{ flex: 1 }}>{children}</View>
    </Animated.View>
  );
}
