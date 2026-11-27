import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Text as RNText, View } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { LOOP_NATIVE, useReducedMotion } from '../../lib/motion';
import { Icon, type IconName } from '../Icon';
import { tx } from '../primitives';

/**
 * Landing art, option B "Real app" (design 121/X): two tilted phones that float gently, showing the real
 * offers screen (h3) and Find work screen (e1), with three small cards around them.
 * PHONE SCREEN FIT (owner rule): each screen box is exactly 488:835, the width of the shots, and the picture
 * is `contain`ed in it, so the whole screenshot shows and nothing is cropped or zoomed.
 */
const SHOT_W = 488;
const SHOT_H = 835;
const BEZEL = 7;
const INK = '#121417';
const MUTED = '#5B6560';
const SOFT = '#DFF5EC';
const H3 = require('../../../assets/walkthrough/h3.jpg');
const E1 = require('../../../assets/walkthrough/e1.jpg');

function useFloatY(distance: number, still: boolean) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (still) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 1, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: LOOP_NATIVE }),
        Animated.timing(v, { toValue: 0, duration: 3000, easing: Easing.inOut(Easing.sin), useNativeDriver: LOOP_NATIVE }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [v, still]);
  return v.interpolate({ inputRange: [0, 1], outputRange: [0, distance] });
}

function Phone({ source, label, sw, rotate, left, top, dy, z, opacity = 1, still }: {
  source: number;
  label: string;
  sw: number;
  rotate: string;
  left: number;
  top: number;
  dy: number;
  z: number;
  opacity?: number;
  still: boolean;
}) {
  const y = useFloatY(dy, still);
  const sh = (sw * SHOT_H) / SHOT_W;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left,
        top,
        zIndex: z,
        opacity,
        padding: BEZEL,
        borderRadius: sw * 0.13,
        backgroundColor: '#0b0d0e',
        shadowColor: '#000',
        shadowOpacity: 0.4,
        shadowRadius: 30,
        shadowOffset: { width: 0, height: 18 },
        transform: [{ translateY: y }, { rotate }],
      }}
    >
      <View style={{ width: sw, aspectRatio: SHOT_W / SHOT_H, height: sh, borderRadius: sw * 0.1, overflow: 'hidden', backgroundColor: '#fff' }}>
        <Image source={source} accessibilityLabel={label} resizeMode="contain" style={{ width: '100%', height: '100%' }} />
      </View>
    </Animated.View>
  );
}

function Chip({ icon, title, sub, style, still, tone }: {
  icon: IconName;
  title: string;
  sub: string;
  style: object;
  still: boolean;
  tone: 'jade' | 'blue';
}) {
  const t = useTheme();
  const y = useFloatY(-6, still);
  return (
    <Animated.View
      style={[
        {
          position: 'absolute',
          zIndex: 5,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          backgroundColor: '#fff',
          borderRadius: 14,
          paddingVertical: 9,
          paddingHorizontal: 12,
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 15,
          shadowOffset: { width: 0, height: 7 },
          transform: [{ translateY: y }],
        },
        style,
      ]}
    >
      <View style={{ width: 26, height: 26, borderRadius: 9, backgroundColor: tone === 'blue' ? '#E3E9FF' : SOFT, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={14} color={tone === 'blue' ? '#2F5BEA' : t.colors.heroMid} strokeWidth={2} />
      </View>
      <View>
        <RNText style={tx('800', 12.5, INK)}>{title}</RNText>
        <RNText style={tx('500', 11, MUTED)}>{sub}</RNText>
      </View>
    </Animated.View>
  );
}

export function LandingRealApp() {
  const reduced = useReducedMotion();
  const [box, setBox] = useState({ w: 560, h: 280 });
  // Largest screen that fits both phones side by side (overlapping) inside the box.
  const byH = (box.h - 36 - 2 * BEZEL) * (SHOT_W / SHOT_H);
  const byW = box.w * 0.39 - 2 * BEZEL;
  const sw = Math.max(60, Math.min(byH, byW));
  const sh = (sw * SHOT_H) / SHOT_W;
  const pw = sw + 2 * BEZEL;
  const ph = sh + 2 * BEZEL;
  const mid = box.w / 2;
  const topA = Math.max(4, (box.h - ph) / 2 - 6);
  return (
    <View onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })} style={{ flex: 1, minHeight: 0 }}>
      <Phone source={E1} label="Find work screen" sw={sw} rotate="6deg" left={mid + pw * 0.05} top={topA + 18} dy={8} z={1} opacity={0.94} still={reduced} />
      <Phone source={H3} label="Offers screen" sw={sw} rotate="-5deg" left={mid - pw * 1.0} top={topA} dy={-10} z={2} still={reduced} />
      <Chip icon="wallet" title="Ravi offered ₹450" sub="★ 4.9 · 1.2 km away" style={{ left: 0, top: '10%' }} still={reduced} tone="jade" />
      <Chip icon="lock" title="Money held safely" sub="until you approve the work" style={{ left: 8, bottom: '12%' }} still={reduced} tone="jade" />
      <Chip icon="globe" title="Logo design · Remote" sub="from ₹1,500" style={{ right: 0, top: '32%' }} still={reduced} tone="blue" />
    </View>
  );
}
