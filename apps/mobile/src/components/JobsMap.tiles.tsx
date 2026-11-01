import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, Text as RNText, Pressable, PanResponder, Platform, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { Icon } from './Icon';
import { TILE, TILE_HEADERS, project, tileUrl, unproject } from './MapPicker.tiles';
import { groupPins, metresPerPixel } from '../lib/mapCluster';
import { MAX_FRESH, areaAt, groupScale, introDelays, introEnd, rippleAt, tagAt } from '../lib/mapMotion';
import { useMapClock } from './useMapClock';

/**
 * One thing on the map. Jobs carry their price as `label`; people (a poster's
 * map of helpers) also carry `face`: initials and whether they are active now.
 * `fresh` marks a task posted in the last few minutes, which ripples.
 */
export type JobPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  fresh?: boolean;
  face?: { initials: string; live: boolean };
};

/** Jobs are jade (hiring money); helpers are blue (the people who earn). */
export type MapTone = 'jobs' | 'people';

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
  /** Fill the screen: no rounded card, and room left for a top bar and a card rail. */
  fill?: { top: number; bottom: number };
};

const MIN_ZOOM = 5;
const MAX_ZOOM = 17;
/** Two tags closer than this many pixels become one numbered circle. */
const CLUSTER_PX = 46;
/** Helper tags are wider (face, skill and rating), so they join sooner. */
const CLUSTER_PX_PEOPLE = 84;
/** Same reach as the "Near me" filter, drawn as a ring. */
const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };
/**
 * How far round a job its soft circle reaches. The published coordinates are
 * rounded to about a kilometre (migration 074), so a circle this size says
 * "somewhere around here" and never points at a door.
 */
const AREA_M = 800;

/** Short text for the legend and screen readers, by tone. */
export function mapWords(tone: MapTone) {
  return tone === 'people'
    ? { area: 'Helper area', privacy: 'Area only, never where they live', one: 'helper', many: 'helpers' }
    : { area: 'Job area', privacy: 'Circles show the area, never the exact spot', one: 'job', many: 'jobs' };
}

