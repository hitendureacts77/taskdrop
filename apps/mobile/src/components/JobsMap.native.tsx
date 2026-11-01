import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Platform, type LayoutChangeEvent } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { Icon } from './Icon';
import { TILE, project, unproject } from './MapPicker.tiles';
import { JobsMap as TileJobsMap, mapWords, type JobsMapProps } from './JobsMap.tiles';
import { groupPins, metresPerPixel } from '../lib/mapCluster';
import { MAX_FRESH, areaAt, groupScale, introDelays, introEnd, rippleAt, tagAt } from '../lib/mapMotion';
import { useMapClock } from './useMapClock';

export type { JobPin, MapTone, JobsMapProps } from './JobsMap.tiles';
export { mapWords } from './JobsMap.tiles';

/**
 * Inside Expo Go the Google map comes up blank on Android (our Maps key is not
 * part of Expo Go), so there the tile map is used, as in MapPicker.native.tsx.
 * Installed builds get Google's map, with the key from app.config.js.
 */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

const MIN_ZOOM = 5;
const MAX_ZOOM = 17;
const START_ZOOM = 12;
/** Two tags closer than this many pixels become one numbered circle. */
const CLUSTER_PX = 46;
/** Helper tags are wider (face, skill and rating), so they join sooner. */
const CLUSTER_PX_PEOPLE = 84;
const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };
/** Same soft area as the tile map: published coordinates are rounded to about a kilometre. */
const AREA_M = 800;

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
 * when what it shows changes, then stop tracking: tracking forever is slow.
 */
function useSnapshot(...deps: unknown[]): boolean {
  const [tracking, setTracking] = useState(true);
  useEffect(() => {
    setTracking(true);
    const id = setTimeout(() => setTracking(false), 500);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return tracking;
}

function PriceTag({
  at,
  label,
  on,
  onPress,
}: {
  at: { lat: number; lng: number };
  label: string;
  on: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const tracking = useSnapshot(label, on, t.isDark);
  const w = label.length * 9 + 24;
  const h = on ? 34 : 28;
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={on ? 3 : 2}
      tracksViewChanges={tracking}
      onPress={onPress}
      accessibilityLabel={`Job for ${label}, around this area`}
    >
      <View
        style={{ width: w + 8, height: h + 8, alignItems: 'center', justifyContent: 'center' }}
        collapsable={false}
      >
        <View
          style={{ width: w, height: h, borderRadius: 999, backgroundColor: on ? t.colors.ink : t.colors.btn, borderWidth: 2.5, borderColor: t.colors.bg, alignItems: 'center', justifyContent: 'center' }}
        >
          <RNText style={tx('800', on ? 14 : 13, on ? t.colors.bg : t.colors.onBtn, { fontVariant: ['tabular-nums'] })}>{label}</RNText>
        </View>
      </View>
    </Marker>
  );
}

function CountTag({
  at,
  count,
  onPress,
  color,
  word,
}: {
  at: { lat: number; lng: number };
  count: number;
  onPress: () => void;
  color?: string;
  word: string;
}) {
  const t = useTheme();
  const tracking = useSnapshot(count, t.isDark, color);
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={2}
      tracksViewChanges={tracking}
      onPress={onPress}
      accessibilityLabel={`${count} ${word} here. Zoom in`}
    >
      <View style={{ width: 46, height: 46, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
        <View style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: color ?? t.colors.btn, borderWidth: 3, borderColor: t.colors.bg, alignItems: 'center', justifyContent: 'center' }}>
          <RNText style={tx('800', 15, color ? '#FFFFFF' : t.colors.onBtn)}>{count}</RNText>
        </View>
      </View>
    </Marker>
  );
}

function PersonTag({
  at,
  label,
  face,
  on,
  onPress,
}: {
  at: { lat: number; lng: number };
  label: string;
  face: { initials: string; live: boolean };
  on: boolean;
  onPress: () => void;
}) {
  const t = useTheme();
  const tracking = useSnapshot(label, on, face.live, t.isDark);
  const w = label.length * 7.4 + 46;
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={on ? 3 : 2}
      tracksViewChanges={tracking}
      onPress={onPress}
      accessibilityLabel={`${label}${face.live ? ', active now' : ''}, around this area`}
    >
      <View style={{ width: w + 8, height: 40, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
        <View
          style={{ width: w, height: 32, borderRadius: 999, backgroundColor: on ? t.colors.purpleDeep : t.colors.bg, borderWidth: 1, borderColor: on ? t.colors.purpleDeep : t.colors.line, flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 3 }}
        >
          <View style={{ width: 24, height: 24, borderRadius: 999, backgroundColor: t.colors.purpleSoft, alignItems: 'center', justifyContent: 'center' }}>
            <RNText style={tx('800', 9.5, t.colors.purpleDeep)}>{face.initials}</RNText>
            {face.live ? (
              <View style={{ position: 'absolute', right: -1, bottom: -1, width: 9, height: 9, borderRadius: 999, backgroundColor: '#22C55E', borderWidth: 2, borderColor: t.colors.bg }} />
            ) : null}
          </View>
          <RNText style={tx('800', 12, on ? '#FFFFFF' : t.colors.ink)} numberOfLines={1}>
            {label}
          </RNText>
        </View>
      </View>
    </Marker>
  );
}

function YouDot({ at, color }: { at: { lat: number; lng: number }; color: string }) {
  const t = useTheme();
  const tracking = useSnapshot(t.isDark, color);
  const blue = color;
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      zIndex={1}
      tracksViewChanges={tracking}
      tappable={false}
    >
      <View style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }} collapsable={false}>
        <View style={{ position: 'absolute', width: 34, height: 34, borderRadius: 999, backgroundColor: blue + '33' }} />
        <View style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: blue, borderWidth: 3, borderColor: '#FFFFFF' }} />
      </View>
    </Marker>
  );
}

