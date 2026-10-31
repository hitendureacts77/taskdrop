import { useEffect, useMemo, useRef, useState } from 'react';
import { View, Image, Text as RNText, Pressable, PanResponder, Platform, type LayoutChangeEvent } from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { Icon } from './Icon';
import { TILE, TILE_HEADERS, project, tileUrl, unproject } from './MapPicker.tiles';
import { groupPins, metresPerPixel } from '../lib/mapCluster';

export type JobPin = { id: string; lat: number; lng: number; label: string };

const MIN_ZOOM = 5;
const MAX_ZOOM = 17;
/** Two tags closer than this many pixels become one numbered circle. */
const CLUSTER_PX = 46;
/** Same reach as the "Near me" filter, drawn as a ring. */
const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };

/**
 * Open jobs on a map. You are the blue dot with your reach drawn around you,
 * and each job is a green price tag. Close tags join into a number; tap it to
 * zoom in. Built on the same plain tiles as the location picker, so it runs on
 * web and on a phone with no extra SDK or key. Pins are placed from the area
 * the post shows, never from an exact address.
 */
export function JobsMap({
  me,
  pins,
  selectedId,
  onSelect,
  height = 320,
}: {
  me: { lat: number; lng: number } | null;
  pins: JobPin[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  height?: number;
}) {
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
  const groups = groupPins(inView, CLUSTER_PX);

  const zoomTo = (next: number, at?: { lat: number; lng: number }) => {
    moved.current = true;
    if (at) setCentre(at);
    setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next)));
  };

  const you = me ? toScreen(me.lat, me.lng) : null;
  const ringPx = me ? (RING_KM * 1000) / metresPerPixel(me.lat, zoom) : 0;
  const blue = t.colors.purple;

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
    <View onLayout={onLayout} style={{ height, borderRadius: 18, overflow: 'hidden', backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line }}>
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
            <View style={{ position: 'absolute', width: 34, height: 34, borderRadius: 999, backgroundColor: blue + '33' }} />
            <View style={{ position: 'absolute', width: 16, height: 16, borderRadius: 999, backgroundColor: blue, borderWidth: 3, borderColor: '#FFFFFF' }} />
          </View>
        ) : null}

        {groups.map((g) => {
          if (g.ids.length > 1) {
            return (
              <Pressable
                key={g.ids.join('|')}
                onPress={() => {
                  const at = unproject(g.x + left, g.y + top, zoom);
                  zoomTo(zoom + 2, at);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${g.ids.length} jobs here. Zoom in`}
                style={{ position: 'absolute', left: g.x - 19, top: g.y - 19, width: 38, height: 38, borderRadius: 999, backgroundColor: t.colors.btn, borderWidth: 3, borderColor: t.colors.bg, alignItems: 'center', justifyContent: 'center' }}
              >
                <RNText style={tx('800', 15, t.colors.onBtn)}>{g.ids.length}</RNText>
              </Pressable>
            );
          }
          const id = g.ids[0]!;
          const pin = byId.get(id)!;
          const on = selectedId === id;
          const w = pin.label.length * 9 + 24;
          return (
            <Pressable
              key={id}
              onPress={() => onSelect(on ? null : id)}
              accessibilityRole="button"
              accessibilityLabel={`Job for ${pin.label}`}
              accessibilityState={{ selected: on }}
              style={{ position: 'absolute', left: g.x - w / 2, top: g.y - (on ? 40 : 34), width: w, alignItems: 'center', zIndex: on ? 2 : 1 }}
            >
              <View style={{ height: on ? 34 : 28, minWidth: w, borderRadius: 999, backgroundColor: on ? t.colors.ink : t.colors.btn, borderWidth: 2.5, borderColor: t.colors.bg, alignItems: 'center', justifyContent: 'center' }}>
                <RNText style={tx('800', on ? 14 : 13, on ? t.colors.bg : t.colors.onBtn, { fontVariant: ['tabular-nums'] })}>{pin.label}</RNText>
              </View>
              <View style={{ width: 0, height: 0, borderLeftWidth: 5, borderRightWidth: 5, borderTopWidth: 6, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderTopColor: on ? t.colors.ink : t.colors.btn }} />
            </Pressable>
          );
        })}
      </View>

      <View style={{ position: 'absolute', right: 8, top: 8, gap: 6 }}>
        {control('Zoom in', () => zoomTo(zoom + 1), <RNText style={tx('700', 18, t.colors.ink)}>+</RNText>)}
        {control('Zoom out', () => zoomTo(zoom - 1), <RNText style={tx('700', 18, t.colors.ink)}>−</RNText>)}
        {me ? control('Back to my area', () => (moved.current = false, setCentre(me), setZoom(12)), <Icon name="compass" size={18} color={blue} />) : null}
      </View>

      <View style={{ position: 'absolute', left: 8, top: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: t.colors.bg, borderRadius: 10, borderWidth: 1, borderColor: t.colors.line, paddingHorizontal: 10, paddingVertical: 6 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 9, height: 9, borderRadius: 999, backgroundColor: blue }} />
          <RNText style={tx('600', 11, t.colors.text)}>You</RNText>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <View style={{ width: 14, height: 9, borderRadius: 999, backgroundColor: t.colors.btn }} />
          <RNText style={tx('600', 11, t.colors.text)}>A job</RNText>
        </View>
      </View>

      {/* OpenStreetMap's licence requires this credit to stay visible. */}
      <RNText style={tx('400', 9, t.colors.muted, { position: 'absolute', right: 6, bottom: 4, backgroundColor: t.colors.bg, paddingHorizontal: 4, borderRadius: 4, overflow: 'hidden' })}>
        © OpenStreetMap
      </RNText>
    </View>
  );
}
