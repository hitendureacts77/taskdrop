import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Platform, type LayoutChangeEvent } from 'react-native';
import MapView, { Circle, Marker, PROVIDER_GOOGLE, type Region } from 'react-native-maps';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { Icon } from './Icon';
import { project, unproject } from './MapPicker.tiles';
import { JobsMap as TileJobsMap, type JobPin } from './JobsMap.tiles';
import { groupPins } from '../lib/mapCluster';

export type { JobPin };

/** Expo Go is a separate app without our Maps key, so there the map falls back to tiles. */
const IN_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

/** Two tags closer than this many pixels become one numbered circle. */
const CLUSTER_PX = 46;
const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };
/** How far round a job its soft circle reaches (published coordinates are rounded to about a kilometre). */
const AREA_M = 800;
const START_DELTA = 0.12;

type Props = {
  me: { lat: number; lng: number } | null;
  pins: JobPin[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  height?: number;
  ringKm?: number;
};

/**
 * Open jobs on a map, native build: Google's map (the installed app already has
 * its key) instead of OpenStreetMap tiles, which refuse requests from apps.
 * Same look as the tile version: you are the blue dot with your reach drawn
 * round you, each job is a soft green circle with its price, and close tags
 * join into a number you tap to zoom in. Circles show the area, never a point.
 */
export function JobsMap(props: Props) {
  return IN_EXPO_GO ? <TileJobsMap {...props} /> : <GoogleJobsMap {...props} />;
}

/** A price tag. It redraws for a moment when it changes, then stops, so a map full of them stays light. */
function PriceTag({ pin, on, at, onPress }: { pin: JobPin; on: boolean; at: { lat: number; lng: number }; onPress: () => void }) {
  const t = useTheme();
  const [live, setLive] = useState(true);
  useEffect(() => {
    setLive(true);
    const id = setTimeout(() => setLive(false), 500);
    return () => clearTimeout(id);
  }, [pin.label, on, t.colors.btn]);
  return (
    <Marker
      coordinate={{ latitude: at.lat, longitude: at.lng }}
      anchor={{ x: 0.5, y: 0.5 }}
      tracksViewChanges={live}
      onPress={onPress}
      zIndex={on ? 2 : 1}
      accessibilityLabel={`Job for ${pin.label}, around this area`}
    >
      <View style={{ minWidth: 48, paddingHorizontal: 12, height: on ? 34 : 28, borderRadius: 999, backgroundColor: on ? t.colors.ink : t.colors.btn, borderWidth: 2.5, borderColor: t.colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={tx('800', on ? 14 : 13, on ? t.colors.bg : t.colors.onBtn, { fontVariant: ['tabular-nums'] })}>{pin.label}</RNText>
      </View>
    </Marker>
  );
}

function CountTag({ count, at, onPress }: { count: number; at: { lat: number; lng: number }; onPress: () => void }) {
  const t = useTheme();
  const [live, setLive] = useState(true);
  useEffect(() => {
    setLive(true);
    const id = setTimeout(() => setLive(false), 500);
    return () => clearTimeout(id);
  }, [count, t.colors.btn]);
  return (
    <Marker coordinate={{ latitude: at.lat, longitude: at.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={live} onPress={onPress} accessibilityLabel={`${count} jobs here. Zoom in`}>
      <View style={{ width: 38, height: 38, borderRadius: 999, backgroundColor: t.colors.btn, borderWidth: 3, borderColor: t.colors.bg, alignItems: 'center', justifyContent: 'center' }}>
        <RNText style={tx('800', 15, t.colors.onBtn)}>{count}</RNText>
      </View>
    </Marker>
  );
}

function GoogleJobsMap({ me, pins, selectedId, onSelect, height = 320, ringKm = RING_KM }: Props) {
  const t = useTheme();
  const mapRef = useRef<MapView>(null);
  const start = me ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
  const [region, setRegion] = useState<Region>({ latitude: start.lat, longitude: start.lng, latitudeDelta: START_DELTA, longitudeDelta: START_DELTA });
  const [size, setSize] = useState({ w: 0, h: height });
  const blue = t.colors.purple;

  // Once the first location arrives, start there; after that the map is the person's to move.
  const moved = useRef(false);
  useEffect(() => {
    if (!moved.current && me) mapRef.current?.animateToRegion({ latitude: me.lat, longitude: me.lng, latitudeDelta: START_DELTA, longitudeDelta: START_DELTA }, 300);
  }, [me]);

  const zoom = Math.log2(360 / region.longitudeDelta);
  const centre = project(region.latitude, region.longitude, zoom);
  const left = centre.x - size.w / 2;
  const top = centre.y - size.h / 2;

  const byId = useMemo(() => new Map(pins.map((p) => [p.id, p])), [pins]);
  const groups = useMemo(() => {
    if (size.w === 0) return [];
    const placed = pins.map((p) => {
      const at = project(p.lat, p.lng, zoom);
      return { id: p.id, x: at.x - left, y: at.y - top };
    });
    const inView = placed.filter((p) => p.x > -60 && p.x < size.w + 60 && p.y > -60 && p.y < size.h + 60);
    return groupPins(inView, CLUSTER_PX).map((g) => ({ ...g, at: unproject(g.x + left, g.y + top, zoom) }));
  }, [pins, zoom, left, top, size]);

  const zoomBy = (factor: number) => {
    moved.current = true;
    const d = Math.min(60, Math.max(0.002, region.latitudeDelta * factor));
    mapRef.current?.animateToRegion({ latitude: region.latitude, longitude: region.longitude, latitudeDelta: d, longitudeDelta: d }, 250);
  };
  const zoomInto = (at: { lat: number; lng: number }) => {
    moved.current = true;
    const d = Math.max(0.002, region.latitudeDelta / 4);
    mapRef.current?.animateToRegion({ latitude: at.lat, longitude: at.lng, latitudeDelta: d, longitudeDelta: d }, 300);
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

  const onLayout = (e: LayoutChangeEvent) => setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });

  return (
    <View onLayout={onLayout} style={{ height, borderRadius: 18, overflow: 'hidden', backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line }}>
      <MapView
        ref={mapRef}
        style={{ flex: 1 }}
        provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
        initialRegion={region}
        onRegionChangeComplete={setRegion}
        onPanDrag={() => {
          moved.current = true;
        }}
        onPress={() => onSelect(null)}
        rotateEnabled={false}
        pitchEnabled={false}
        showsMyLocationButton={false}
        showsCompass={false}
        toolbarEnabled={false}
        moveOnMarkerPress={false}
        userInterfaceStyle={t.isDark ? 'dark' : 'light'}
      >
        {me ? (
          <>
            <Circle center={{ latitude: me.lat, longitude: me.lng }} radius={ringKm * 1000} strokeColor={blue} strokeWidth={1.5} fillColor={blue + '12'} lineDashPattern={[10, 8]} />
            <Marker coordinate={{ latitude: me.lat, longitude: me.lng }} anchor={{ x: 0.5, y: 0.5 }} tracksViewChanges={false} zIndex={0}>
              <View style={{ width: 34, height: 34, borderRadius: 999, backgroundColor: blue + '33', alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: blue, borderWidth: 3, borderColor: '#FFFFFF' }} />
              </View>
            </Marker>
          </>
        ) : null}

        {groups.map((g) => {
          const key = g.ids.join('|');
          const many = g.ids.length > 1;
          const id = g.ids[0]!;
          const on = !many && selectedId === id;
          return (
            <Fragment key={key}>
              <Circle
                center={{ latitude: g.at.lat, longitude: g.at.lng }}
                radius={AREA_M}
                fillColor={t.colors.accent + (on ? '38' : '26')}
                strokeColor={t.colors.accent + (on ? 'AA' : '66')}
                strokeWidth={1.5}
              />
              {many ? (
                <CountTag count={g.ids.length} at={g.at} onPress={() => (zoom >= 17 ? onSelect(id) : zoomInto(g.at))} />
              ) : (
                <PriceTag pin={byId.get(id)!} on={on} at={g.at} onPress={() => onSelect(on ? null : id)} />
              )}
            </Fragment>
          );
        })}
      </MapView>

      <View style={{ position: 'absolute', right: 8, top: 8, gap: 6 }}>
        {control('Zoom in', () => zoomBy(0.5), <RNText style={tx('700', 18, t.colors.ink)}>+</RNText>)}
        {control('Zoom out', () => zoomBy(2), <RNText style={tx('700', 18, t.colors.ink)}>−</RNText>)}
        {me
          ? control(
              'Back to my area',
              () => {
                moved.current = false;
                mapRef.current?.animateToRegion({ latitude: me.lat, longitude: me.lng, latitudeDelta: START_DELTA, longitudeDelta: START_DELTA }, 300);
              },
              <Icon name="compass" size={18} color={blue} />,
            )
          : null}
      </View>

      <View pointerEvents="none" style={{ position: 'absolute', left: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: t.colors.line, paddingHorizontal: 10, paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: blue }} />
          <RNText style={tx('600', 11, t.colors.text)}>You</RNText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 12, height: 12, borderRadius: 999, backgroundColor: t.colors.accent + '33', borderWidth: 1.5, borderColor: t.colors.accent }} />
          <RNText style={tx('600', 11, t.colors.text)}>Job area</RNText>
        </View>
      </View>

      <View pointerEvents="none" style={{ position: 'absolute', left: 8, bottom: 8, right: 96, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.colors.bg, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 6 }}>
        <Icon name="lock" size={12} color={t.colors.accentDeep} />
        <RNText style={tx('600', 11, t.colors.text, { flexShrink: 1 })} numberOfLines={2}>
          Circles show the area, never the exact spot
        </RNText>
      </View>
    </View>
  );
}
