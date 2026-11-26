import { memo, useEffect, useRef, useState } from 'react';
import { View, Image, Text as RNText, Animated, Easing, Platform, type ViewStyle } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';
import { Icon, type IconName } from './Icon';
import { makeTheme } from '../theme';
import { peekSignedUrl, signedMediaUrl } from '../lib/media';
import { tx } from './primitives';
import { RIPPLE_EVERY_MS, RIPPLE_MS } from '../lib/mapMotion';
import { PULSE_MS, RING_OPACITY, RING_R1, RING_SCALE0, rippleDelay } from '../lib/mapMotion';

/**
 * The pins of the redesigned map (plan D12), drawn the same on the tile map and
 * inside the Google map's markers. Each one has a fixed box (`w` x `h`) and an
 * `anchor`: how far down the box the area's point is, so both maps can line the
 * pin up with the place.
 *
 * Helpers: what they offer, never who they are (plan D13): a service icon
 * with a white rim and their main service and price under it; several in one
 * area become a stack of icons with "+N" and the area name. The name and face
 * show only once a poster taps one (the helper sheet).
 * Tasks: a price pin with a small pointer and dot; zoomed in, the poster's face
 * sits in the pin and their name and the task show underneath. The best offer
 * on screen takes the mode's button colour.
 */

/** A person's disc: photo or initials, or with `icon` a service icon in their place (helpers on the map). */
export type Face = { initials: string; live: boolean; photo?: string | null; icon?: IconName };

export const FACE_PIN = { w: 152, h: 88, anchor: 30 } as const;
export const FACE_STACK = { w: 176, h: 76, anchor: 25 } as const;
export const PRICE_PIN = { w: 168, h: 76, anchor: 46 } as const;
export const TASK_PIN = { w: 176, h: 98, anchor: 48 } as const;
/** A promoted pin: a 52 px disc inside a 72 px soft ring, pointer and dot under it (the dot is the area's point). */
export const PROMO_PIN = { w: 168, h: 84, anchor: 74 } as const;

const RIM = '#FFFFFF';
/** Muted face colours for people with no photo, picked from the id so a face keeps its colour. */
const TONES = ['#3B4A6B', '#6B4A3B', '#2F5E55', '#5B3B6B', '#3B5B6B', '#6B5B2F', '#4A3B6B', '#5E2F45', '#45525E', '#5E4A2F'];

export function faceTone(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return TONES[Math.abs(h) % TONES.length]!;
}

/**
 * Hire is always jade, Earn always royal blue (owner rule). Helper pins are the Hire side, so they take the base
 * palette's jade even when an Earn-mode theme sits above them (that theme swaps `btn`/`hero`/`accent` to blue).
 */
export function hireColours(isDark: boolean) {
  const c = makeTheme(isDark).colors;
  return { side: c.btn, fill: c.hero, soft: c.accentSoft, deep: c.accentDeep };
}

/** The side's colour on the map: Earn (tasks) royal blue, Hire (helpers) jade. */
export function sideHue(t: { isDark: boolean; colors: { purple: string } }, people: boolean): string {
  return people ? hireColours(t.isDark).side : t.colors.purple;
}

/** A photo that is already a link is used as it is; a stored `media:` reference is signed first (and never requested raw). */
const DIRECT_PHOTO = /^(https?:|data:|blob:|file:)/i;

const lift: ViewStyle = { shadowColor: '#000', shadowOpacity: 0.45, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 };

/** A small dark tag under a pin, so its words read on any map, light or dark. */
function Tag({ children, max, top = 3 }: { children: React.ReactNode; max: number; top?: number }) {
  const t = useTheme();
  return (
    <View style={{ marginTop: top, maxWidth: max, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, backgroundColor: t.colors.bg, alignItems: 'center' }}>
      {children}
    </View>
  );
}

const ND = Platform.OS !== 'web';

/** A soft ring that breathes round the active-now dot (about 1.6 s). Off under reduced motion. */
function DotPulse({ size }: { size: number }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) return;
    const loop = Animated.loop(Animated.timing(v, { toValue: 1, duration: PULSE_MS, useNativeDriver: ND }));
    loop.start();
    return () => loop.stop();
  }, [reduced, v]);
  if (reduced) return null;
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        right: -1,
        bottom: -1,
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: t.colors.online,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [1, 2.2] }) }],
      }}
    />
  );
}

/** How a pin comes in: after `delay` ms it fades and scales up from `from` over `ms`. */
export type PinEnter = { delay: number; ms: number; from: number };