function GoogleJobsMap({ me, pins, selectedId, onSelect, height = 320, ringKm = RING_KM, tone = 'jobs', focusId = null, onExpand, fill }: Props) {
  const t = useTheme();
  const mapRef = useRef<MapView>(null);
  const start = me ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
  const [size, setSize] = useState({ w: 0, h: height });
  const [region, setRegion] = useState<Region>({
    latitude: start.lat,
    longitude: start.lng,
    latitudeDelta: deltaFor(START_ZOOM),
    longitudeDelta: deltaFor(START_ZOOM),
  });

  // Once the first location arrives, start there; after that the map is the person's to move.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current && me) {
      mapRef.current?.animateCamera({ center: { latitude: me.lat, longitude: me.lng }, zoom: START_ZOOM }, { duration: 400 });
    }
  }, [me]);

  // The full map's card rail picks a pin: bring it into the middle.
  useEffect(() => {
    const hit = focusId ? pins.find((p) => p.id === focusId) : null;
    if (!hit) return;
    moved.current = true;
    mapRef.current?.animateCamera({ center: { latitude: hit.lat, longitude: hit.lng } }, { duration: 350 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId]);

  const onLayout = (e: LayoutChangeEvent) =>
    setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });

  // What the screen shows, as a web-mercator zoom, so the same pixel clustering
  // as the tile map can run on top of the native camera.
  const zoom = size.w > 0 ? Math.log2((360 * size.w) / (TILE * region.longitudeDelta)) : START_ZOOM;
  const c = project(region.latitude, region.longitude, zoom);
  const left = c.x - size.w / 2;
  const top = c.y - size.h / 2;

  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  const groups = useMemo(() => {
    if (size.w === 0) return [];
    const placed = pins.map((p) => {
      const q = project(p.lat, p.lng, zoom);
      return { id: p.id, x: q.x - left, y: q.y - top };
    });
    const inView = placed.filter((p) => p.x > -60 && p.x < size.w + 60 && p.y > -60 && p.y < size.h + 60);
    return groupPins(inView, tone === 'people' ? CLUSTER_PX_PEOPLE : CLUSTER_PX).map((g) => ({ ...g, at: unproject(g.x + left, g.y + top, zoom) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pins, region, size, tone]);

  // The intro replays for a new set of things, not when the map is moved.
  const introKey = useMemo(() => pins.map((p) => p.id).sort().join('|'), [pins]);
  const freshIds = useMemo(() => new Set(pins.filter((p) => p.fresh).slice(0, MAX_FRESH).map((p) => p.id)), [pins]);
  const clock = useMapClock(introKey, introEnd(pins.length), freshIds.size > 0);
  const youAt = me ? project(me.lat, me.lng, zoom) : null;
  const delays = introDelays(groups, youAt ? { x: youAt.x - left, y: youAt.y - top } : null);

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
  const hue = tone === 'people' ? blue : t.colors.accent;
  // The poster is a dark dot on a map of blue helpers, so the two never mix up.
  const youColor = tone === 'people' ? t.colors.ink : blue;
  const words = mapWords(tone);
  // Never smaller than the tag it holds, so the area still reads when zoomed out.
  const areaM = Math.max(AREA_M, 30 * metresPerPixel(region.latitude, zoom));
  const hex = (n: number) => Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
  const padTop = fill ? fill.top : 0;
  const padBottom = fill ? fill.bottom : 0;
  const frame = fill
    ? { flex: 1, backgroundColor: t.colors.surface2 }
    : { height, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line };

  return (
    <View onLayout={onLayout} style={frame}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        onRegionChangeComplete={setRegion}
        onPanDrag={() => {
          moved.current = true;
        }}
        minZoomLevel={MIN_ZOOM}
        maxZoomLevel={MAX_ZOOM}
        rotateEnabled={false}
        pitchEnabled={false}
        showsCompass={false}
        showsMyLocationButton={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        userInterfaceStyle={t.isDark ? 'dark' : 'light'}
        mapPadding={{ top: padTop, bottom: padBottom, left: 0, right: 0 }}
      >
        {me ? (
          <>
            <Circle
              center={{ latitude: me.lat, longitude: me.lng }}
              radius={ringKm * 1000}
              strokeColor={blue}
              strokeWidth={1.5}
              lineDashPattern={[10, 8]}
              fillColor={blue + '12'}
              zIndex={0}
            />
            <YouDot at={me} color={youColor} />
          </>
        ) : null}

        {groups.map((g, i) => {
          const key = g.ids.join('|');
          const many = g.ids.length > 1;
          const a = areaAt(clock.elapsed, delays[i]!);
          if (!a.shown) return null;
          const full = areaM * groupScale(g.ids.length);
          const showTag = tagAt(clock.elapsed, delays[i]!) > 0;
          const ripple = !many && freshIds.has(g.ids[0]!) && !clock.still ? rippleAt(clock.now, i * 1200) : null;
          const area = (on: boolean) => (
            <Circle
              key={'area-' + key}
              center={{ latitude: g.at.lat, longitude: g.at.lng }}
              radius={Math.max(8, full * a.scale)}
              strokeColor={hue + (on ? 'CC' : '66')}
              strokeWidth={on ? 2.5 : 1.5}
              fillColor={hue + (on ? '38' : hex(0x26 + (0xcc - 0x26) * a.dense))}
              zIndex={1}
            />
          );
          const rings =
            ripple !== null ? (
              <Circle
                key={'ripple-' + key}
                center={{ latitude: g.at.lat, longitude: g.at.lng }}
                radius={full * (1 + 0.5 * ripple)}
                strokeColor={hue + hex(190 * (1 - ripple))}
                strokeWidth={2}
                fillColor="transparent"
                zIndex={1}
              />
            ) : null;
          if (many) {
            // Items in the same rounded area never come apart, however far in;
            // at the last zoom step a tap opens the first of them instead.
            const deepest = zoom >= MAX_ZOOM - 0.5;
            return [
              area(false),
              showTag ? (
                <CountTag
                  key={'tag-' + key}
                  at={g.at}
                  count={g.ids.length}
                  color={tone === 'people' ? blue : undefined}
                  word={words.many}
                  onPress={() => (deepest ? onSelect(g.ids[0]!) : flyTo(g.at, Math.round(zoom) + 2))}
                />
              ) : null,
            ];
          }
          const id = g.ids[0]!;
          const pin = byId.get(id)!;
          const on = selectedId === id;
          const pick = () => onSelect(on ? null : id);
          return [
            area(on),
            rings,
            !showTag ? null : pin.face ? (
              <PersonTag key={'tag-' + id} at={g.at} label={pin.label} face={pin.face} on={on} onPress={pick} />
            ) : (
              <PriceTag key={'tag-' + id} at={g.at} label={pin.label} on={on} onPress={pick} />
            ),
          ];
        })}
      </MapView>

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

      <View pointerEvents="none" style={{ position: 'absolute', left: 8, top: 8 + padTop, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: t.colors.line, paddingHorizontal: 10, paddingVertical: 6 }}>
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

      {/* Clear of the Google logo in the bottom-left corner, which has to stay visible. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 84, bottom: 8 + padBottom, right: 8, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Icon name="lock" size={12} color={tone === 'people' ? t.colors.purpleDeep : t.colors.accentDeep} />
        <RNText style={tx('600', 11, t.colors.text, { flexShrink: 1 })} numberOfLines={2}>
          {words.privacy}
        </RNText>
      </View>
    </View>
  );
}
