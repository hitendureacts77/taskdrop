import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, type LayoutChangeEvent } from 'react-native';
import type { CameraRef, LayerProps } from '@maplibre/maplibre-react-native';
import { ML, type MapLibre } from '../lib/mapLibreNative';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { Icon } from './Icon';
import { project, unproject } from './MapPicker.tiles';
import {
  CLUSTER_PX,
  CLUSTER_PX_PEOPLE,
  JobsMap as TileJobsMap,
  MAX_ZOOM,
  SPREAD_GAP,
  SPREAD_GAP_PEOPLE,
  byOffer,
  mapWords,
  offersOf,
  placeOf,
  topPinOf,
  helperSays,
  type JobsMapProps,
} from './JobsMap.tiles';
import { groupPins, metresPerPixel } from '../lib/mapCluster';
import { zoomToFit } from '../lib/mapReach';
import { useReducedMotion } from '../lib/motion';
import { SPREAD_ZOOM, layoutPins } from '../lib/mapLayout';
import { youRect } from '../lib/mapLabels';
import { SRC, buildingLayer, glToTile, sceneShapes, shapeLayers, tileToGl, tiltAfterZoom } from '../lib/mapLayers';
import { glStyleUrl } from '../lib/mapStyle';
import { SPREAD_MS, controlsRect, itemKey, jobSays, pinBox, pinLabels, stackLabel } from './MapPinLayer';
import { MAX_FRESH, TAG_MS, introDelays, introEnd } from '../lib/mapMotion';
import { RIPPLE_ROOM } from '../lib/mapMotion';
import { usePinEpoch } from './usePinEpoch';
import { FACE_PIN, FACE_STACK, FacePin, FaceStack, PRICE_PIN, PROMO_PIN, PinMotion, PricePin, PromotedPin, TASK_PIN, TaskPin, hireColours, sideHue, type PinEnter } from './MapMarkers';

export type { JobPin, MapTone, JobsMapProps } from './JobsMap.tiles';
export { mapWords } from './JobsMap.tiles';

/**
 * Plan 1.20 (design D33): the phone map is MapLibre Native, the engine the web
 * map already uses, with the same OpenFreeMap styles. Pins are real native
 * views the engine moves itself (no bitmap snapshots); the ring, spread areas,
 * heat glow and "Approximate area" circle are engine-drawn layers
 * (lib/mapLayers.ts). The grouping rules are unchanged. Expo Go and builds
 * without the native module get the tile map (lib/mapLibreNative.ts).
 */
// Only read inside components that render when ML is not null.
const { Map: MLMap, Camera, GeoJSONSource, Layer, Marker } = (ML ?? {}) as MapLibre;

/** Out to the whole world (owner video, 9 Nov). App zoom (256 px tiles); the engine's is one lower. */
const MIN_ZOOM = 2;
const START_ZOOM = 12;
const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };
/** How long the camera takes to fly into a tapped group. */
const FLY_MS = 600;

type Props = JobsMapProps;

export function JobsMap(props: Props) {
  return ML ? <NativeJobsMap {...props} /> : <TileJobsMap {...props} />;
}

/** The id of the base style's first label layer, so the shapes can slide in underneath it. null = none found. */
const firstSymbol = new globalThis.Map<string, string | null>();
function useFirstSymbolLayer(isDark: boolean): string | null | undefined {
  const url = glStyleUrl(isDark);
  const [id, setId] = useState<string | null | undefined>(firstSymbol.get(url));
  useEffect(() => {
    if (firstSymbol.has(url)) {
      setId(firstSymbol.get(url));
      return;
    }
    let live = true;
    fetch(url)
      .then((r) => r.json())
      .then((j: { layers?: { id: string; type: string }[] }) => j.layers?.find((l) => l.type === 'symbol')?.id ?? null)
      .catch(() => null)
      .then((found) => {
        firstSymbol.set(url, found);
        if (live) setId(found);
      });
    return () => {
      live = false;
    };
  }, [url]);
  return id;
}

