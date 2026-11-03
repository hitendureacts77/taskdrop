import { useEffect, useRef } from 'react';
import { View, Image, Text as RNText, Animated, Platform, type TextStyle, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';
import { Icon } from './Icon';
import { tx } from './primitives';

/**
 * The pins of the redesigned map (plan D12), drawn the same on the tile map and
 * inside the Google map's markers. Each one has a fixed box (`w` x `h`) and an
 * `anchor`: how far down the box the area's point is, so both maps can line the
 * pin up with the place.
 *
 * Helpers: a face (photo or initials) with a white rim and the first name under
 * it; several in one area become a stack of faces with "+N" and the area name.
 * Tasks: a price pin with a small pointer and dot; zoomed in, the poster's face
 * sits in the pin and their name and the task show underneath. The best offer
 * on screen takes the mode's button colour.
 */

export type Face = { initials: string; live: boolean; photo?: string | null };

export const FACE_PIN = { w: 116, h: 88, anchor: 30 } as const;
export const FACE_STACK = { w: 176, h: 76, anchor: 25 } as const;
export const PRICE_PIN = { w: 168, h: 72, anchor: 46 } as const;
export const TASK_PIN = { w: 176, h: 92, anchor: 48 } as const;

const RIM = '#FFFFFF';
const LIVE = '#22C55E';
/** Muted face colours for people with no photo, picked from the id so a face keeps its colour. */
const TONES = ['#3B4A6B', '#6B4A3B', '#2F5E55', '#5B3B6B', '#3B5B6B', '#6B5B2F', '#4A3B6B', '#5E2F45', '#45525E', '#5E4A2F'];

export function faceTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length]!;
}

const lift: ViewStyle = { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 };

function halo(color: string): TextStyle {
  return { textShadowColor: color, textShadowRadius: 4, textShadowOffset: { width: 0, height: 0 } };
}

/** A round face: the photo, or initials on a muted colour, with a green dot when active now. */
export function FaceDisc({
  face,
  seed,
  size,
  rim = RIM,
  rimWidth = 3,
  onImage,
}: {
  face: Face;
  seed: string;
  size: number;
  rim?: string;
  rimWidth?: number;
  onImage?: () => void;
}) {
  const dot = Math.max(9, Math.round(size * 0.26));
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: rimWidth,
          borderColor: rim,
          backgroundColor: faceTone(seed),
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {face.photo ? (
          <Image source={{ uri: face.photo }} onLoad={onImage} style={{ width: size, height: size }} accessibilityIgnoresInvertColors />
        ) : (
          <RNText style={tx('800', Math.round(size * 0.3), '#FFFFFF')}>{face.initials}</RNText>
        )}
      </View>
      {face.live ? (
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: LIVE, borderWidth: 2, borderColor: rim }} />
      ) : null}
    </View>
  );
}

/** A soft green glow that breathes behind someone active now (tile map only; markers are snapshots). */
function LiveGlow({ size, top }: { size: number; top: number }) {
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: 2400, useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  if (reduced) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: LIVE,
        opacity: v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1.7, 1.7] }) }],
      }}
    />
  );
}

/** One helper: face and first name; picked, the face grows and the label adds their main skill. */
export function FacePin({
  face,
  seed,
  name,
  skill,
  on,
  glow = false,
  onImage,
}: {
  face: Face;
  seed: string;
  name: string;
  skill: string;
  on: boolean;
  glow?: boolean;
  onImage?: () => void;
}) {
  const t = useTheme();
  const size = on ? 60 : 48;
  const top = FACE_PIN.anchor - size / 2;
  return (
    <View style={{ width: FACE_PIN.w, height: FACE_PIN.h, alignItems: 'center' }} collapsable={false}>
      {glow && face.live && !on ? <LiveGlow size={size} top={top} /> : null}
      <View style={[{ marginTop: top, borderRadius: size / 2 }, lift]}>
        <FaceDisc face={face} seed={seed} size={size} rim={on ? t.colors.purple : RIM} rimWidth={on ? 4 : 3} onImage={onImage} />
      </View>
      <View style={{ marginTop: 5, maxWidth: FACE_PIN.w, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: on ? t.colors.purpleDeep : t.colors.bg }}>
        <RNText numberOfLines={1} style={tx('800', 11, on ? '#FFFFFF' : t.colors.ink)}>
          {on ? `${name} · ${skill}` : name}
        </RNText>
      </View>
    </View>
  );
}