/**
 * Open jobs (or, for a poster, nearby helpers) on a map. You are the dot with
 * your reach drawn around you, and each item is a soft circle with its tag in
 * the middle: the area, never a point. Close tags join into a number; tap it to
 * zoom in. On first show each circle starts as a dot and spreads out, nearest
 * first, then everything holds still (lib/mapMotion.ts). Built on the same
 * plain tiles as the location picker, so it runs on web (and in Expo Go) with
 * no extra SDK or key. Installed phone builds use JobsMap.native.tsx instead,
 * because OpenStreetMap turns away tile requests from the app.
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
}: JobsMapProps) {
  const t = useTheme();
  const start = me ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
  const [centre, setCentre] = useState(start);
  const [zoom, setZoom] = useState(12);
  const [size, setSize] = useState({ w: 0, h: height });

  const centreRef = useRef(centre);
  centreRef.current = centre;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const origin = useRef(centre);

  // Once the first location arrives, start there; after that the map is the person's to move.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current && me) setCentre(me);
  }, [me]);

  // The full map's card rail picks a pin: bring it into the middle.
  useEffect(() => {
    const hit = focusId ? pins.find((p) => p.id === focusId) : null;
    if (!hit) return;
    moved.current = true;
    setCentre({ lat: hit.lat, lng: hit.lng });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const pan = useRef(
    PanResponder.create({
      // A tap on a tag must reach the tag, so only a real drag takes over.
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

  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  const placed = pins.map((p) => ({ id: p.id, ...toScreen(p.lat, p.lng) }));
  const inView = placed.filter((p) => p.x > -60 && p.x < size.w + 60 && p.y > -60 && p.y < size.h + 60);
  const groups = groupPins(inView, tone === 'people' ? CLUSTER_PX_PEOPLE : CLUSTER_PX);

  const zoomTo = (next: number, at?: { lat: number; lng: number }) => {
    moved.current = true;
    if (at) setCentre(at);
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  };

  const you = me ? toScreen(me.lat, me.lng) : null;
  const ringPx = me ? (ringKm * 1000) / metresPerPixel(me.lat, zoom) : 0;
  // Never smaller than the tag it holds, so the area still reads when zoomed out.
  const areaPx = Math.max(30, AREA_M / metresPerPixel(centre.lat, zoom));
  const blue = t.colors.purple;
  const hue = tone === 'people' ? blue : t.colors.accent;
  // The poster is a dark dot on a map of blue helpers, so the two never mix up.
  const youColor = tone === 'people' ? t.colors.ink : blue;
  const words = mapWords(tone);

  // The intro replays for a new set of things, not when the map is moved.
  const introKey = useMemo(() => pins.map((p) => p.id).sort().join('|'), [pins]);
  const freshIds = useMemo(() => new Set(pins.filter((p) => p.fresh).slice(0, MAX_FRESH).map((p) => p.id)), [pins]);
  const clock = useMapClock(introKey, introEnd(pins.length), freshIds.size > 0);
  const delays = introDelays(groups, you);

  const control = (label: string, onPress: () => void, child: React.ReactNode) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{ width: 36, height: 36, borderRadius: 10, backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}
    >
      {child}
    </Pressable>
  );

  const frame = fill
    ? { flex: 1, backgroundColor: t.colors.surface2 }
    : { height, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line };
  const padTop = fill ? fill.top : 0;
  const padBottom = fill ? fill.bottom : 0;

  return (
    <View onLayout={onLayout} style={frame}>
      <View {...pan.panHandlers} style={{ flex: 1 }}>
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={Platform.OS === 'web' ? { uri: tile.url } : { uri: tile.url, headers: TILE_HEADERS }}
            style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ))}

        {you ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: you.x, top: you.y, width: 0, height: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', width: ringPx * 2, height: ringPx * 2, borderRadius: 999, borderWidth: 1.5, borderColor: blue, borderStyle: 'dashed', backgroundColor: blue + '12' }} />
            <View style={{ position: 'absolute', width: 34, height: 34, borderRadius: 999, backgroundColor: youColor + '33' }} />
            <View style={{ position: 'absolute', width: 16, height: 16, borderRadius: 999, backgroundColor: youColor, borderWidth: 3, borderColor: '#FFFFFF' }} />
          </View>
        ) : null}

        {/* Areas first, so every tag sits above every circle. */}
        {groups.map((g, i) => {
          const many = g.ids.length > 1;
          const on = !many && selectedId === g.ids[0];
          const r = areaPx * groupScale(g.ids.length);
          const a = areaAt(clock.elapsed, delays[i]!);
          if (!a.shown) return null;
          const rr = Math.max(4, r * a.scale);
          const fillA = Math.round(0x26 + (0xcc - 0x26) * a.dense);
          const ripple = !many && freshIds.has(g.ids[0]!) && !clock.still ? rippleAt(clock.now, i * 1200) : null;
          return (
            <View key={'area-' + g.ids.join('|')} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0 }}>
              <View
                style={{
                  position: 'absolute',
                  left: g.x - rr,
                  top: g.y - rr,
                  width: rr * 2,
                  height: rr * 2,
                  borderRadius: 999,
                  backgroundColor: hue + (on ? '38' : fillA.toString(16).padStart(2, '0')),
                  borderWidth: on ? 2.5 : 1.5,
                  borderColor: hue + (on ? 'CC' : '66'),
                }}
              />
              {ripple !== null ? (
                <View
                  style={{
                    position: 'absolute',
                    left: g.x - r * (1 + 0.5 * ripple),
                    top: g.y - r * (1 + 0.5 * ripple),
                    width: r * 2 * (1 + 0.5 * ripple),
                    height: r * 2 * (1 + 0.5 * ripple),
                    borderRadius: 999,
                    borderWidth: 2,
                    borderColor: hue,
                    opacity: 0.75 * (1 - ripple),
                  }}
                />
              ) : null}
            </View>
          );
        })}

        {groups.map((g, i) => {
          const pop = tagAt(clock.elapsed, delays[i]!);
          if (pop === 0) return null;
          const lift = { opacity: pop, transform: [{ translateY: 6 * (1 - pop) }, { scale: 0.85 + 0.15 * pop }] };
          if (g.ids.length > 1) {
            // Items in the same rounded area never come apart, however far in;
            // at the last zoom step a tap opens the first of them instead.
            const deepest = zoom >= MAX_ZOOM;
            return (
              <Pressable
                key={'tag-' + g.ids.join('|')}
                onPress={() => {
                  if (deepest) return onSelect(g.ids[0]!);
                  const at = unproject(g.x + left, g.y + top, zoom);
                  zoomTo(zoom + 2, at);
                }}
                accessibilityRole="button"
                accessibilityLabel={deepest ? `${g.ids.length} ${words.many} in this area. Open the first` : `${g.ids.length} ${words.many} here. Zoom in`}
                style={[
                  { position: 'absolute', left: g.x - 19, top: g.y - 19, width: 38, height: 38, borderRadius: 999, backgroundColor: tone === 'people' ? blue : t.colors.btn, borderWidth: 3, borderColor: t.colors.bg, alignItems: 'center', justifyContent: 'center' },
                  lift,
                ]}
              >
                <RNText style={tx('800', 15, tone === 'people' ? '#FFFFFF' : t.colors.onBtn)}>{g.ids.length}</RNText>
              </Pressable>
            );
          }
          const id = g.ids[0]!;
          const pin = byId.get(id)!;
          const on = selectedId === id;
          if (pin.face) {
            const w = pin.label.length * 7.4 + 46;
            return (
              <Pressable
                key={'tag-' + id}
                onPress={() => onSelect(on ? null : id)}
                accessibilityRole="button"
                accessibilityLabel={`${pin.label}${pin.face.live ? ', active now' : ''}, around this area`}
                accessibilityState={{ selected: on }}
                hitSlop={6}
                style={[
                  { position: 'absolute', left: g.x - w / 2, top: g.y - 16, width: w, height: 32, borderRadius: 999, backgroundColor: on ? t.colors.purpleDeep : t.colors.bg, borderWidth: 1, borderColor: on ? t.colors.purpleDeep : t.colors.line, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 3, zIndex: on ? 2 : 1 },
                  lift,
                ]}
              >
                <View style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: t.colors.purpleSoft, alignItems: 'center', justifyContent: 'center' }}>
                  <RNText style={tx('800', 9.5, t.colors.purpleDeep)}>{pin.face.initials}</RNText>
                  {pin.face.live ? (
                    <View style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: 999, backgroundColor: '#22C55E', borderWidth: 2, borderColor: t.colors.bg }} />
                  ) : null}
                </View>
                <RNText style={tx('800', 12, on ? '#FFFFFF' : t.colors.ink)} numberOfLines={1}>
                  {pin.label}
                </RNText>
              </Pressable>
            );
          }
          const w = pin.label.length * 9 + 24;
          const h = on ? 34 : 28;
          return (
            <Pressable
              key={'tag-' + id}
              onPress={() => onSelect(on ? null : id)}
              accessibilityRole="button"
              accessibilityLabel={`Job for ${pin.label}, around this area`}
              accessibilityState={{ selected: on }}
              hitSlop={8}
              style={[
                { position: 'absolute', left: g.x - w / 2, top: g.y - h / 2, width: w, height: h, borderRadius: 999, backgroundColor: on ? t.colors.ink : t.colors.btn, borderWidth: 2.5, borderColor: t.colors.bg, alignItems: 'center', justifyContent: 'center', zIndex: on ? 2 : 1 },
                lift,
              ]}
            >
              <RNText style={tx('800', on ? 14 : 13, on ? t.colors.bg : t.colors.onBtn, { fontVariant: ['tabular-nums'] })}>{pin.label}</RNText>
            </Pressable>
          );
        })}
      </View>

      <View style={{ position: 'absolute', right: 8, top: 8 + padTop, gap: 6 }}>
        {onExpand ? control('Open the full map', onExpand, <Icon name="expand" size={16} color={t.colors.ink} />) : null}
        {control('Zoom in', () => zoomTo(zoom + 1), <RNText style={tx('700', 18, t.colors.ink)}>+</RNText>)}
        {control('Zoom out', () => zoomTo(zoom - 1), <RNText style={tx('700', 18, t.colors.ink)}>−</RNText>)}
        {me ? control('Back to my area', () => (moved.current = false, setCentre(me), setZoom(12)), <Icon name="compass" size={18} color={blue} />) : null}
      </View>

      <View style={{ position: 'absolute', left: 8, top: 8 + padTop, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: t.colors.line, paddingHorizontal: 10, paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: youColor }} />
          <RNText style={tx('600', 11, t.colors.text)}>You</RNText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: hue + '33', borderWidth: 1.5, borderColor: hue }} />
          <RNText style={tx('600', 11, t.colors.text)}>{words.area}</RNText>
        </View>
        {freshIds.size > 0 ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <View style={{ width: 12, height: 12, borderRadius: 999, borderWidth: 1.5, borderColor: hue, borderStyle: 'dashed' }} />
            <RNText style={tx('600', 11, t.colors.text)}>Just posted</RNText>
          </View>
        ) : null}
      </View>

      <View pointerEvents="none" style={{ position: 'absolute', left: 8, bottom: 8 + padBottom, right: 96, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Icon name="lock" size={12} color={tone === 'people' ? t.colors.purpleDeep : t.colors.accentDeep} />
        <RNText style={tx('600', 11, t.colors.text, { flexShrink: 1 })} numberOfLines={2}>
          {words.privacy}
        </RNText>
      </View>

      {/* OpenStreetMap's licence requires this credit to stay visible. */}
      <RNText style={tx('400', 9, t.colors.muted, { position: 'absolute', right: 6, bottom: 4 + padBottom, backgroundColor: t.colors.bg, paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' })}>
        © OpenStreetMap
      </RNText>
    </View>
  );
}