/** One marker holding a pin from MapMarkers, lined up so the pin's point sits on the place. */
function PinMarker({
  at,
  box,
  z,
  label,
  onPress,
  faded = false,
  enter = null,
  ripple = null,
  hue,
  children,
}: {
  at: { lat: number; lng: number };
  box: { w: number; h: number; anchor: number };
  z: number;
  label: string;
  onPress: () => void;
  faded?: boolean;
  /** Intro or burst, played once inside the pin (PinMotion). */
  enter?: PinEnter | null;
  /** Turn of a just-posted task's ripple; its marker box gets room so the ring is never clipped. */
  ripple?: number | null;
  hue?: string;
  children: React.ReactNode;
}) {
  // The offset stays the same when the box grows evenly on every side, so the pin's point still sits on the place.
  const room = ripple !== null ? RIPPLE_ROOM : 0;
  return (
    <Marker lngLat={[at.lng, at.lat]} anchor="center" offset={[0, box.h / 2 - box.anchor]} style={{ zIndex: z }} onPress={onPress} accessibilityLabel={label}>
      <View style={{ width: box.w + room * 2, height: box.h + room * 2, padding: room, opacity: faded ? 0.45 : 1 }} collapsable={false}>
        <PinMotion box={box} enter={enter} ripple={ripple} hue={hue}>
          {children}
        </PinMotion>
      </View>
    </Marker>
  );
}

/** The "you" marker box: the dot's centre is 22 px down, the "You" pill hangs below it. */
const YOU_BOX = { w: 80, h: 64, dotY: 22 };

/** Above every pin; not tappable. */
function YouDot({ at, color, kind }: { at: { lat: number; lng: number }; color: string; kind: 'live' | 'area' }) {
  const t = useTheme();
  return (
    <Marker lngLat={[at.lng, at.lat]} anchor="center" offset={[0, YOU_BOX.h / 2 - YOU_BOX.dotY]} style={{ zIndex: 1000 }} pointerEvents="none" accessibilityLabel={kind === 'live' ? 'Your location' : 'Your area'}>
      <View style={{ width: YOU_BOX.w, height: YOU_BOX.h, alignItems: 'center' }} collapsable={false}>
        <View style={{ position: 'absolute', top: YOU_BOX.dotY - 22, width: 44, height: 44, borderRadius: 999, backgroundColor: color + '2E' }} />
        <View style={{ position: 'absolute', top: YOU_BOX.dotY - 9, width: 18, height: 18, borderRadius: 999, backgroundColor: color, borderWidth: 3, borderColor: '#FFFFFF', shadowColor: '#000', shadowOpacity: 0.3, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 3 }} />
        {/* Only "You" gets a pill. "Your area" sat on top of the group's tag under the dot (round 7); the header names the area. */}
        {kind === 'live' ? (
          <View style={{ position: 'absolute', top: YOU_BOX.dotY + 14, backgroundColor: t.colors.ink, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2 }}>
            <RNText style={tx('800', 11, t.colors.bg)}>You</RNText>
          </View>
        ) : null}
      </View>
    </Marker>
  );
}

type ViewNow = { lat: number; lng: number; glZoom: number; pitch: number };
type ChangeEvent = { nativeEvent: { center: [number, number]; zoom: number; pitch: number; userInteraction: boolean } };

