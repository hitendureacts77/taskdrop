import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, Text as RNText, Pressable, PanResponder, Platform, Animated, Easing, type LayoutChangeEvent } from 'react-native';
import { useReducedMotion } from '../lib/motion';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { Icon } from './Icon';
import { TILE, TILE_HEADERS, project, tileUrl, unproject } from './MapPicker.tiles';
import { mapWords as mapWordsOf } from './MapPinLayer';
import { metresPerPixel } from '../lib/mapCluster';
import { SPREAD_ZOOM } from '../lib/mapLayout';
import { zoomToFit } from '../lib/mapReach';
import { CALLOUT_LIFT, MapPinLayer, type JobPin, type MapTone } from './MapPinLayer';

export {
  CALLOUT_LIFT,
  CLUSTER_PX,
  CLUSTER_PX_PEOPLE,
  SPREAD_GAP,
  SPREAD_GAP_PEOPLE,
  SPREAD_MS,
  byOffer,
  helperSays,
  mapWords,
  offersOf,
  placeOf,
  topPinOf,
  type JobPin,
  type MapTone,
} from './MapPinLayer';

export type JobsMapProps = {
  me: { lat: number; lng: number } | null;
  pins: JobPin[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  height?: number;
  /** The reach drawn round you; the same as the list it sits beside. */
  ringKm?: number;
  tone?: MapTone;
  /** Move the map to this pin when it changes (the full map's card rail). */
  focusId?: string | null;
  /** Shows a button that opens the full-screen map. */
  onExpand?: () => void;
  /**
   * Fill the screen: no rounded card, and room left for a top bar, a bottom
   * sheet and (desktop) a side panel. The legend and privacy notes then live in
   * the panel or sheet, not over the map.
   */
  fill?: { top: number; bottom: number; left?: number };
  /** A card drawn just above the picked pin (the desktop map, plan D14). Tile map only. */
  callout?: React.ReactNode;
  /** While a pin is picked, the others step back. */
  dim?: boolean;
  /** The person has moved the map; where its middle is now (for "Search this area"). */
  onMoveEnd?: (centre: { lat: number; lng: number }) => void;
  /** Where the map starts when there is no `me` (default: the first pin, else Bengaluru). */
  startAt?: { lat: number; lng: number };
  /** How far in the map starts (default 12, a city). Lower shows more of the country. */
  startZoom?: number;
  /**
   * Zoom the map to fit a circle of this radius round `at` whenever `key` changes (the 5 / 10 / 25 km
   * buttons). It is not the person moving the map, so "Search this area" stays hidden.
   */
  fit?: { at: { lat: number; lng: number }; km: number; key: number } | null;
  /** Where the reach ring is drawn; default `me`. */
  ringAt?: { lat: number; lng: number };
  /** A quiet preview (the Find work strip): no buttons, legend or notes, and the map does not move. */
  bare?: boolean;
  /** What `me` is: a live position ("You") or a typed / saved area ("Your area", the default). */
  meKind?: 'live' | 'area';
};

/**
 * The "you" marker (plan explore-location-roles, part 2): an 18 px blue dot with a white rim
 * and soft shadow, a 44 px halo behind it and a small pill under it. Drawn after the pins so
 * nothing covers it, and never dimmed. The halo pulses gently unless motion is reduced.
 * Place it at the point's screen position; the dot's centre sits exactly on it.
 */
export function YouMarker({ x, y, kind = 'area' }: { x: number; y: number; kind?: 'live' | 'area' }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.timing(pulse, { toValue: 1, duration: 1800, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }));
    loop.start();
    return () => loop.stop();
  }, [reduced, pulse]);
  const blue = t.colors.purple;
  const label = kind === 'live' ? 'You' : 'Your area';
  return (
    <View
      pointerEvents="none"
      accessibilityLabel={kind === 'live' ? 'Your location' : 'Your area'}
      style={{ position: 'absolute', left: x, top: y, width: 0, height: 0, alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
    >
      <Animated.View
        style={{
          position: 'absolute',
          width: 44,
          height: 44,
          borderRadius: 999,
          backgroundColor: blue + '2E',
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 0.35] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) }],
        }}
      />
      <View style={{ position: 'absolute', width: 18, height: 18, borderRadius: 999, backgroundColor: blue, borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 }} />
      <View style={{ position: 'absolute', top: 14, left: -50, width: 100, alignItems: 'center' }}>
        <View style={{ backgroundColor: t.colors.ink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
          <RNText style={tx('800', 11, t.colors.bg)}>{label}</RNText>
        </View>
      </View>
    </View>
  );
}