/**
 * Motion inside a pin, with RN Animated on the native driver so the map never re-renders per frame:
 * `enter` (intro, burst out of a spread, group pin after a fold) plays once when the pin mounts;
 * `ripple` (the turn, 0-based, of a just-posted task) loops a ring round the area's point.
 * Under reduced motion neither runs: the pin just appears. The box is the pin's own fixed box.
 */
export function PinMotion({
  box,
  enter = null,
  ripple = null,
  hue,
  children,
}: {
  box: { w: number; h: number; anchor: number };
  enter?: PinEnter | null;
  ripple?: number | null;
  hue?: string;
  children: React.ReactNode;
}) {
  const reduced = useReducedMotion();
  const play = enter !== null && !reduced;
  // Read once, when the pin mounts: a pin that is already on the map never replays.
  const shown = useRef(new Animated.Value(play ? 0 : 1)).current;
  const from = enter?.from ?? 1;
  useEffect(() => {
    if (!play || !enter) return;
    const run = Animated.timing(shown, { toValue: 1, delay: enter.delay, duration: enter.ms, easing: Easing.out(Easing.cubic), useNativeDriver: ND });
    run.start();
    return () => run.stop();
    // Mount only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      collapsable={false}
      style={{
        width: box.w,
        height: box.h,
        opacity: shown,
        transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [from, 1] }) }],
      }}
    >
      {children}
      {ripple !== null && !reduced && hue ? <Ripple box={box} turn={ripple} hue={hue} /> : null}
    </Animated.View>
  );
}

/** The just-posted ring: 20 to 50 px round the area's point, fading, one every 3.6 s. */
function Ripple({ box, turn, hue }: { box: { w: number; anchor: number }; turn: number; hue: string }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const first = Animated.delay(rippleDelay(turn));
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(v, { toValue: 0, duration: 0, useNativeDriver: ND }),
        Animated.timing(v, { toValue: 1, duration: RIPPLE_MS, easing: Easing.out(Easing.quad), useNativeDriver: ND }),
        Animated.delay(RIPPLE_EVERY_MS - RIPPLE_MS),
      ]),
    );
    const run = Animated.sequence([first, loop]);
    run.start();
    return () => run.stop();
  }, [turn, v]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: box.w / 2 - RING_R1,
        top: box.anchor - RING_R1,
        width: RING_R1 * 2,
        height: RING_R1 * 2,
        borderRadius: RING_R1,
        borderWidth: 2,
        borderColor: hue,
        opacity: v.interpolate({ inputRange: [0, 1], outputRange: [RING_OPACITY, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 1], outputRange: [RING_SCALE0, 1] }) }],
      }}
    />
  );
}

/** A round face: the photo, or initials on a muted colour, or a service icon; a green dot when active now. */
export function FaceDisc({
  face,
  seed,
  size,
  rim = RIM,
  rimWidth = 3,
  onImage,
  pulse = false,
}: {
  face: Face;
  seed: string;
  size: number;
  rim?: string;
  rimWidth?: number;
  onImage?: () => void;
  /** The active-now dot breathes (map pins only). */
  pulse?: boolean;
}) {
  const t = useTheme();
  const dot = Math.max(9, Math.round(size * 0.26));
  const [broken, setBroken] = useState(false);
  const hire = hireColours(t.isDark);
  const raw = face.photo ?? null;
  const [signed, setSigned] = useState<string | null>(() => (raw && !DIRECT_PHOTO.test(raw) ? peekSignedUrl(raw, 'thumb') : null));
  useEffect(() => {
    if (!raw || DIRECT_PHOTO.test(raw)) return;
    let alive = true;
    void signedMediaUrl(raw, 'thumb').then((u) => alive && (u ? setSigned(u) : setBroken(true)));
    return () => {
      alive = false;
    };
  }, [raw]);
  const photoUri = raw && DIRECT_PHOTO.test(raw) ? raw : signed;
  // A photo that arrives late fades in over the initials instead of popping in (Opus map audit).
  const reduced = useReducedMotion();
  const shown = useRef(new Animated.Value(0)).current;
  const loaded = () => {
    Animated.timing(shown, { toValue: 1, duration: reduced ? 0 : 180, useNativeDriver: Platform.OS !== 'web' }).start();
    onImage?.();
  };
  return (
    <View style={{ width: size, height: size }}>
      <View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: rimWidth,
          borderColor: rim,
          backgroundColor: face.icon ? hire.soft : faceTone(seed),
          overflow: 'hidden',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {face.icon ? (
          <Icon name={face.icon} size={Math.round(size * 0.42)} color={hire.deep} strokeWidth={1.9} />
        ) : (
          // Initials sit underneath, so a photo that never loads still leaves a face.
          <RNText style={tx('800', Math.round(size * 0.3), '#FFFFFF')}>{face.initials}</RNText>
        )}
        {photoUri && !face.icon && !broken ? (
          <Animated.View style={{ position: 'absolute', left: 0, top: 0, opacity: shown }}>
            <Image
              source={{ uri: photoUri }}
              onLoad={loaded}
              onError={() => (setBroken(true), onImage?.())}
              // Android's own fade would run a second time inside the marker snapshot.
              fadeDuration={0}
              style={{ width: size - rimWidth * 2, height: size - rimWidth * 2 }}
              accessibilityIgnoresInvertColors
            />
          </Animated.View>
        ) : null}
      </View>
      {face.live && pulse ? <DotPulse size={dot} /> : null}
      {face.live ? (
        <View style={{ position: 'absolute', right: -1, bottom: -1, width: dot, height: dot, borderRadius: dot / 2, backgroundColor: t.colors.online, borderWidth: 2, borderColor: rim }} />
      ) : null}
    </View>
  );
}