function NativeJobsMap({ me, pins, selectedId, onSelect, height = 320, ringKm = RING_KM, tone = 'jobs', focusId = null, onExpand, fill, dim = false, onMoveEnd, startAt, startZoom = START_ZOOM, fit = null, ringAt, bare = false, meKind = 'area' }: Props) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const camera = useRef<CameraRef>(null);
  const start = me ?? startAt ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
  const [size, setSize] = useState({ w: 0, h: height });
  const [view, setView] = useState<ViewNow>({ lat: start.lat, lng: start.lng, glZoom: tileToGl(startZoom), pitch: 0 });
  const below = useFirstSymbolLayer(t.isDark);
  // Once the first location arrives, start there; after that the map is the person's to move.
  const moved = useRef(false);

  const padTop = fill ? fill.top : 0;
  const padBottom = fill ? fill.bottom : 0;
  const padLeft = fill?.left ?? 0;

  /** A camera move. `app` is an app (256 px tile) zoom, or null to keep the zoom. Reduced motion makes it instant. */
  const move = (center: { lat: number; lng: number }, app: number | null, ms: number) => {
    moved.current = true;
    camera.current?.easeTo({
      center: [center.lng, center.lat],
      ...(app === null ? null : { zoom: tileToGl(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, app))) }),
      duration: reduced ? 0 : ms,
    });
  };

  useEffect(() => {
    if (!moved.current && me) {
      camera.current?.easeTo({ center: [me.lng, me.lat], zoom: tileToGl(START_ZOOM), duration: reduced ? 0 : 400 });
    }
    // The numbers, not the object: a new object with the same place must not pull the camera back.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.lat, me?.lng]);

  // The reach buttons: fly to fit the circle. The camera follows, but only the person's own
  // gestures reach onMoveEnd, so "Search this area" does not appear by itself.
  useEffect(() => {
    if (!fit || size.w === 0) return;
    const w = size.w - padLeft;
    const h = size.h - padTop - padBottom;
    move(fit.at, zoomToFit(fit.km, fit.at.lat, Math.min(w, h)), 400);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key, size.w > 0]);

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });

  // What the screen shows, as the app's 256 px zoom, so the same pixel layout as the tile map
  // runs on top of the native camera. The camera centre sits in the middle of the part the
  // sheets leave uncovered (contentInset), so the layout's origin is moved there.
  const zoom = glToTile(view.glZoom);
  const cx = padLeft + (size.w - padLeft) / 2;
  const cy = padTop + (size.h - padTop - padBottom) / 2;
  const c = project(view.lat, view.lng, zoom);
  const left = c.x - cx;
  const top = c.y - cy;
  const toPlace = (x: number, y: number) => unproject(x + left, y + top, zoom);

  // The full map's card rail picks a pin: bring it into the middle, close enough to see it on its own.
  useEffect(() => {
    const hit = focusId ? pins.find((p) => p.id === focusId) : null;
    if (!hit) return;
    move(hit, Math.max(Math.round(zoom), SPREAD_ZOOM), 350);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const people = tone === 'people';
  const byId = useMemo(() => new globalThis.Map(pins.map((p) => [p.id, p])), [pins]);
  // The layout runs when the map stops moving (the view state changes then), never per frame.
  const items = useMemo(() => {
    if (size.w === 0) return [];
    const placed = byOffer(pins, people).map((p) => {
      const q = project(p.lat, p.lng, zoom);
      return { id: p.id, x: q.x - left, y: q.y - top };
    });
    const inView = placed.filter((p) => p.x > -120 && p.x < size.w + 120 && p.y > -120 && p.y < size.h + 120);
    return layoutPins(groupPins(inView, people ? CLUSTER_PX_PEOPLE : CLUSTER_PX), {
      zoom,
      gap: people ? SPREAD_GAP_PEOPLE : SPREAD_GAP,
      box: (id, spread) => pinBox(byId.get(id), people, spread),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, view, size, tone]);
  const offers = people ? null : offersOf(items, byId);

  // Motion inside the pins plays for a new set of things (not on map moves) and when the zoom crosses the spread level.
  const introKey = useMemo(() => pins.map((p) => p.id).sort().join('|'), [pins]);
  const introLive = usePinEpoch(introKey, introEnd(pins.length) + TAG_MS);
  const spreadLive = usePinEpoch(zoom >= SPREAD_ZOOM ? 'spread' : 'stacked', SPREAD_MS + 100);
  const freshIds = useMemo(() => [...pins.filter((p) => p.fresh).slice(0, MAX_FRESH).map((p) => p.id)], [pins]);

  const youAt = me ? project(me.lat, me.lng, zoom) : null;
  const youOnScreen = youAt ? { x: youAt.x - left, y: youAt.y - top } : null;
  // Names that would overlap step back, and pins under the buttons step aside (P1-14, lib/mapLabels.ts).
  const labels = pinLabels(items, byId, offers, selectedId, mapWords(tone).many, {
    avoid: youOnScreen ? [youRect(youOnScreen.x, youOnScreen.y, meKind === 'live')] : [],
    controls: controlsRect(size, { right: 8, top: 8 + padTop, button: 36, gap: 6, count: bare ? 0 : (onExpand ? 1 : 0) + 2 + (me ? 1 : 0) }),
  }, people);

  const delays = useMemo(() => introDelays(items, youOnScreen), [items, youOnScreen?.x, youOnScreen?.y]); // eslint-disable-line react-hooks/exhaustive-deps
  const here = { lat: view.lat, lng: view.lng };
  // Earn (tasks) is always royal blue, Hire (helpers) always jade: one side colour for the shapes, ring and You dot.
  const hue = sideHue(t, people);
  const blue = hue;
  const words = mapWords(tone);

  // Everything that is not a pin, drawn by the engine from the same layout (lib/mapLayers.ts).
  const ringCentre = ringAt ?? me;
  const shapes = useMemo(
    () =>
      sceneShapes({
        items,
        toPlace,
        mpp: metresPerPixel(view.lat, zoom),
        ring: me && ringCentre ? { at: ringCentre, km: ringKm } : null,
        offers,
        pickedId: selectedId,
      }),
    // toPlace, zoom and the offers follow `view` and `byId`, which `items` already tracks.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, selectedId, ringKm, me?.lat, me?.lng, ringCentre?.lat, ringCentre?.lng, people, byId],
  );
  const layers = useMemo(
    () => shapeLayers({ hue, ring: blue, ink: t.colors.ink, halo: t.colors.bg, isDark: t.isDark, reduced }),
    [hue, blue, t.colors.ink, t.colors.bg, t.isDark, reduced],
  );
  const beforeId = below ?? undefined;

  // Clip to the map's box: MapLibre's pins are real native views and would otherwise draw over the header above
  // the map (phone check, 26 Nov). The Google map clipped them itself.
  const frame = fill
    ? { flex: 1, overflow: 'hidden' as const, backgroundColor: t.colors.surface2 }
    : { height, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line };

  // The last zoom the tilt rule looked at: it acts when a zoom ends, not on every pan.
  const lastZoom = useRef(view.glZoom);
  const onRegionDidChange = (e: ChangeEvent) => {
    const { center, zoom: glZoom, pitch, userInteraction } = e.nativeEvent;
    setView({ lat: center[1], lng: center[0], glZoom, pitch });
    // Only the person's own moves count, not the camera following a picked pin.
    if (userInteraction) onMoveEnd?.({ lat: center[1], lng: center[0] });
    if (Math.abs(glZoom - lastZoom.current) > 0.01) {
      lastZoom.current = glZoom;
      const lean = tiltAfterZoom(glZoom, pitch, reduced);
      if (lean !== null) camera.current?.easeTo({ center, pitch: lean, duration: reduced ? 0 : 500 });
    }
  };

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

  return (
    <View onLayout={onLayout} style={frame}>
      <MLMap
        style={{ flex: 1 }}
        mapStyle={glStyleUrl(t.isDark)}
        dragPan={!bare}
        touchZoom={!bare}
        touchPitch={!bare}
        touchRotate={false}
        compass={false}
        logo={false}
        attribution
        attributionPosition={{ bottom: 8 + padBottom, right: 8 }}
        contentInset={{ top: padTop, bottom: padBottom, left: padLeft, right: 0 }}
        onRegionWillChange={(e) => {
          if (e.nativeEvent.userInteraction) moved.current = true;
        }}
        onRegionDidChange={onRegionDidChange}
      >
        <Camera ref={camera} initialViewState={{ center: [start.lng, start.lat], zoom: tileToGl(startZoom) }} minZoom={tileToGl(MIN_ZOOM)} maxZoom={tileToGl(MAX_ZOOM)} />

        {below !== undefined ? (
          <>
            {(Object.keys(SRC) as (keyof typeof SRC)[]).map((k) => (
              <GeoJSONSource key={`${SRC[k]}-${t.isDark}`} id={SRC[k]} data={shapes[k] as unknown as GeoJSON.FeatureCollection}>
                {layers
                  .filter((l) => l.source === SRC[k])
                  // LayerSpec is the plain style-spec shape both engines share; the strict union type cannot see that.
                  .map((l) => (
                    <Layer key={l.id} {...(l as unknown as LayerProps)} beforeId={beforeId} />
                  ))}
              </GeoJSONSource>
            ))}
            <Layer key={`bld-${t.isDark}`} {...(buildingLayer(t.isDark) as unknown as LayerProps)} beforeId={beforeId} />
          </>
        ) : null}

        {me ? <YouDot at={me} color={blue} kind={meKind} /> : null}

        {items.map((it, i) => {
          const plan = labels.get(itemKey(it));
          const place = toPlace(it.x + (plan?.dx ?? 0), it.y);
          const hidePlace = plan ? !plan.showTag : false;
          // Intro first; later, a pin that just joined a spread (or a group that appeared after a fold) fades and scales in from its centre.
          // Phone: no sliding child, because a native marker view may clip it (not checked on a device).
          const enter: PinEnter | null = introLive
            ? { delay: delays[i] ?? 0, ms: TAG_MS, from: 0.8 }
            : spreadLive
              ? { delay: 0, ms: SPREAD_MS, from: it.kind === 'one' && it.area ? 0.5 : 0.6 }
              : null;
          // While a pin is picked, the others step back.
          const back = dim && selectedId !== null && !(it.kind === 'one' && it.id === selectedId);
          if (it.kind === 'group') {
            const into = () => move(place, Math.max(Math.round(zoom) + 2, SPREAD_ZOOM), FLY_MS);
            const name = placeOf(it.ids, byId);
            if (people) {
              const shown = it.ids.slice(0, 3).map((id) => ({ seed: id, face: byId.get(id)!.face ?? { initials: '?', live: false } }));
              return (
                <PinMarker enter={enter} key={'g-' + it.ids[0]} faded={back} at={place} box={FACE_STACK} z={2} label={`${it.ids.length} ${words.many} in ${name} area. Spread them out`} onPress={into}>
                  <FaceStack faces={shown} extra={it.ids.length - shown.length} label={stackLabel(it.ids, byId)} compact={hidePlace} />
                </PinMarker>
              );
            }
            const topPin = topPinOf(it.ids, byId);
            const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
            return (
              <PinMarker
                enter={enter}
                key={'g-' + it.ids[0]}
                faded={back}
                at={place}
                box={PRICE_PIN}
                z={best ? 3 : 2}
                label={`${it.ids.length} ${words.many} in ${name} area, biggest offer ${topPin.label}. Zoom in`}
                onPress={into}
              >
                <PricePin price={topPin.label} icon={topPin.face?.icon} best={best} on={false} place={name} count={`${it.ids.length} ${words.many}`} hidePlace={hidePlace} />
              </PinMarker>
            );
          }

          const pin = byId.get(it.id)!;
          const on = selectedId === it.id;
          const pick = () => onSelect(on ? null : it.id);
          if (pin.promoted) {
            // A promoted post: bigger, side-coloured and above the other pins (task 1.19 row C).
            return (
              <PinMarker
                enter={enter}
                key={'pr-' + it.id}
                faded={back}
                at={place}
                box={PROMO_PIN}
                z={on ? 6 : 5}
                label={'Promoted. ' + (people ? helperSays(pin) : jobSays(pin))}
                onPress={pick}
              >
                <PromotedPin side={people ? 'hire' : 'earn'} price={people ? (pin.price ?? null) : pin.label} on={on} {...(people ? {} : { icon: pin.face?.icon })} />
              </PinMarker>
            );
          }
          if (people) {
            const face = pin.face ?? { initials: '?', live: false };
            return (
              <PinMarker enter={enter} key={'p-' + it.id} faded={back} at={place} box={FACE_PIN} z={on ? 4 : 2} label={helperSays(pin)} onPress={pick}>
                <FacePin face={face} seed={pin.id} what={pin.label} price={pin.price} more={pin.more} on={on} compact={hidePlace} />
              </PinMarker>
            );
          }
          const spread = it.area !== null;
          const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
          return (
            <PinMarker
              enter={enter}
              key={'j-' + it.id}
              ripple={freshIds.indexOf(it.id) >= 0 ? freshIds.indexOf(it.id) : null}
              hue={hue}
              faded={back}
              at={place}
              box={spread ? TASK_PIN : PRICE_PIN}
              z={on ? 4 : best ? 3 : 2}
              label={jobSays(pin)}
              onPress={pick}
            >
              {spread ? (
                <TaskPin price={pin.label} face={pin.face} seed={pin.id} who={pin.who} title={pin.title} best={best} on={on} compact={hidePlace} />
              ) : (
                <PricePin price={pin.label} icon={pin.face?.icon} best={best} on={on} place={pin.area ?? 'Nearby'} hidePlace={hidePlace} />
              )}
            </PinMarker>
          );
        })}
      </MLMap>

      {bare ? null : (
      <View style={{ position: 'absolute', right: 8, top: 8 + padTop, gap: 6 }}>
        {onExpand ? control('Open the full map', onExpand, <Icon name="expand" size={16} color={t.colors.ink} />) : null}
        {control('Zoom in', () => move(here, Math.round(zoom) + 1, 250), <RNText style={tx('700', 18, t.colors.ink)}>+</RNText>)}
        {control('Zoom out', () => move(here, Math.round(zoom) - 1, 250), <RNText style={tx('700', 18, t.colors.ink)}>−</RNText>)}
        {me
          ? control(
              'Back to my area',
              () => {
                move(me, START_ZOOM, 250);
                moved.current = false;
              },
              <Icon name="compass" size={18} color={blue} />,
            )
          : null}
      </View>
      )}

      {/* On the full map these notes live in the sheet (plan D14). */}
      {fill || bare ? null : (
      <>
      <View pointerEvents="none" style={{ position: 'absolute', left: 8, top: 8 + padTop, right: 56, flexDirection: 'row' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: t.colors.line, paddingHorizontal: 10, paddingVertical: 6, flexShrink: 1 }}>
          {people ? <Icon name="users" size={12} color={blue} /> : <View style={{ width: 14, height: 9, borderRadius: 5, backgroundColor: t.colors.ink }} />}
          <RNText style={tx('600', 11, t.colors.text, { flexShrink: 1 })} numberOfLines={1}>
            {words.legend}
          </RNText>
        </View>
      </View>

      {/* Left of the attribution button in the bottom-right corner, which has to stay visible. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 8, bottom: 8 + padBottom, right: 52, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Icon name="lock" size={12} color={people ? hireColours(t.isDark).deep : t.colors.purpleDeep} />
        <RNText style={tx('600', 11, t.colors.text, { flexShrink: 1 })} numberOfLines={2}>
          {words.privacy}
        </RNText>
      </View>
      </>
      )}
    </View>
  );
}
