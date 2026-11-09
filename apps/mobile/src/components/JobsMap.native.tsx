import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Platform, type LayoutChangeEvent } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { Icon } from './Icon';
import { TILE, project, unproject } from './MapPicker.tiles';
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
import { MAX_FRESH, areaAt, introDelays, introEnd, rippleAt, tagAt } from '../lib/mapMotion';
import { useMapClock } from './useMapClock';
import { FACE_PIN, FACE_STACK, FacePin, FaceStack, PRICE_PIN, PricePin, TASK_PIN, TaskPin } from './MapMarkers';

export type { JobPin, MapTone, JobsMapProps } from './JobsMap.tiles';
export { mapWords } from './JobsMap.tiles';

/**
 * Inside Expo Go the Google map comes up blank on Android (our Maps key is not
 * part of Expo Go), so there the tile map is used, as in MapPicker.native.tsx.
 * Installed builds get Google's map, with the key from app.config.js.
 */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const MIN_ZOOM = 4;
const START_ZOOM = 12;
const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };

type Props = JobsMapProps;

export function JobsMap(props: Props) {
  return IN_EXPO_GO ? <TileJobsMap {...props} /> : <GoogleJobsMap {...props} />;
}

/** Map zoom level -> the degrees of longitude the screen width shows. */
function deltaFor(zoom: number): number {
  return 360 / 2 ** zoom;
}

/**
 * A native view drawn into a marker is a snapshot. Let it redraw for a moment
 * when what it shows changes (or a face photo arrives), then stop tracking:
 * tracking forever is slow.
 */
function useSnapshot(...deps: unknown[]): [boolean, () => void] {
  const [tracking, setTracking] = useState(true);
  const [poked, setPoked] = useState(0);
  useEffect(() => {
    setTracking(true);
    const id = setTimeout(() => setTracking(false), 600);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, poked]);
  return [tracking, () => setPoked((n) => n + 1)];
}

/** One marker holding a pin from MapMarkers, lined up so the pin's point sits on the place. */
function PinMarker({
  at,
  box,
  z,
  label,
  onPress,
  deps,
  faded = false,
  children,
}: {
  at: { lat: number; lng: number };
  box: { w: number; h: number; anchor: number };
  z: number;
  label: string;
  onPress: () => void;
  deps: unknown[];
  faded?: boolean;
  children: (redraw: () => void) => React.ReactNode;
}) {
  const t = useTheme();
  const [tracking, redraw] = useSnapshot(t.isDark, faded, ...deps);
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      anchor={{ x: 0.5, y: box.anchor / box.h }}
      zIndex={z}
      tracksViewChanges={tracking}
      onPress={onPress}
      accessibilityLabel={label}
    >
      <View style={{ width: box.w, height: box.h, opacity: faded ? 0.45 : 1 }} collapsable={false}>
        {children(redraw)}
      </View>
    </Marker>
  );
}

