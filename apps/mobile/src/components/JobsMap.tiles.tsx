import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, Text as RNText, Pressable, PanResponder, Platform, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { Icon } from './Icon';
import { TILE, TILE_HEADERS, project, tileUrl, unproject } from './MapPicker.tiles';
import { groupPins, metresPerPixel } from '../lib/mapCluster';
import { SPREAD_ZOOM, layoutPins, topAmount, type MapItem } from '../lib/mapLayout';
import { MAX_FRESH, areaAt, easeOut, introDelays, introEnd, rippleAt, tagAt } from '../lib/mapMotion';
import { useMapClock } from './useMapClock';
import { FACE_PIN, FACE_STACK, FacePin, FaceStack, PRICE_PIN, PricePin, TASK_PIN, TaskPin, type Face } from './MapMarkers';

/**
 * One thing on the map. Jobs carry their price as `label` and in rupees as
 * `amount` (an area shows its biggest offer), plus, once known, who posted it
 * and what it is. People (a poster's map of helpers) carry `face` (a service
 * icon), what they offer as `label`, its starting `price` (none when they only
 * list skills) and `more`, their other services; never a name (plan D13).
 * `area` is the place's name ("Madhapur"). `fresh` marks a task posted in the
 * last few minutes, which ripples.
 */
export type JobPin = {
  id: string;
  lat: number;
  lng: number;
  label: string;
  fresh?: boolean;
  face?: Face;
  name?: string;
  price?: string | null;
  more?: number;
  amount?: number;
  who?: string;
  title?: string;
  area?: string;
};

/** Jobs are money (the mode's colour); helpers are faces on blue. */
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
};

/** Where the middle of the map has to be so a point sits in the middle of the part the bars leave uncovered. */
export function centreFor(
  p: { x: number; y: number },
  fill: { top: number; bottom: number; left?: number } | undefined,
  lift = 0,
): { x: number; y: number } {
  if (!fill) return p;
  return { x: p.x - (fill.left ?? 0) / 2, y: p.y + (fill.bottom - fill.top) / 2 - lift };
}

/** How far a callout lifts its pin below the middle, so the card above it stays on screen. */
export const CALLOUT_LIFT = 110;
const CALLOUT_W = 300;

const MIN_ZOOM = 5;
export const MAX_ZOOM = 17;
/** Pins closer than this many pixels join into one group. */
export const CLUSTER_PX = 80;
/** Face stacks are wider, so they join sooner. */
export const CLUSTER_PX_PEOPLE = 96;
/** How far apart pins sit once a group spreads out: across, and up and down. */
export const SPREAD_GAP = { x: 150, y: 104 };
/** Helpers' tags carry a service and price, so they need nearly a job pin's width. */
export const SPREAD_GAP_PEOPLE = { x: 140, y: 98 };
/** Spreading pins fly out from the group's centre for this long. */
export const SPREAD_MS = 450;
/** Same reach as the "Near me" filter, drawn as a ring. */
const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };

/** Short text for the legend and screen readers, by tone. */
export function mapWords(tone: MapTone) {
  return tone === 'people'
    ? { area: 'Helper area', privacy: 'Pins sit in their area, never at a home. Tap to see who', one: 'helper', many: 'helpers', legend: 'Tap a group to see everyone' }
    : { area: 'Job area', privacy: 'Pins show the area, never the exact spot', one: 'job', many: 'jobs', legend: 'Each pin is the biggest offer in that area' };
}

/** What a screen reader says for a helper's pin: the service, never the name. */
export function helperSays(pin: JobPin): string {
  const what = pin.price ? `${pin.label}, from ${pin.price}` : pin.label;
  const more = pin.more ? `, ${pin.more} more ${pin.more === 1 ? 'service' : 'services'}` : '';
  return `${what}${more}${pin.face?.live ? ', active now' : ''}, ${pin.area ?? 'nearby'} area. Tap to see who`;
}

/** The group's or pin's place name, for the label under it. */
export function placeOf(ids: string[], byId: Map<string, JobPin>): string {
  return byId.get(ids[0]!)?.area ?? 'Nearby';
}

