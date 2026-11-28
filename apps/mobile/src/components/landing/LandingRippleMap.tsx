import { useState } from 'react';
import { Animated, Text as RNText, View } from 'react-native';
import { useTheme } from '../../providers/ThemeProvider';
import { useReducedMotion } from '../../lib/motion';
import { Icon } from '../Icon';
import { tx } from '../primitives';
import { useCycle } from './useCycle';

/**
 * Landing art, option A "Ripple map" (design 121/X): a task card drops into the middle of a street map,
 * rings spread out, five helpers light up in turn and three offers stack up on the right. A 3.6 s loop.
 * Pins live in the band above and below the card, never under the offer stack. Decoration only.
 */
const CYCLE = 3600;
const INK = '#121417';
const MUTED = '#5B6560';
const SOFT = '#DFF5EC';

const PINS = [
  { ini: 'RK', rt: '4.9', color: '#E8833A', x: 0.03, top: true, d: 800 },
  { ini: 'AM', rt: '5.0', color: '#E0457B', x: 0.33, top: true, d: 950 },
  { ini: 'PV', rt: '4.7', color: '#2E9BD6', x: 0.63, top: true, d: 1250 },
  { ini: 'SN', rt: '4.8', color: '#7A5AF8', x: 0.12, top: false, d: 1100 },
  { ini: 'JD', rt: '4.9', color: '#C9A227', x: 0.5, top: false, d: 1450 },
];
const OFFERS = [
  { ini: 'RK', name: 'Ravi K.', sub: '★ 4.9 · 1.2 km', price: '₹450', color: '#E8833A', d: 1300 },
  { ini: 'AM', name: 'Arjun M.', sub: '★ 5.0 · 2.0 km', price: '₹500', color: '#E0457B', d: 1700 },
  { ini: 'SN', name: 'Sana N.', sub: '★ 4.8 · 0.8 km', price: '₹420', color: '#7A5AF8', d: 2100 },
];

function Pin({ p, reduced, band, small, area }: { p: (typeof PINS)[number]; reduced: boolean; band: number; small: boolean; area: number }) {
  const v = useCycle(CYCLE, p.d, reduced, 0.4);
  const av = small ? 32 : 40;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: p.x * area,
        ...(p.top ? { top: band } : { bottom: band }),
        alignItems: 'center',
        zIndex: 2,
        opacity: v.interpolate({ inputRange: [0, 0.08, 0.7, 1], outputRange: [0.45, 1, 1, 0.45] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 0.08, 0.14, 0.7, 1], outputRange: [0.8, 1.15, 1, 1, 0.8] }) }],
      }}
    >
      <View
        style={{
          width: av,
          height: av,
          borderRadius: av / 2,
          borderWidth: 3,
          borderColor: '#fff',
          backgroundColor: p.color,
          alignItems: 'center',
          justifyContent: 'center',
          shadowColor: '#000',
          shadowOpacity: 0.25,
          shadowRadius: 9,
          shadowOffset: { width: 0, height: 4 },
        }}
      >
        <RNText style={tx('800', small ? 11 : 13, '#fff')}>{p.ini}</RNText>
      </View>
      <View style={{ marginTop: 3, backgroundColor: 'rgba(0,0,0,0.45)', borderRadius: 8, paddingHorizontal: 6, paddingVertical: 1 }}>
        <RNText style={tx('700', 10.5, '#fff')}>★ {p.rt}</RNText>
      </View>
    </Animated.View>
  );
}

function Ring({ delay, reduced }: { delay: number; reduced: boolean }) {
  const v = useCycle(CYCLE, delay, reduced, 0);
  if (reduced) return null;
  return (
    <Animated.View
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: 120,
        height: 120,
        marginLeft: -60,
        marginTop: -60,
        borderRadius: 60,
        borderWidth: 2,
        borderColor: 'rgba(255,255,255,0.55)',
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.95, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [0.4, 4] }) }],
      }}
    />
  );
}