function YouDot({ at, color }: { at: { lat: number; lng: number }; color: string }) {
  const t = useTheme();
  const [tracking] = useSnapshot(t.isDark, color);
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={1}
      tracksViewChanges={tracking}
      tappable={false}
    >
      <View style={{ width: 30, height: 30, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
        <View style={{ position: 'absolute', width: 26, height: 26, borderRadius: 999, backgroundColor: color + '40' }} />
        <View style={{ width: 14, height: 14, borderRadius: 999, backgroundColor: color, borderWidth: 2.5, borderColor: '#FFFFFF' }} />
      </View>
    </Marker>
  );
}

function GoogleJobsMap({ me, pins, selectedId, onSelect, height = 320, ringKm = RING_KM, tone = 'jobs', focusId = null, onExpand, fill, dim = false, onMoveEnd, startAt, startZoom = START_ZOOM, fit = null, ringAt, bare = false }: Props) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const mapRef = useRef<MapView>(null);
  const start = me ?? startAt ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
  const [size, setSize] = useState({ w: 0, h: height });
  const [region, setRegion] = useState<Region>({
    latitude: start.lat,
    longitude: start.lng,
    latitudeDelta: deltaFor(startZoom),
    longitudeDelta: deltaFor(startZoom),
  });

  // Once the first location arrives, start there; after that the map is the person's to move.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current && me) {
      mapRef.current?.animateCamera({ center: { latitude: me.lat, longitude: me.lng }, zoom: START_ZOOM }, { duration: 400 });
    }
  }, [me]);

  // The reach buttons: fly to fit the circle. The camera follows, but onRegionChangeComplete only
  // reports the person's own gestures, so "Search this area" does not appear by itself.
  useEffect(() => {
    if (!fit || size.w === 0) return;
    moved.current = true;
    const w = size.w - (fill?.left ?? 0);
    const h = size.h - (fill ? fill.top + fill.bottom : 0);
    const z = zoomToFit(fit.km, fit.at.lat, Math.min(w, h));
    if (Platform.OS === 'ios') {
      // iOS may ignore the camera's zoom, so fit the circle's four edges instead.
      const dLat = fit.km / 111.32;
      const dLng = fit.km / (111.32 * Math.max(0.05, Math.cos((fit.at.lat * Math.PI) / 180)));
      mapRef.current?.fitToCoordinates(
        [
          { latitude: fit.at.lat + dLat, longitude: fit.at.lng },
          { latitude: fit.at.lat - dLat, longitude: fit.at.lng },
          { latitude: fit.at.lat, longitude: fit.at.lng + dLng },
          { latitude: fit.at.lat, longitude: fit.at.lng - dLng },
        ],
        { edgePadding: { top: 24, right: 24, bottom: 24, left: 24 }, animated: !reduced },
      );
    } else {
      mapRef.current?.animateCamera(
        { center: { latitude: fit.at.lat, longitude: fit.at.lng }, zoom: z },
        { duration: reduced ? 0 : 400 },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fit?.key, size.w > 0]);

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });

  // What the screen shows, as a web-mercator zoom, so the same pixel layout as
  // the tile map can run on top of the native camera.
  const zoom = size.w > 0 ? Math.log2((360 * size.w) / (TILE * region.longitudeDelta)) : START_ZOOM;
  const c = project(region.latitude, region.longitude, zoom);
  const left = c.x - size.w / 2;
  const top = c.y - size.h / 2;
  const toPlace = (x: number, y: number) => unproject(x + left, y + top, zoom);

  // The full map's card rail picks a pin: bring it into the middle, close enough to see it on its own.
  useEffect(() => {
    const hit = focusId ? pins.find((p) => p.id === focusId) : null;
    if (!hit) return;
    moved.current = true;
    mapRef.current?.animateCamera({ center: { latitude: hit.lat, longitude: hit.lng }, zoom: Math.max(Math.round(zoom), SPREAD_ZOOM) }, { duration: 350 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const people = tone === 'people';
  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  const items = useMemo(() => {
    if (size.w === 0) return [];
    const placed = byOffer(pins, people).map((p) => {
      const q = project(p.lat, p.lng, zoom);
      return { id: p.id, x: q.x - left, y: q.y - top };
    });
    const inView = placed.filter((p) => p.x > -120 && p.x < size.w + 120 && p.y > -120 && p.y < size.h + 120);
    return layoutPins(groupPins(inView, people ? CLUSTER_PX_PEOPLE : CLUSTER_PX), { zoom, gap: people ? SPREAD_GAP_PEOPLE : SPREAD_GAP });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, region, size, tone]);
  const offers = people ? null : offersOf(items, byId);

  // The intro replays for a new set of things, not when the map is moved.
  const introKey = useMemo(() => pins.map((p) => p.id).sort().join('|'), [pins]);
  const freshIds = useMemo(() => new Set(pins.filter((p) => p.fresh).slice(0, MAX_FRESH).map((p) => p.id)), [pins]);
  const clock = useMapClock(introKey, introEnd(pins.length), freshIds.size > 0);
  const youAt = me ? project(me.lat, me.lng, zoom) : null;
  const delays = introDelays(items, youAt ? { x: youAt.x - left, y: youAt.y - top } : null);

  const flyTo = (center: { lat: number; lng: number }, next: number) => {
    moved.current = true;
    mapRef.current?.animateCamera(
      { center: { latitude: center.lat, longitude: center.lng }, zoom: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)) },
      { duration: 250 },
    );
  };
  const here = { lat: region.latitude, lng: region.longitude };

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

  const blue = t.colors.purple;
  const hue = people ? blue : t.colors.btn;
  // The poster is a dark dot on a map of helpers' faces, so the two never mix up.
  const youColor = people ? t.colors.ink : blue;
  const words = mapWords(tone);
  const mpp = metresPerPixel(region.latitude, zoom);
  const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  const padTop = fill ? fill.top : 0;
  const padBottom = fill ? fill.bottom : 0;
  const frame = fill
    ? { flex: 1, backgroundColor: t.colors.surface2 }
    : { height, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line };
  const areas = new Map<string, { x: number; y: number; r: number }>();
  for (const it of items) if (it.kind === 'one' && it.area) areas.set(`${it.area.x},${it.area.y}`, { x: it.area.x, y: it.area.y, r: Math.max(it.area.rx, it.area.ry) });

  return (
    <View onLayout={onLayout} style={frame}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        onRegionChangeComplete={(r, details) => {
          setRegion(r);
          // Only the person's own moves count, not the camera following a picked pin.
          if (details?.isGesture) onMoveEnd?.({ lat: r.latitude, lng: r.longitude });
        }}
        onPanDrag={() => {
          moved.current = true;
        }}
        minZoomLevel={MIN_ZOOM}
        maxZoomLevel={MAX_ZOOM}
        rotateEnabled={false}
        pitchEnabled={false}
        scrollEnabled={!bare}
        zoomEnabled={!bare}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        userInterfaceStyle={t.isDark ? 'dark' : 'light'}
        mapPadding={{ top: padTop, bottom: padBottom, left: fill?.left ?? 0, right: 0 }}
      >
        {me ? (
          <>
            <Circle
              center={{ latitude: (ringAt ?? me).lat, longitude: (ringAt ?? me).lng }}
              radius={ringKm * 1000}
              strokeColor={blue + '77'}
              strokeWidth={1}
              lineDashPattern={[10, 8]}
              fillColor="transparent"
              zIndex={0}
            />
            <YouDot at={me} color={youColor} />
          </>
        ) : null}

        {/* Spread areas: one soft circle behind everyone in it, never a spot. */}
        {[...areas.entries()].map(([key, a]) => {
          const p = toPlace(a.x, a.y);
          return (
            <Circle
              key={'area-' + key}
              center={{ latitude: p.lat, longitude: p.lng }}
              radius={a.r * mpp}
              strokeColor={hue + '80'}
              strokeWidth={1}
              lineDashPattern={[8, 6]}
              fillColor={hue + '1A'}
              zIndex={1}
            />
          );
        })}

        {/* Jobs: a soft heat glow under each area, stronger where the biggest offer is higher. */}
        {offers && offers.best
          ? items.flatMap((it, i) => {
              if (it.kind === 'one' && it.area) return [];
              const a = areaAt(clock.elapsed, delays[i]!);
              if (!a.shown) return [];
              const k = (offers.top[i] ?? 0) / offers.best!;
              const r = (36 + 46 * k) * a.scale * mpp;
              const p = toPlace(it.x, it.y);
              return [1, 0.66, 0.36].map((s) => (
                <Circle
                  key={`heat-${i}-${s}`}
                  center={{ latitude: p.lat, longitude: p.lng }}
                  radius={Math.max(4, r * s)}
                  strokeWidth={0}
                  strokeColor="transparent"
                  fillColor={hue + hex(255 * (0.05 + 0.1 * k))}
                  zIndex={1}
                />
              ));
            })
          : null}

        {items.map((it, i) => {
          if (tagAt(clock.elapsed, delays[i]!) === 0) return null;
          const place = toPlace(it.x, it.y);
          // While a pin is picked, the others step back.
          const back = dim && selectedId !== null && !(it.kind === 'one' && it.id === selectedId);
          if (it.kind === 'group') {
            const into = () => flyTo(place, Math.max(Math.round(zoom) + 2, SPREAD_ZOOM));
            const name = placeOf(it.ids, byId);
            if (people) {
              const shown = it.ids.slice(0, 3).map((id) => ({ seed: id, face: byId.get(id)!.face ?? { initials: '?', live: false } }));
              return (
                <PinMarker
                  key={'g-' + it.ids.join('|')}
                  faded={back}
                  at={place}
                  box={FACE_STACK}
                  z={2}
                  label={`${it.ids.length} ${words.many} in ${name} area. Spread them out`}
                  onPress={into}
                  deps={[it.ids.join('|')]}
                >
                  {() => <FaceStack faces={shown} extra={it.ids.length - shown.length} label={`${name} · ${it.ids.length}`} />}
                </PinMarker>
              );
            }
            const topPin = topPinOf(it.ids, byId);
            const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
            return (
              <PinMarker
                key={'g-' + it.ids.join('|')}
                faded={back}
                at={place}
                box={PRICE_PIN}
                z={best ? 3 : 2}
                label={`${it.ids.length} ${words.many} in ${name} area, biggest offer ${topPin.label}. Zoom in`}
                onPress={into}
                deps={[topPin.label, best, it.ids.length]}
              >
                {() => <PricePin price={topPin.label} best={best} on={false} place={name} count={`${it.ids.length} ${words.many}`} />}
              </PinMarker>
            );
          }

          const pin = byId.get(it.id)!;
          const on = selectedId === it.id;
          const pick = () => onSelect(on ? null : it.id);
          if (people) {
            const face = pin.face ?? { initials: '?', live: false };
            return (
              <PinMarker
                key={'p-' + it.id}
                faded={back}
                at={place}
                box={FACE_PIN}
                z={on ? 4 : 2}
                label={helperSays(pin)}
                onPress={pick}
                deps={[on, face.live, face.icon, pin.label, pin.price, pin.more]}
              >
                {(redraw) => <FacePin face={face} seed={pin.id} what={pin.label} price={pin.price} more={pin.more} on={on} onImage={redraw} />}
              </PinMarker>
            );
          }
          const spread = it.area !== null;
          const best = offers?.top[i] !== null && offers?.top[i] === offers?.best;
          const ripple = freshIds.has(it.id) && !clock.still ? rippleAt(clock.now, i * 1200) : null;
          return [
            ripple !== null ? (
              <Circle
                key={'ripple-' + it.id}
                center={{ latitude: place.lat, longitude: place.lng }}
                radius={(20 + 30 * ripple) * mpp}
                strokeColor={hue + hex(200 * (1 - ripple))}
                strokeWidth={2}
                fillColor="transparent"
                zIndex={1}
              />
            ) : null,
            <PinMarker
              key={'j-' + it.id}
              faded={back}
              at={place}
              box={spread ? TASK_PIN : PRICE_PIN}
              z={on ? 4 : best ? 3 : 2}
              label={`${pin.label}${pin.title ? ', ' + pin.title : ''}${pin.who ? ', posted by ' + pin.who : ''}, ${pin.area ?? 'nearby'} area`}
              onPress={pick}
              deps={[on, best, spread, pin.face?.photo]}
            >
              {(redraw) =>
                spread ? (
                  <TaskPin price={pin.label} face={pin.face} seed={pin.id} who={pin.who} title={pin.title} best={best} on={on} onImage={redraw} />
                ) : (
                  <PricePin price={pin.label} best={best} on={on} place={pin.area ?? 'Nearby'} />
                )
              }
            </PinMarker>,
          ];
        })}
      </MapView>

      {bare ? null : (
      <View style={{ position: 'absolute', right: 8, top: 8 + padTop, gap: 6 }}>
        {onExpand ? control('Open the full map', onExpand, <Icon name="expand" size={16} color={t.colors.ink} />) : null}
        {control('Zoom in', () => flyTo(here, Math.round(zoom) + 1), <RNText style={tx('700', 18, t.colors.ink)}>+</RNText>)}
        {control('Zoom out', () => flyTo(here, Math.round(zoom) - 1), <RNText style={tx('700', 18, t.colors.ink)}>−</RNText>)}
        {me
          ? control(
              'Back to my area',
              () => {
                moved.current = false;
                flyTo(me, START_ZOOM);
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

      {/* Clear of the Google logo in the bottom-left corner, which has to stay visible. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 84, bottom: 8 + padBottom, right: 8, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Icon name="lock" size={12} color={people ? t.colors.purpleDeep : t.colors.accentDeep} />
        <RNText style={tx('600', 11, t.colors.text, { flexShrink: 1 })} numberOfLines={2}>
          {words.privacy}
        </RNText>
      </View>
      </>
      )}
    </View>
  );
}
