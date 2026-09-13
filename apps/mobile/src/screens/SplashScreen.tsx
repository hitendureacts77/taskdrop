import { useEffect, useRef } from 'react';
import { View, Text as RNText, Pressable, Animated } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Screen } from '../components/ui';
import { useTheme } from '../providers/ThemeProvider';
import { useNav } from '../providers/NavProvider';
import { tx } from '../components/primitives';

export function SplashScreen() {
  const t = useTheme();
  const { reset } = useNav();

  const pop = useRef(new Animated.Value(0)).current;
  const rise = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const a = Animated.timing(pop, { toValue: 1, duration: 500, useNativeDriver: true });
    const b = Animated.timing(rise, { toValue: 1, duration: 500, delay: 100, useNativeDriver: true });
    a.start();
    b.start();
    return () => {
      a.stop();
      b.stop();
    };
  }, [pop, rise]);

  return (
    <Screen padded={false}>
      <Pressable onPress={() => reset('welcome')} style={{ flex: 1 }}>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 18 }}>
          <Animated.View
            style={{
              opacity: pop,
              transform: [{ scale: pop.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.6, 1.08, 1] }) }],
            }}
          >
            <Svg width={72} height={72} viewBox="0 0 24 24" fill="none">
              <Path
                d="M12 2.5c4.2 4.5 6.6 7.7 6.6 10.8A6.6 6.6 0 0 1 12 20a6.6 6.6 0 0 1-6.6-6.7C5.4 10.2 7.8 7 12 2.5Z"
                fill={t.colors.accent}
              />
              <Path
                d="M9.2 13.1l2.2 2.3 4-4.6"
                stroke={t.colors.onAccent}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </Svg>
          </Animated.View>

          <Animated.View
            style={{
              opacity: rise,
              transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            }}
          >
            <RNText style={tx('800', 38, t.colors.ink, { letterSpacing: -1.52 })}>
              taskdrop<RNText style={{ color: t.colors.accent }}>.</RNText>
            </RNText>
          </Animated.View>
        </View>

        <RNText
          style={tx('400', 13, t.colors.muted, {
            position: 'absolute',
            bottom: 56,
            width: '100%',
            textAlign: 'center',
          })}
        >
          Ask for anything. Someone can do it.
        </RNText>
      </Pressable>
    </Screen>
  );
}
