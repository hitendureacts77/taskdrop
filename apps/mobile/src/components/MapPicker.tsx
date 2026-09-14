import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Image,
  Text as RNText,
  Pressable,
  Animated,
  PanResponder,
  type LayoutChangeEvent,
} from 'react-native';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';

/**
 * A drag-the-map location picker, the way Swiggy and Zomato do it: the pin is
 * nailed to the centre of the frame and the map moves underneath, so "where is
 * the pin" is never in question.
 *
 * It is a slippy map built from plain tile images rather than a mapping SDK.
 * That is a deliberate trade: react-native-maps does not run on the web build,
 * and shipping two implementations for one small picker is not worth it. Tiles
 * are just images, so the same component works on web and on device, with no
 * extra dependency and no API key.
 *
 * Tiles are OpenStreetMap's, which their licence allows at this volume provided
 * attribution stays visible — hence the credit in the corner, which is not
 * decoration and should not be removed.
 *
 * The Web Mercator maths is all in project/unproject below. Everything else is
 * bookkeeping: where the centre is, which tiles cover the frame, and how far a
 * finger moved.
 */

const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;

/** lat/lng -> absolute pixel on the world map at this zoom. */
function project(lat: number, lng: number, zoom: number): { x: number; y: number } {
  const scale = TILE * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  // Clamped, because the Mercator projection runs to infinity at the poles.
  const siny = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  const y = (0.5 - Math.log((1 + siny) / (1 - siny)) / (4 * Math.PI)) * scale;
  return { x, y };
}

/** The inverse: absolute world pixel -> lat/lng. */
function unproject(x: number, y: number, zoom: number): { lat: number; lng: number } {
  const scale = TILE * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
  return { lat, lng };
}