function Offer({ o, reduced, compact }: { o: (typeof OFFERS)[number]; reduced: boolean; compact: boolean }) {
  const v = useCycle(CYCLE, o.d, reduced, 0.4);
  return (
    <Animated.View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 9,
        backgroundColor: 'rgba(255,255,255,0.96)',
        borderRadius: 14,
        paddingVertical: compact ? 7 : 9,
        paddingHorizontal: 11,
        shadowColor: '#000',
        shadowOpacity: 0.2,
        shadowRadius: 12,
        shadowOffset: { width: 0, height: 5 },
        opacity: v.interpolate({ inputRange: [0, 0.08, 0.6, 0.75, 1], outputRange: [0, 1, 1, 0, 0] }),
        transform: [{ translateX: v.interpolate({ inputRange: [0, 0.08, 0.6, 0.75, 1], outputRange: [18, 0, 0, 18, 18] }) }],
      }}
    >
      <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: o.color, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={tx('800', 11, '#fff')}>{o.ini}</RNText>
      </View>
      <View style={{ flex: 1, minWidth: 0 }}>
        <RNText numberOfLines={1} style={tx('800', 12.5, INK)}>{o.name}</RNText>
        <RNText numberOfLines={1} style={tx('500', 11, MUTED)}>{o.sub}</RNText>
      </View>
      <RNText style={{ ...tx('800', 13, INK), fontVariant: ['tabular-nums'] }}>{o.price}</RNText>
    </Animated.View>
  );
}

export function LandingRippleMap() {
  const t = useTheme();
  const reduced = useReducedMotion();
  const [box, setBox] = useState({ w: 560, h: 260 });
  const drop = useCycle(CYCLE, 0, reduced, 1);
  const compact = box.h < 250;
  const small = box.h < 250;
  const offersW = Math.max(170, Math.min(214, box.w * 0.36));
  const area = Math.max(150, box.w - offersW - 28 - 76); // pins stay left of the offer stack
  const cardW = Math.max(180, Math.min(236, box.w - offersW - 28 - 24));
  const band = 8;
  return (
    <View style={{ flex: 1, minHeight: 0 }}>
      <View
        onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}
        style={{
          flex: 1,
          minHeight: 0,
          borderRadius: 26,
          overflow: 'hidden',
          backgroundColor: 'rgba(0,0,0,0.14)',
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.14)',
        }}
      >
        {/* soft street grid */}
        {[0.22, 0.5, 0.78].map((y) => (
          <View key={`h${y}`} style={{ position: 'absolute', left: 0, right: 0, top: `${y * 100}%`, height: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        ))}
        {[0.18, 0.4, 0.6, 0.84].map((x) => (
          <View key={`v${x}`} style={{ position: 'absolute', top: 0, bottom: 0, left: `${x * 100}%`, width: 1, backgroundColor: 'rgba(255,255,255,0.07)' }} />
        ))}
        <View style={{ position: 'absolute', left: -20, right: -20, top: '38%', height: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', transform: [{ rotate: '-12deg' }] }} />
        <View style={{ position: 'absolute', top: -30, bottom: -30, left: '62%', width: 10, borderRadius: 10, backgroundColor: 'rgba(255,255,255,0.1)', transform: [{ rotate: '-12deg' }] }} />

        {PINS.map((p) => (
          <Pin key={p.ini} p={p} reduced={reduced} band={band} small={small} area={area} />
        ))}

        {/* the task card, with rings spreading from it */}
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: Math.max(12, (box.w - offersW - 28 - cardW) / 2), width: cardW, top: '50%', height: 0, alignItems: 'center', justifyContent: 'center', zIndex: 3 }}
        >
          <Ring delay={0} reduced={reduced} />
          <Ring delay={1200} reduced={reduced} />
          <Ring delay={2400} reduced={reduced} />
          <Animated.View
            style={{
              width: cardW,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 10,
              backgroundColor: '#fff',
              borderRadius: 18,
              padding: 12,
              shadowColor: '#000',
              shadowOpacity: 0.3,
              shadowRadius: 20,
              shadowOffset: { width: 0, height: 10 },
              transform: [{ translateY: drop.interpolate({ inputRange: [0, 0.08, 0.12, 1], outputRange: [-12, 2, 0, 0] }) }],
            }}
          >
            <View style={{ width: 38, height: 38, borderRadius: 12, backgroundColor: SOFT, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="wrench" size={18} color={t.colors.heroMid} strokeWidth={2} />
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <RNText numberOfLines={1} style={tx('800', 14, INK)}>Fix a leaking tap</RNText>
              <RNText numberOfLines={1} style={tx('500', 12, MUTED)}>Kondapur · today, 6 pm</RNText>
            </View>
          </Animated.View>
        </View>

        <View style={{ position: 'absolute', right: 14, top: 14, width: offersW, gap: 8, zIndex: 4 }}>
          {OFFERS.map((o) => (
            <Offer key={o.ini} o={o} reduced={reduced} compact={compact} />
          ))}
        </View>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, alignSelf: 'flex-start', backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: 999, paddingVertical: 6, paddingHorizontal: 13 }}>
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#7CF5C8' }} />
        <RNText style={tx('700', 12.5, '#fff')}>3 offers in 9 min · money held until you approve</RNText>
      </View>
    </View>
  );
}