/** Several helpers in one area: up to three faces, "+N" for the rest, and the area's name. */
export function FaceStack({ faces, extra, label }: { faces: { face: Face; seed: string }[]; extra: number; label: string }) {
  const t = useTheme();
  return (
    <View style={{ width: FACE_STACK.w, height: FACE_STACK.h, alignItems: 'center' }} collapsable={false}>
      <View style={[{ marginTop: FACE_STACK.anchor - 21, flexDirection: 'row', alignItems: 'center', padding: 3, borderRadius: 999, backgroundColor: RIM }, lift]}>
        {faces.map((f, i) => (
          <View key={f.seed} style={{ marginLeft: i === 0 ? 0 : -11 }}>
            <FaceDisc face={f.face} seed={f.seed} size={36} rimWidth={i === 0 ? 0 : 2} />
          </View>
        ))}
        {extra > 0 ? (
          <View style={{ height: 36, minWidth: 36, marginLeft: -9, paddingHorizontal: 7, borderRadius: 18, borderWidth: 2, borderColor: RIM, backgroundColor: t.colors.purpleDeep, alignItems: 'center', justifyContent: 'center' }}>
            <RNText style={tx('800', 12, '#FFFFFF')}>+{extra}</RNText>
          </View>
        ) : null}
      </View>
      <View style={{ marginTop: 5, maxWidth: FACE_STACK.w, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, backgroundColor: t.colors.bg }}>
        <RNText numberOfLines={1} style={tx('700', 11, t.colors.ink)}>
          {label}
        </RNText>
      </View>
    </View>
  );
}

/** The pointer and dot under a pin; the dot is the area's point. */
function Pointer({ color }: { color: string }) {
  const t = useTheme();
  return (
    <>
      <View style={{ width: 0, height: 0, borderLeftWidth: 6, borderRightWidth: 6, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: color }} />
      <View style={{ marginTop: 2, width: 8, height: 8, borderRadius: 4, backgroundColor: color, borderWidth: 1.5, borderColor: t.colors.bg }} />
    </>
  );
}

/** An area's biggest offer (or one task far from the rest), with the area's name under it. */
export function PricePin({ price, best, on, place, count }: { price: string; best: boolean; on: boolean; place: string; count?: string }) {
  const t = useTheme();
  const bg = best ? t.colors.btn : t.colors.ink;
  const fg = best ? t.colors.onBtn : t.colors.bg;
  return (
    <View style={{ width: PRICE_PIN.w, height: PRICE_PIN.h, alignItems: 'center' }} collapsable={false}>
      <View
        style={[
          { height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: bg, borderWidth: on ? 2 : 0, borderColor: RIM, flexDirection: 'row', alignItems: 'center', gap: 5 },
          lift,
        ]}
      >
        {best ? <Icon name="trending" size={13} color={fg} /> : null}
        <RNText style={tx('800', 15, fg, { fontVariant: ['tabular-nums'], letterSpacing: -0.2 })}>{price}</RNText>
      </View>
      <Pointer color={bg} />
      <RNText numberOfLines={1} style={tx('700', 11, t.colors.ink, { marginTop: 3, maxWidth: PRICE_PIN.w, ...halo(t.colors.bg) })}>
        {place}
        {count ? <RNText style={tx('600', 11, t.colors.muted)}>{` · ${count}`}</RNText> : null}
      </RNText>
    </View>
  );
}

/** One task, zoomed in: the poster's face and price, then their name, then the task. */
export function TaskPin({
  price,
  face,
  seed,
  who,
  title,
  best,
  on,
  onImage,
}: {
  price: string;
  face?: Face;
  seed: string;
  who?: string;
  title?: string;
  best: boolean;
  on: boolean;
  onImage?: () => void;
}) {
  const t = useTheme();
  const bg = best ? t.colors.btn : t.colors.ink;
  const fg = best ? t.colors.onBtn : t.colors.bg;
  return (
    <View style={{ width: TASK_PIN.w, height: TASK_PIN.h, alignItems: 'center' }} collapsable={false}>
      <View
        style={[
          {
            height: 36,
            paddingLeft: face ? 4 : 12,
            paddingRight: 12,
            borderRadius: 18,
            backgroundColor: bg,
            borderWidth: 2,
            borderColor: on ? RIM : bg,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
          },
          lift,
        ]}
      >
        {face ? <FaceDisc face={face} seed={seed} size={26} rimWidth={0} rim={bg} onImage={onImage} /> : null}
        <RNText style={tx('800', 15, fg, { fontVariant: ['tabular-nums'], letterSpacing: -0.2 })}>{price}</RNText>
      </View>
      <Pointer color={bg} />
      {who ? (
        <RNText numberOfLines={1} style={tx('800', 12, t.colors.ink, { marginTop: 3, maxWidth: TASK_PIN.w, ...halo(t.colors.bg) })}>
          {who}
        </RNText>
      ) : null}
      {title ? (
        <RNText numberOfLines={1} style={tx('600', 11, t.colors.muted, { marginTop: who ? 0 : 3, maxWidth: TASK_PIN.w, ...halo(t.colors.bg) })}>
          {title}
        </RNText>
      ) : null}
    </View>
  );
}