function tileUrl(z: number, x: number, y: number): string {
  return `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
}

export function MapPicker({
  lat,
  lng,
  zoom: initialZoom = 15,
  onMoved,
  height,
  radius = 12,
  controlsTop = 8,
}: {
  lat: number;
  lng: number;
  zoom?: number;
  /** Fires when the pin settles somewhere new, not on every frame of a drag. */
  onMoved: (next: { lat: number; lng: number }) => void;
  /** Fixed height, or leave it out to fill whatever space the parent gives. */
  height?: number;
  /** 0 for a full-bleed map that runs to the edges of the screen. */
  radius?: number;
  /** Push the zoom buttons down, so anything floating over the top clears them. */
  controlsTop?: number;
}) {
  const t = useTheme();
  const [zoom, setZoom] = useState(initialZoom);
  const [size, setSize] = useState({ w: 0, h: height ?? 0 });
  const [centre, setCentre] = useState({ lat, lng });

  // A drag reads and writes these every frame, so they are refs: the
  // PanResponder is built once and would otherwise close over stale values.
  const centreRef = useRef(centre);
  centreRef.current = centre;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const startRef = useRef(centre);
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;

  // Follow the caller when it repositions us (current location, a search hit),
  // but not while the user's own finger is deciding where to be.
  const draggingRef = useRef(false);
  useEffect(() => {
    if (draggingRef.current) return;
    setCentre({ lat, lng });
  }, [lat, lng]);

  const lift = useRef(new Animated.Value(0)).current;
  const animateLift = useCallback(
    (up: boolean) => {
      Animated.spring(lift, {
        toValue: up ? 1 : 0,
        useNativeDriver: true,
        friction: 6,
        tension: 140,
      }).start();
    },
    [lift],
  );

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      // An ancestor ScrollView must not be able to take the gesture back.
      onPanResponderTerminationRequest: () => false,
      onShouldBlockNativeResponder: () => true,
      onPanResponderGrant: () => {
        draggingRef.current = true;
        startRef.current = centreRef.current;
        animateLift(true);
      },
      onPanResponderMove: (_e, g) => {
        const z = zoomRef.current;
        const from = project(startRef.current.lat, startRef.current.lng, z);
        // Drag right means look further left, so the centre moves against the finger.
        setCentre(unproject(from.x - g.dx, from.y - g.dy, z));
      },
      onPanResponderRelease: () => {
        draggingRef.current = false;
        animateLift(false);
        onMovedRef.current(centreRef.current);
      },
      onPanResponderTerminate: () => {
        draggingRef.current = false;
        animateLift(false);
        onMovedRef.current(centreRef.current);
      },
    }),
  ).current;

  const changeZoom = (by: number) => {
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + by));
    if (next === zoom) return;
    setZoom(next);
    // Zooming keeps the same centre, so the pin still means what it meant.
    onMoved(centreRef.current);
  };

  // Which tiles cover the frame, and where each one sits within it.
  const tiles = useMemo(() => {
    if (size.w === 0) return [];
    const c = project(centre.lat, centre.lng, zoom);
    const left = c.x - size.w / 2;
    const top = c.y - size.h / 2;

    const first = { x: Math.floor(left / TILE), y: Math.floor(top / TILE) };
    const last = { x: Math.floor((left + size.w) / TILE), y: Math.floor((top + size.h) / TILE) };
    const span = 2 ** zoom;

    const out: { key: string; url: string; x: number; y: number }[] = [];
    for (let ty = first.y; ty <= last.y; ty++) {
      for (let tx2 = first.x; tx2 <= last.x; tx2++) {
        // Wrap east-west so dragging past the date line keeps working; there is
        // nothing above or below the world, so those rows are simply skipped.
        if (ty < 0 || ty >= span) continue;
        const wrapped = ((tx2 % span) + span) % span;
        out.push({
          key: `${zoom}/${tx2}/${ty}`,
          url: tileUrl(zoom, wrapped, ty),
          x: tx2 * TILE - left,
          y: ty * TILE - top,
        });
      }
    }
    return out;
  }, [centre, zoom, size]);

  const onLayout = (e: LayoutChangeEvent) => {
    // Measured rather than assumed: without a height prop this fills the
    // parent, and the tile grid has to know how tall that turned out to be.
    const { width, height: measured } = e.nativeEvent.layout;
    setSize({ w: Math.round(width), h: Math.round(measured) });
  };

  const pinLift = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -10] });
  const shadowScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] });

  return (
    <View
      onLayout={onLayout}
      style={{
        ...(height === undefined ? { flex: 1 } : { height }),
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: t.colors.surface2,
        ...(radius > 0 ? { borderWidth: 1, borderColor: t.colors.line } : null),
      }}
    >
      <View {...pan.panHandlers} style={{ flex: 1 }}>
        {tiles.map((tile) => (
          <Image
            key={tile.key}
            source={{ uri: tile.url }}
            style={{ position: 'absolute', left: tile.x, top: tile.y, width: TILE, height: TILE }}
            // Tiles are a backdrop; the pin is what matters here.
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        ))}

        {/* The pin never moves. That is the whole idea — the map moves under it,
            so there is no question about which point is being chosen. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: 0,
            bottom: 0,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Animated.View style={{ alignItems: 'center', transform: [{ translateY: pinLift }] }}>
            <View
              style={{
                width: 22,
                height: 22,
                borderRadius: 999,
                backgroundColor: t.colors.accent,
                borderWidth: 3,
                borderColor: '#FFFFFF',
              }}
            />
            <View style={{ width: 2, height: 12, backgroundColor: t.colors.accent }} />
          </Animated.View>
          {/* A shadow that tightens as the pin lifts, so a drag reads as a lift. */}
          <Animated.View
            style={{
              position: 'absolute',
              bottom: '50%',
              marginBottom: -6,
              width: 10,
              height: 4,
              borderRadius: 999,
              backgroundColor: 'rgba(0,0,0,0.35)',
              transform: [{ scaleX: shadowScale }],
            }}
          />
        </View>
      </View>

      <View style={{ position: 'absolute', right: 8, top: controlsTop, gap: 6 }}>
        {([1, -1] as const).map((by) => (
          <Pressable
            key={by}
            onPress={() => changeZoom(by)}
            accessibilityRole="button"
            accessibilityLabel={by > 0 ? 'Zoom in' : 'Zoom out'}
            style={{
              width: 30,
              height: 30,
              borderRadius: 8,
              backgroundColor: t.colors.bg,
              borderWidth: 1,
              borderColor: t.colors.line,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <RNText style={tx('700', 16, t.colors.ink)}>{by > 0 ? '+' : '−'}</RNText>
          </Pressable>
        ))}
      </View>

      {/* OpenStreetMap's licence requires this credit to stay visible. */}
      <RNText
        style={tx('400', 9, t.colors.muted, {
          position: 'absolute',
          right: 6,
          bottom: 4,
          backgroundColor: t.colors.bg,
          paddingHorizontal: 4,
          borderRadius: 4,
          overflow: 'hidden',
        })}
      >
        © OpenStreetMap
      </RNText>
    </View>
  );
}
