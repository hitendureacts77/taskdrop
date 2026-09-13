import { useEffect, useRef } from 'react';
import { View, Text as RNText, Animated, Easing, StyleSheet } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { useApp } from '../providers/AppStateProvider';
import { useTheme } from '../providers/ThemeProvider';
import { fontFamilyFor } from '../theme';

/**
 * Global toast + success burst — pixel parity with
 * docs/design/_design_markup.html lines 1132-1153 (tdRing ring pulse, tdPop
 * circle, tdDraw checkmark, and the tdUp toast).
 */

const AnimatedPath = Animated.createAnimatedComponent(Path);

export function Overlays() {
  const { toast, burst } = useApp();
  const t = useTheme();

  const toastY = useRef(new Animated.Value(26)).current;
  const toastO = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const draw = useRef(new Animated.Value(60)).current;

  useEffect(() => {
    const o = Animated.timing(toastO, { toValue: toast ? 1 : 0, duration: 220, useNativeDriver: true });
    const y = Animated.timing(toastY, {
      toValue: toast ? 0 : 26,
      duration: 300,
      easing: Easing.bezier(0.2, 0.8, 0.25, 1),
      useNativeDriver: true,
    });
    o.start();
    y.start();
    return () => {
      o.stop();
      y.stop();
    };
  }, [toast, toastO, toastY]);

  useEffect(() => {
    if (!burst) return;
    pop.setValue(0);
    ring.setValue(0);
    draw.setValue(60);
    const a = Animated.timing(pop, { toValue: 1, duration: 420, useNativeDriver: true });
    const b = Animated.timing(ring, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true });
    const c = Animated.timing(draw, { toValue: 0, duration: 450, delay: 160, useNativeDriver: false });
    a.start();
    b.start();
    c.start();
    return () => {
      a.stop();
      b.stop();
      c.stop();
    };
  }, [burst, pop, ring, draw]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {burst && (
        <View
          style={[
            StyleSheet.absoluteFill,
            { alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.32)' },
          ]}
        >
          <View style={{ width: 118, height: 118, alignItems: 'center', justifyContent: 'center' }}>
            <Animated.View
              style={{
                position: 'absolute',
                width: 118,
                height: 118,
                borderRadius: 999,
                borderWidth: 2,
                borderColor: t.colors.accent,
                opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0] }),
                transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.8, 1.7] }) }],
              }}
            />
            <Animated.View
              style={{
                width: 82,
                height: 82,
                borderRadius: 999,
                backgroundColor: t.colors.accent,
                alignItems: 'center',
                justifyContent: 'center',
                shadowColor: t.colors.accent,
                shadowOpacity: 0.4,
                shadowRadius: 30,
                shadowOffset: { width: 0, height: 10 },
                elevation: 8,
                opacity: pop,
                transform: [{ scale: pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.6, 1.08, 1] }) }],
              }}
            >
              <Svg width={38} height={38} viewBox="0 0 24 24" fill="none">
                <AnimatedPath
                  d="m6 12.4 3.6 3.6L18 7.6"
                  stroke={t.colors.onAccent}
                  strokeWidth={2.4}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={60}
                  strokeDashoffset={draw}
                />
              </Svg>
            </Animated.View>
          </View>
        </View>
      )}

      {!!toast && (
        <Animated.View
          style={{
            position: 'absolute',
            left: 16,
            right: 16,
            bottom: 96,
            backgroundColor: t.isDark ? '#F1F1F1' : '#16171A',
            borderRadius: 14,
            paddingVertical: 14,
            paddingHorizontal: 16,
            opacity: toastO,
            transform: [{ translateY: toastY }],
            shadowColor: '#000',
            shadowOpacity: 0.28,
            shadowRadius: 30,
            shadowOffset: { width: 0, height: 12 },
            elevation: 10,
          }}
        >
          <RNText
            style={{
              color: t.isDark ? '#16171A' : '#FFFFFF',
              fontSize: 14,
              fontFamily: fontFamilyFor('600'),
            }}
          >
            {toast}
          </RNText>
        </Animated.View>
      )}
    </View>
  );
}