/** A soft green glow that breathes behind someone active now (tile map only; markers are snapshots). */
function LiveGlow({ size, top }: { size: number; top: number }) {
  const t = useTheme();
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
        backgroundColor: t.colors.online,
        opacity: v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0, 0] }),
        transform: [{ scale: v.interpolate({ inputRange: [0, 0.7, 1], outputRange: [1, 1.7, 1.7] }) }],
      }}
    />
  );
}

/**
 * One helper: a disc and what they offer ("AC repair · ₹399"). `price` is
 * missing for someone who lists skills but no service (a dashed tag); `more`
 * is how many other services they list. Picked, the disc grows and turns blue.
 */
function FacePinImpl({
  face,
  seed,
  what,
  price,
  more = 0,
  on,
  glow = false,
  compact = false,
  onImage,
}: {
  face: Face;
  seed: string;
  what: string;
  price?: string | null;
  more?: number;
  on: boolean;
  glow?: boolean;
  /** Another pin's words sit here (lib/mapLabels.ts planSpread): the icon and the price stay, the service name steps back. */
  compact?: boolean;
  onImage?: () => void;
}) {
  const t = useTheme();
  const hire = hireColours(t.isDark);
  const size = on ? 60 : 48;
  const top = FACE_PIN.anchor - size / 2;
  const skillOnly = !price;
  return (
    <View style={{ width: FACE_PIN.w, height: FACE_PIN.h, alignItems: 'center' }} collapsable={false}>
      {glow && face.live && !on ? <LiveGlow size={size} top={top} /> : null}
      <View style={[{ marginTop: top, borderRadius: size / 2 }, lift]}>
        <FaceDisc face={face} seed={seed} size={size} rim={on ? hire.side : RIM} rimWidth={on ? 4 : 3} onImage={onImage} pulse />
        {more > 0 ? (
          <View style={{ position: 'absolute', right: -8, top: -4, height: 18, minWidth: 18, paddingHorizontal: 5, borderRadius: 9, borderWidth: 2, borderColor: RIM, backgroundColor: hire.fill, alignItems: 'center', justifyContent: 'center' }}>
            <RNText style={tx('800', 9.5, '#FFFFFF')}>+{more}</RNText>
          </View>
        ) : null}
      </View>
      {compact && skillOnly ? null : (
      <View
        style={{
          marginTop: 5,
          maxWidth: FACE_PIN.w,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: 8,
          paddingVertical: 2,
          borderRadius: 999,
          borderWidth: 1,
          borderStyle: skillOnly && !on ? 'dashed' : 'solid',
          borderColor: on ? hire.fill : skillOnly ? t.colors.muted : t.colors.bg,
          backgroundColor: on ? hire.fill : skillOnly ? t.colors.surface2 : t.colors.bg,
        }}
      >
        {compact ? null : (
          <RNText numberOfLines={1} style={tx('800', 11, on ? '#FFFFFF' : t.colors.ink, { flexShrink: 1 })}>
            {what}
          </RNText>
        )}
        {price ? <RNText style={tx('800', 11, on ? '#FFFFFF' : hire.deep, { fontVariant: ['tabular-nums'] })}>{price}</RNText> : null}
      </View>
      )}
    </View>
  );
}

