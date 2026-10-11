import React, { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { Drop, Ripples } from './Ripples';

/**
 * The hero surface from design system v2: a diagonal gradient on the brand
 * colour (jade on Hire, blue on Earn), a faint drop watermark and slow ripple
 * rings. Used for the composer, the level card, the wallet balance and the
 * My Tasks summary -- the cards that carry white text.
 */
let gradientSeq = 0;

export function HeroBackground({ radius = 26 }: { radius?: number }) {
  const t = useTheme();
  // Each gradient needs its own id: two heroes on one web page would
  // otherwise both point at whichever <linearGradient> the browser found first.
  const [id] = useState(() => `heroGrad${++gradientSeq}`);
  return (
    <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, borderRadius: radius, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0.85" y2="1">
            <Stop offset="0" stopColor={t.colors.heroFrom} />
            <Stop offset="0.55" stopColor={t.colors.heroMid} />
            <Stop offset="1" stopColor={t.colors.heroTo} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${id})`} />
      </Svg>
    </View>
  );
}

export function HeroCard({
  children,
  style,
  radius = 26,
  padding = 20,
  rings = true,
  watermark = true,
  ringSize = 240,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  radius?: number;
  padding?: number;
  rings?: boolean;
  watermark?: boolean;
  ringSize?: number;
}) {
  const t = useTheme();
  return (
    <View
      style={[
        {
          borderRadius: radius,
          padding,
          overflow: 'hidden',
          backgroundColor: t.colors.heroMid,
          shadowColor: t.colors.heroMid,
          shadowOpacity: t.isDark ? 0 : 0.35,
          shadowRadius: 26,
          shadowOffset: { width: 0, height: 16 },
          elevation: t.isDark ? 0 : 6,
        },
        style,
      ]}
    >
      <HeroBackground radius={radius} />
      {rings ? (
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            right: -ringSize / 2 + 40,
            top: -ringSize / 2 + 30,
            width: ringSize,
            height: ringSize,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Ripples color="rgba(255,255,255,0.42)" size={ringSize} duration={3800} from={0.3} peak={0.8} />
        </View>
      ) : null}
      {watermark ? (
        <View pointerEvents="none" style={{ position: 'absolute', right: -14, bottom: -18, opacity: 0.12 }}>
          <Drop size={130} fill="#FFFFFF" tick={t.colors.heroMid} />
        </View>
      ) : null}
      {children}
    </View>
  );
}