/** Where the middle of the map has to be so a point sits in the middle of the part the bars leave uncovered. */
export function centreFor(
  p: { x: number; y: number },
  fill: { top: number; bottom: number; left?: number } | undefined,
  lift = 0,
): { x: number; y: number } {
  if (!fill) return p;
  return { x: p.x - (fill.left ?? 0) / 2, y: p.y + (fill.bottom - fill.top) / 2 - lift };
}

/** Out to the whole world (owner video, 9 Nov). */
const MIN_ZOOM = 2;
export const MAX_ZOOM = 17;
/** Same reach as the "Near me" filter, drawn as a ring. */
const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };

/**
 * Open jobs (or, for a poster, nearby helpers) on a map (plan D12, after Snap
 * Map). Zoomed out, helpers are service icons and several in one area are a
 * stack of them; jobs are price pins showing each area's biggest offer, with a soft
 * heat glow where the pay is higher. Tap a group, or zoom in, and everyone in
 * it spreads out round the area (lib/mapLayout.ts): every helper with their service,
 * every task with its price, poster and title. Built on the same plain tiles as
 * the location picker, so it runs on web (and in Expo Go) with no extra SDK or
 * key. Installed phone builds use JobsMap.native.tsx instead, because
 * OpenStreetMap turns away tile requests from the app.
 */