/** Several helpers in one area: up to three faces, "+N" for the rest, and the area's name. */
export function FaceStack({
  faces,
  extra,
  label,
  onImage,
}: {
  faces: { face: Face; seed: string }[];
  extra: number;
  label: string;
  /** A photo arrived: a native marker redraws its snapshot so the face shows. */
  onImage?: () => void;
}) {
  const t = useTheme();
  const hire = hireColours(t.isDark);
  return (
    <View style={{ width: FACE_STACK.w, height: FACE_STACK.h, alignItems: 'center' }} collapsable={false}>
      <View style={[{ marginTop: FACE_STACK.anchor - 21, flexDirection: 'row', alignItems: 'center', padding: 3, borderRadius: 999, backgroundColor: RIM }, lift]}>
        {faces.map((f, i) => (
          <View key={f.seed} style={{ marginLeft: i === 0 ? 0 : -11 }}>
            <FaceDisc face={f.face} seed={f.seed} size={36} rimWidth={i === 0 ? 0 : 2} onImage={onImage} pulse />
          </View>
        ))}
        {extra > 0 ? (
          <View style={{ height: 36, minWidth: 36, marginLeft: -9, paddingHorizontal: 7, borderRadius: 18, borderWidth: 2, borderColor: RIM, backgroundColor: hire.fill, alignItems: 'center', justifyContent: 'center' }}>
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
function PricePinImpl({
  price,
  best,
  on,
  place,
  count,
  hidePlace = false,
}: {
  price: string;
  best: boolean;
  on: boolean;
  place: string;
  count?: string;
  /** Another pin's words sit here (lib/mapLabels.ts): show the price alone, the name returns once there is room. */
  hidePlace?: boolean;
}) {
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
      {hidePlace ? null : (
        <Tag max={PRICE_PIN.w}>
          <RNText numberOfLines={1} style={tx('700', 11, t.colors.ink)}>
            {place}
            {count ? <RNText style={tx('600', 11, t.colors.muted)}>{` · ${count}`}</RNText> : null}
          </RNText>
        </Tag>
      )}
    </View>
  );
}

/** One task, zoomed in: the poster's face and price, then their name, then the task. */
function TaskPinImpl({
  price,
  face,
  seed,
  who,
  title,
  best,
  on,
  compact = false,
  onImage,
}: {
  price: string;
  face?: Face;
  seed: string;
  who?: string;
  title?: string;
  best: boolean;
  on: boolean;
  /** Another pin's words sit here (lib/mapLabels.ts planSpread): the face and price stay, the name and task step back. */
  compact?: boolean;
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
      {(who || title) && !compact ? (
        <Tag max={TASK_PIN.w}>
          {who ? (
            <RNText numberOfLines={1} style={tx('800', 12, t.colors.ink)}>
              {who}
            </RNText>
          ) : null}
          {title ? (
            <RNText numberOfLines={1} style={tx('600', 11, t.colors.muted)}>
              {title}
            </RNText>
          ) : null}
        </Tag>
      ) : null}
    </View>
  );
}

/**
 * A promoted post on the map (task 1.19 row C): bigger than the rest (52 px against 30), filled with the side's
 * colour (Earn royal blue, Hire jade) with a white border, a soft ring round it and a bolt above the price.
 * Drawn above the other pins by its caller.
 */
function PromotedPinImpl({ price, side, on }: { price: string | null; side: 'earn' | 'hire'; on: boolean }) {
  const t = useTheme();
  const fill = side === 'earn' ? t.colors.purple : hireColours(t.isDark).fill;
  return (
    <View style={{ width: PROMO_PIN.w, height: PROMO_PIN.h, alignItems: 'center' }} collapsable={false}>
      <View style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', width: 72, height: 72, borderRadius: 36, backgroundColor: fill, opacity: 0.22 }} />
        <View
          style={[
            { width: 52, height: 52, borderRadius: 26, backgroundColor: fill, borderWidth: on ? 3 : 2, borderColor: RIM, alignItems: 'center', justifyContent: 'center' },
            lift,
          ]}
        >
          <Icon name="bolt" size={price ? 12 : 20} color={RIM} strokeWidth={2.2} />
          {price ? <RNText style={tx('800', 11, RIM, { fontVariant: ['tabular-nums'], letterSpacing: -0.2, marginTop: -1 })}>{price}</RNText> : null}
        </View>
      </View>
      <Pointer color={fill} />
    </View>
  );
}

// Moving the map re-renders the pin layer every frame; these pins take plain values, so they only redraw when those change.
export const FacePin = memo(FacePinImpl);
export const PricePin = memo(PricePinImpl);
export const TaskPin = memo(TaskPinImpl);
export const PromotedPin = memo(PromotedPinImpl);