/** For jobs: each item's biggest offer and the best one on screen, which is drawn in the mode's colour. */
export function offersOf(items: MapItem[], byId: Map<string, JobPin>) {
  const amountOf = (id: string) => byId.get(id)?.amount;
  const top = items.map((it) => (it.kind === 'group' ? topAmount(it.ids, amountOf) : (amountOf(it.id) ?? null)));
  const best = top.reduce<number | null>((m, a) => (a !== null && (m === null || a > m) ? a : m), null);
  return { top, best };
}

/** Jobs with the biggest offer first; people keep the caller's order. */
export function byOffer(pins: JobPin[], people: boolean): JobPin[] {
  return people ? pins : [...pins].sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0));
}

/** The pin with the biggest offer in a group: its price is the one shown. */
export function topPinOf(ids: string[], byId: Map<string, JobPin>): JobPin {
  let pick = byId.get(ids[0]!)!;
  for (const id of ids) {
    const p = byId.get(id)!;
    if ((p.amount ?? 0) > (pick.amount ?? 0)) pick = p;
  }
  return pick;
}

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
}: JobsMapProps) {
  const t = useTheme();
  const start = me ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
  // A place shown in the middle of the part the bars leave uncovered, not behind a side panel.
  const clear = (at: { lat: number; lng: number }, z: number) => {
    const p = centreFor(project(at.lat, at.lng, z), fill);
    return unproject(p.x, p.y, z);
  };
  const [centre, setCentre] = useState(() => clear(start, 12));
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
  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  // A spread area puts its first pin at the top: the biggest offer, or (as the caller orders them) someone active now.
  const placed = byOffer(pins, people).map((p) => ({ id: p.id, ...toScreen(p.lat, p.lng) }));
  const inView = placed.filter((p) => p.x > -120 && p.x < size.w + 120 && p.y > -120 && p.y < size.h + 120);
  const items = layoutPins(groupPins(inView, people ? CLUSTER_PX_PEOPLE : CLUSTER_PX), { zoom, gap: people ? SPREAD_GAP_PEOPLE : SPREAD_GAP });
  const offers = people ? null : offersOf(items, byId);

  const zoomTo = (next: number, at?: { lat: number; lng: number }) => {
    moved.current = true;
    if (at) {
      setCentre(at);
      onMoveEnd?.(at);
    }
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  };

  const you = me ? toScreen(me.lat, me.lng) : null;
  const ringPx = me ? (ringKm * 1000) / metresPerPixel(me.lat, zoom) : 0;
  const blue = t.colors.purple;
  const hue = people ? blue : t.colors.btn;
  // The poster is a dark dot on a map of helpers' faces, so the two never mix up.
  const youColor = people ? t.colors.ink : blue;
  const words = mapWords(tone);

  // The intro replays for a new set of things, not when the map is moved.
  const introKey = useMemo(() => pins.map((p) => p.id).sort().join('|'), [pins]);
  const freshIds = useMemo(() => new Set(pins.filter((p) => p.fresh).slice(0, MAX_FRESH).map((p) => p.id)), [pins]);
  const clock = useMapClock(introKey, introEnd(pins.length), freshIds.size > 0);
  const delays = introDelays(items, you);
  // Groups that have just spread fly out from their centre.
  const spreadKey = items.map((it) => (it.kind === 'one' && it.area ? it.id : '')).join('');
  const spreadClock = useMapClock(spreadKey, SPREAD_MS, false);
  const fan = easeOut(spreadClock.elapsed / SPREAD_MS);
  const at = (it: MapItem) =>
    it.kind === 'one' && it.area ? { x: it.area.x + (it.x - it.area.x) * fan, y: it.area.y + (it.y - it.area.y) * fan } : { x: it.x, y: it.y };

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

  // Where the picked pin is drawn, when it stands alone (a group zooms in first), and how tall it is.
  const pickedItem = callout && selectedId ? items.find((it) => it.kind === 'one' && it.id === selectedId) : undefined;
  const pickedAt = pickedItem
    ? { ...at(pickedItem), lift: (pickedItem.kind === 'one' && pickedItem.area ? TASK_PIN.anchor : PRICE_PIN.anchor) + 10 }
    : null;

  const frame = fill
    ? // The tiles run past the edges; without the clip they draw over the menu and the page around a full map.
      { flex: 1, overflow: 'hidden' as const, backgroundColor: t.colors.surface2 }
    : { height, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line };
  const padTop = fill ? fill.top : 0;
  const padBottom = fill ? fill.bottom : 0;
  const areas = new Map<string, { x: number; y: number; r: number }>();
  for (const it of items) if (it.kind === 'one' && it.area) areas.set(`${it.area.x},${it.area.y}`, { x: it.area.x, y: it.area.y, r: Math.max(it.area.rx, it.area.ry) });

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
            <View style={{ position: 'absolute', width: ringPx * 2, height: ringPx * 2, borderRadius: 999, borderWidth: 1, borderColor: blue + '77', borderStyle: 'dashed' }} />
            <View style={{ position: 'absolute', width: 26, height: 26, borderRadius: 999, backgroundColor: youColor + '40' }} />
            <View style={{ position: 'absolute', width: 14, height: 14, borderRadius: 999, backgroundColor: youColor, borderWidth: 2.5, borderColor: '#FFFFFF' }} />
          </View>
        ) : null}

        {/* Spread areas: one soft circle behind everyone in it, never a spot. */}
        {[...areas.entries()].map(([key, a]) => (
          <View
            key={'area-' + key}
            pointerEvents="none"
            style={{ position: 'absolute', left: a.x - a.r, top: a.y - a.r, width: a.r * 2, height: a.r * 2, borderRadius: 999, backgroundColor: hue + '1A', borderWidth: 1, borderColor: hue + '80', borderStyle: 'dashed' }}
          />
        ))}

        {/* Jobs: a soft heat glow under each area, stronger where the biggest offer is higher. */}
        {offers && offers.best
          ? items.map((it, i) => {
              if (it.kind === 'one' && it.area) return null;
              const k = (offers.top[i] ?? 0) / offers.best!;
              const a = areaAt(clock.elapsed, delays[i]!);
              if (!a.shown) return null;
              const r = (36 + 46 * k) * a.scale;
              return (
                <View key={'heat-' + i} pointerEvents="none" style={{ position: 'absolute', left: it.x - r, top: it.y - r, width: r * 2, height: r * 2, alignItems: 'center', justifyContent: 'center' }}>
                  {[1, 0.66, 0.36].map((s) => (
                    <View key={s} style={{ position: 'absolute', width: r * 2 * s, height: r * 2 * s, borderRadius: 999, backgroundColor: hue, opacity: (0.05 + 0.1 * k) }} />
                  ))}
                </View>
              );
            })
          : null}

        {items.map((it, i) => {
          const pop = tagAt(clock.elapsed, delays[i]!);
          if (pop === 0) return null;
          const p = at(it);
          const back = dim && selectedId !== null && !(it.kind === 'one' && it.id === selectedId);
          const drop = { opacity: pop * (back ? 0.45 : 1), transform: [{ translateY: -10 * (1 - pop) }] };
          if (it.kind === 'group') {
            const key = 'g-' + it.ids.join('|');
            const into = () => zoomTo(Math.max(zoom + 2, SPREAD_ZOOM), unproject(it.x + left, it.y + top, zoom));
            if (people) {
              const shown = it.ids.slice(0, 3).map((id) => ({ seed: id, face: byId.get(id)!.face ?? { initials: '?', live: false } }));
              return (
                <Pressable
                  key={key}
                  onPress={into}
                  accessibilityRole="button"
                  accessibilityLabel={`${it.ids.length} ${words.many} in ${placeOf(it.ids, byId)} area. Spread them out`}
                  style={[{ position: 'absolute', left: p.x - FACE_STACK.w / 2, top: p.y - FACE_STACK.anchor, zIndex: 1 }, drop]}
                >
                  <FaceStack faces={shown} extra={it.ids.length - shown.length} label={`${placeOf(it.ids, byId)} · ${it.ids.length}`} />
                </Pressable>
              );
            }
            const topPin = topPinOf(it.ids, byId);
            const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
            return (
              <Pressable
                key={key}
                onPress={into}
                accessibilityRole="button"
                accessibilityLabel={`${it.ids.length} ${words.many} in ${placeOf(it.ids, byId)} area, biggest offer ${topPin.label}. Zoom in`}
                style={[{ position: 'absolute', left: p.x - PRICE_PIN.w / 2, top: p.y - PRICE_PIN.anchor, zIndex: best ? 2 : 1 }, drop]}
              >
                <PricePin price={topPin.label} best={best} on={false} place={placeOf(it.ids, byId)} count={`${it.ids.length} ${words.many}`} />
              </Pressable>
            );
          }

          const pin = byId.get(it.id)!;
          const on = selectedId === it.id;
          const pick = () => onSelect(on ? null : it.id);
          const spread = it.area !== null;
          if (people) {
            return (
              <Pressable
                key={'p-' + it.id}
                onPress={pick}
                accessibilityRole="button"
                accessibilityLabel={helperSays(pin)}
                accessibilityState={{ selected: on }}
                style={[{ position: 'absolute', left: p.x - FACE_PIN.w / 2, top: p.y - FACE_PIN.anchor, zIndex: on ? 3 : 1 }, drop]}
              >
                <FacePin face={pin.face ?? { initials: '?', live: false }} seed={pin.id} what={pin.label} price={pin.price} more={pin.more} on={on} glow />
              </Pressable>
            );
          }
          const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
          const ripple = freshIds.has(it.id) && !clock.still ? rippleAt(clock.now, i * 1200) : null;
          return (
            <View key={'j-' + it.id} pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, zIndex: on ? 3 : best ? 2 : 1 }}>
              {ripple !== null ? (
                <View
                  pointerEvents="none"
                  style={{ position: 'absolute', left: p.x - 20 - 30 * ripple, top: p.y - 20 - 30 * ripple, width: 40 + 60 * ripple, height: 40 + 60 * ripple, borderRadius: 999, borderWidth: 2, borderColor: hue, opacity: 0.8 * (1 - ripple) }}
                />
              ) : null}
              <Pressable
                onPress={pick}
                accessibilityRole="button"
                accessibilityLabel={`${pin.label}${pin.title ? ', ' + pin.title : ''}${pin.who ? ', posted by ' + pin.who : ''}, ${pin.area ?? 'nearby'} area`}
                accessibilityState={{ selected: on }}
                style={[{ position: 'absolute', left: p.x - (spread ? TASK_PIN.w : PRICE_PIN.w) / 2, top: p.y - (spread ? TASK_PIN.anchor : PRICE_PIN.anchor) }, drop]}
              >
                {spread ? (
                  <TaskPin price={pin.label} face={pin.face} seed={pin.id} who={pin.who} title={pin.title} best={best} on={on} />
                ) : (
                  <PricePin price={pin.label} best={best} on={on} place={pin.area ?? 'Nearby'} />
                )}
              </Pressable>
            </View>
          );
        })}

        {/* The picked pin's card sits right above it (desktop, plan D14). */}
        {callout && pickedAt ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', left: pickedAt.x - CALLOUT_W / 2, bottom: size.h - pickedAt.y + pickedAt.lift, width: CALLOUT_W, zIndex: 5 }}>
            {callout}
          </View>
        ) : null}
      </View>

      <View style={{ position: 'absolute', right: fill ? 16 : 8, top: (fill ? 16 : 8) + padTop, gap: 6 }}>
        {onExpand ? control('Open the full map', onExpand, <Icon name="expand" size={16} color={t.colors.ink} />) : null}
        {control('Zoom in', () => zoomTo(zoom + 1), <RNText style={tx('700', 18, t.colors.ink)}>+</RNText>)}
        {control('Zoom out', () => zoomTo(zoom - 1), <RNText style={tx('700', 18, t.colors.ink)}>−</RNText>)}
        {me ? control('Back to my area', () => (moved.current = false, setCentre(clear(me, 12)), setZoom(12), onMoveEnd?.(me)), <Icon name="compass" size={18} color={blue} />) : null}
      </View>

      {fill ? null : (
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