export function JobsMap({
  me,
  pins,
  selectedId,
  onSelect,
  height = 320,
  ringKm = RING_KM,
  tone = 'jobs',
  focusId = null,
  onExpand,
  fill,
  callout,
  dim = false,
  onMoveEnd,
  startAt,
  startZoom = 12,
  fit = null,
  ringAt,
  bare = false,
  meKind = 'area',
}: JobsMapProps) {
  const t = useTheme();
  const start = me ?? startAt ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
  // A place shown in the middle of the part the bars leave uncovered, not behind a side panel.
  const clear = (at: { lat: number; lng: number }, z: number) => {
    const p = centreFor(project(at.lat, at.lng, z), fill);
    return unproject(p.x, p.y, z);
  };
  const [centre, setCentre] = useState(() => clear(start, startZoom));
  const [zoom, setZoom] = useState(startZoom);
  const [size, setSize] = useState({ w: 0, h: height });

  const centreRef = useRef(centre);
  centreRef.current = centre;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const origin = useRef(centre);

  // Once the first location arrives, start there; after that the map is the person's to move.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current && me) setCentre(clear(me, zoomRef.current));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me]);

  // The full map's card rail picks a pin: bring it into the middle of the part
  // left uncovered by the top bar and the rail or sheet, close enough to see it on its own.
  useEffect(() => {
    const hit = focusId ? pins.find((p) => p.id === focusId) : null;
    if (!hit) return;
    moved.current = true;
    const z = Math.max(zoomRef.current, SPREAD_ZOOM);
    const p = centreFor(project(hit.lat, hit.lng, z), fill, callout ? CALLOUT_LIFT : 0);
    setCentre(unproject(p.x, p.y, z));
    setZoom(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  // The reach buttons: zoom to fit the circle in the part of the map the bars leave uncovered.
  // Not the person's own move, so onMoveEnd is not called.
  useEffect(() => {
    if (!fit || size.w === 0) return;
    moved.current = true;
    const f = fillRef.current;
    const w = size.w - (f?.left ?? 0);
    const h = size.h - (f ? f.top + f.bottom : 0);
    const z = Math.floor(zoomToFit(fit.km, fit.at.lat, Math.min(w, h)));
    setCentre(clear(fit.at, z));
    setZoom(z);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key, size.w > 0]);

  // The pan handler is made once, so it reads the latest callback through a ref.
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const fillRef = useRef(fill);
  fillRef.current = fill;

  const pan = useRef(
    PanResponder.create({
      // A tap on a pin must reach the pin, so only a real drag takes over.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onMoveShouldSetPanResponderCapture: (_e, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        moved.current = true;
        origin.current = centreRef.current;
      },
      onPanResponderMove: (_e, g) => {
        const z = zoomRef.current;
        const from = project(origin.current.lat, origin.current.lng, z);
        setCentre(unproject(from.x - g.dx, from.y - g.dy, z));
      },
      onPanResponderRelease: (_e, g) => {
        const z = zoomRef.current;
        const from = project(origin.current.lat, origin.current.lng, z);
        // What sits in the middle of the uncovered part, the reverse of centreFor.
        const f = fillRef.current;
        const dx = f ? (f.left ?? 0) / 2 : 0;
        const dy = f ? (f.bottom - f.top) / 2 : 0;
        onMoveEndRef.current?.(unproject(from.x - g.dx + dx, from.y - g.dy - dy, z));
      },
    }),
  ).current;

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });

  const c = project(centre.lat, centre.lng, zoom);
  const left = c.x - size.w / 2;
  const top = c.y - size.h / 2;
  const toScreen = (lat: number, lng: number) => {
    const p = project(lat, lng, zoom);
    return { x: p.x - left, y: p.y - top };
  };

  const tiles = useMemo(() => {
    if (size.w === 0) return [];
    const span = 2 ** zoom;
    const out: { key: string; url: string; x: number; y: number }[] = [];
    for (let ty = Math.floor(top / TILE); ty <= Math.floor((top + size.h) / TILE); ty++) {
      for (let tx2 = Math.floor(left / TILE); tx2 <= Math.floor((left + size.w) / TILE); tx2++) {
        if (ty < 0 || ty >= span) continue;
        out.push({ key: `${zoom}/${tx2}/${ty}`, url: tileUrl(zoom, ((tx2 % span) + span) % span, ty), x: tx2 * TILE - left, y: ty * TILE - top });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centre, zoom, size]);

  const people = tone === 'people';

  const zoomTo = (next: number, at?: { lat: number; lng: number }) => {
    moved.current = true;
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
    if (at) {
      // Zoomed onto a group, it sits in the uncovered part, not behind the panel; the search point is the group itself.
      setCentre(clear(at, z));
      onMoveEnd?.(at);
    }
    setZoom(z);
  };

  const you = me ? toScreen(me.lat, me.lng) : null;
  const ringCentre = ringAt ?? me;
  const ring = ringCentre ? toScreen(ringCentre.lat, ringCentre.lng) : null;
  const ringPx = ringCentre ? (ringKm * 1000) / metresPerPixel(ringCentre.lat, zoom) : 0;
  const blue = t.colors.purple;
  const words = mapWordsOf(tone);

  const control = (label: string, onPress: () => void, child: React.ReactNode) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: fill ? 44 : 36, height: fill ? 44 : 36, borderRadius: fill ? 14 : 10, backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}
    >
      {child}
    </Pressable>
  );

  const frame = fill
    ? // The tiles run past the edges; without the clip they draw over the menu and the page around a full map.
      { flex: 1, overflow: 'hidden' as const, backgroundColor: t.colors.surface2 }
    : { height, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line };
  const padTop = fill ? fill.top : 0;
  const padBottom = fill ? fill.bottom : 0;
  return (
    <View onLayout={onLayout} style={frame}>
      <View {...(bare ? null : pan.panHandlers)} style={{ flex: 1 }}>
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={Platform.OS === 'web' ? { uri: tile.url } : { uri: tile.url, headers: TILE_HEADERS }}
            style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ))}

        {ring ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: ring.x, top: ring.y, width: 0, height: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', width: ringPx * 2, height: ringPx * 2, borderRadius: 999, borderWidth: 1, borderColor: blue + '77', borderStyle: 'dashed' }} />
          </View>
        ) : null}

        <MapPinLayer
          pins={pins}
          tone={tone}
          selectedId={selectedId}
          onSelect={onSelect}
          dim={dim}
          callout={callout}
          leftInset={fill?.left ?? 0}
          size={size}
          zoom={zoom}
          toScreen={toScreen}
          you={you}
          onGroup={(x, y) => zoomTo(Math.max(zoom + 2, SPREAD_ZOOM), unproject(x + left, y + top, zoom))}
        />

        {/* After the pins, so it is on top, and outside the dim layer. */}
        {you ? <YouMarker x={you.x} y={you.y} kind={meKind} /> : null}
      </View>

      {bare ? null : (
      <View style={{ position: 'absolute', right: fill ? 16 : 8, top: (fill ? 16 : 8) + padTop, gap: 6 }}>
        {onExpand ? control('Open the full map', onExpand, <Icon name="expand" size={16} color={t.colors.ink} />) : null}
        {control('Zoom in', () => zoomTo(zoom + 1), <RNText style={tx('700', 18, t.colors.ink)}>+</RNText>)}
        {control('Zoom out', () => zoomTo(zoom - 1), <RNText style={tx('700', 18, t.colors.ink)}>−</RNText>)}
        {me ? control('Back to my area', () => (moved.current = false, setCentre(clear(me, 12)), setZoom(12), onMoveEnd?.(me)), <Icon name="compass" size={18} color={blue} />) : null}
      </View>
      )}

      {fill || bare ? null : (
      <>
      <View pointerEvents="none" style={{ position: 'absolute', left: 8, top: 8 + padTop, right: 56, flexDirection: 'row' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: t.colors.line, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 1 }}>
          {people ? (
            <Icon name="users" size={12} color={blue} />
          ) : (
            <View style={{ width: 14, height: 9, borderRadius: 5, backgroundColor: t.colors.ink }} />
          )}
          <RNText style={tx('600', 11, t.colors.text, { flexShrink: 1 })} numberOfLines={1}>
            {words.legend}
          </RNText>
        </View>
      </View>

      {/* The pill hugs its words: stretched across a wide map it read as a black bar. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 10, bottom: 10 + padBottom, right: 96, flexDirection: 'row' }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            flexShrink: 1,
            backgroundColor: t.colors.bg,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: t.colors.line,
            paddingLeft: 6,
            paddingRight: 12,
            paddingVertical: 5,
            shadowColor: '#000',
            shadowOpacity: 0.12,
            shadowRadius: 8,
            shadowOffset: { width: 0, height: 2 },
            elevation: 2,
          }}
        >
          <View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: people ? t.colors.purpleSoft : t.colors.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="lock" size={11} color={people ? t.colors.purpleDeep : t.colors.accentDeep} />
          </View>
          <RNText style={tx('600', 11, t.colors.text, { flexShrink: 1 })} numberOfLines={2}>
            {words.privacy}
          </RNText>
        </View>
      </View>
      </>
      )}

      {/* OpenStreetMap's licence requires this credit to stay visible. */}
      <RNText style={tx('400', 9, t.colors.muted, { position: 'absolute', right: 6, bottom: 4 + padBottom, backgroundColor: t.colors.bg, paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' })}>
        © OpenStreetMap
      </RNText>
    </View>
  );
}
