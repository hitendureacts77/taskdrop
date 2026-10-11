import { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text as RNText, View } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useMode } from '../providers/ModeProvider';
import { useSwitchMode } from '../lib/useSwitchMode';
import { useReducedMotion } from '../lib/motion';
import { tx } from './primitives';

const MODES = ['poster', 'worker'] as const;

/**
 * The Hire / Earn switch (SYS-Motion "Mode switch"): the knob glides under
 * the chosen side with a little overshoot and takes that side's colour --
 * deep jade for Hire, blue for Earn. `full` stretches it to its container
 * (the desktop side menu); `stacked` is the tablet rail's vertical version.
 */
export function ModeSwitch({ full = false, stacked = false }: { full?: boolean; stacked?: boolean }) {
  const t = useTheme();
  const { mode } = useMode();
  const switchMode = useSwitchMode();
  const reduced = useReducedMotion();
  const index = mode === 'worker' ? 1 : 0;
  const [size, setSize] = useState({ w: 0, h: 0 });
  const pos = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    if (reduced) {
      pos.setValue(index);
      return;
    }
    const anim = Animated.spring(pos, { toValue: index, useNativeDriver: true, friction: 7, tension: 120 });
    anim.start();
    return () => anim.stop();
  }, [index, pos, reduced]);

  const pad = stacked ? 4 : 3;
  const slotW = stacked ? size.w - pad * 2 : (size.w - pad * 2) / 2;
  const slotH = stacked ? (size.h - pad * 2) / 2 : size.h - pad * 2;

  return (
    <View
      onLayout={(e) => setSize({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
      accessibilityRole="tablist"
      style={{
        flexDirection: stacked ? 'column' : 'row',
        backgroundColor: t.colors.surface2,
        borderRadius: stacked ? 14 : 999,
        padding: pad,
        alignSelf: full || stacked ? 'stretch' : 'flex-start',
      }}
    >
      {size.w > 0 ? (
        <Animated.View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: pad,
            top: pad,
            width: slotW,
            height: slotH,
            borderRadius: stacked ? 10 : 999,
            backgroundColor: t.colors.btn,
            transform: stacked
              ? [{ translateY: pos.interpolate({ inputRange: [0, 1], outputRange: [0, slotH] }) }]
              : [{ translateX: pos.interpolate({ inputRange: [0, 1], outputRange: [0, slotW] }) }],
          }}
        />
      ) : null}
      {MODES.map((m) => {
        const on = mode === m;
        const label = m === 'poster' ? 'Hire' : 'Earn';
        return (
          <Pressable
            key={m}
            onPress={() => void switchMode(m)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={m === 'poster' ? 'Hire mode' : 'Earn mode'}
            style={{
              flex: full || stacked ? 1 : undefined,
              alignItems: 'center',
              justifyContent: 'center',
              paddingVertical: stacked ? 7 : full ? 9 : 6,
              paddingHorizontal: stacked ? 6 : full ? 13 : 0,
              // Equal halves, so the knob always fits the word under it.
              width: !full && !stacked ? 54 : undefined,
              minWidth: stacked ? 44 : undefined,
            }}
          >
            <RNText style={tx(stacked ? '800' : '700', stacked ? 11 : full ? 13 : 12, on ? t.colors.onBtn : t.colors.muted)}>
              {label}
            </RNText>
          </Pressable>
        );
      })}
    </View>
  );
}
