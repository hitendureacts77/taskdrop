import { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Animated } from 'react-native';
import type { CameraRef } from '@maplibre/maplibre-react-native';
import Svg, { Path, Circle } from 'react-native-svg';
import { useTheme } from '../providers/ThemeProvider';
import { tx } from './primitives';
import { MapPicker as TileMapPicker } from './MapPicker.tiles';
import { ML, type MapLibre } from '../lib/mapLibreNative';
import { glStyleUrl } from '../lib/mapStyle';
import { tileToGl } from '../lib/mapLayers';
import { useReducedMotion } from '../lib/motion';
import { locationPermission } from '../lib/location';

/**
 * Plan 1.20 (design D33): the picker is MapLibre Native, the same engine and
 * OpenFreeMap style as the jobs map. Expo Go and builds without the native
 * module use the tile map the web build uses (lib/mapLibreNative.ts).
 */
// Only read inside components that render when ML is not null.
const { Map: MLMap, Camera, UserLocation } =(ML ?? {}) as MapLibre;

/**
 * The drag-the-map location picker, native build, on a real map engine.
 *
 * Same idea as the web version (MapPicker.tsx): the pin is nailed to the
 * centre of the frame and the map moves underneath, the way Swiggy and Zomato
 * do it. Pinch-zoom, fling and the street detail come for free.
 */

/** Near enough that a move is just the echo of one we asked for. */
function same(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  return Math.abs(a.lat - b.lat) < 1e-6 && Math.abs(a.lng - b.lng) < 1e-6;
}

function Pin({ color }: { color: string }) {
  return (
    <Svg width={40} height={50} viewBox="0 0 40 50">
      <Path
        d="M20 2C10.6 2 3 9.5 3 18.8 3 31.4 20 48 20 48s17-16.6 17-29.2C37 9.5 29.4 2 20 2Z"
        fill={color}
        stroke="#FFFFFF"
        strokeWidth={2.5}
      />
      <Circle cx={20} cy={18.5} r={6.5} fill="#FFFFFF" />
    </Svg>
  );
}

type MapPickerProps = {
  lat: number;
  lng: number;
  zoom?: number;
  /** Fires when the pin settles somewhere new, not on every frame of a drag. */
  onMoved?: (next: { lat: number; lng: number }) => void;
  /** Fixed height, or leave it out to fill whatever space the parent gives. */
  height?: number;
  /** 0 for a full-bleed map that runs to the edges of the screen. */
  radius?: number;
  /** Positions the tile map's zoom buttons; the native map has none. */
  controlsTop?: number;
  /** false for a still preview of a point that has already been agreed. */
  interactive?: boolean;
};

export function MapPicker(props: MapPickerProps) {
  return ML ? <NativeMapPicker {...props} /> : <TileMapPicker {...props} />;
}

function NativeMapPicker({
  lat,
  lng,
  zoom = 16,
  onMoved,
  height,
  radius = 12,
  interactive = true,
}: MapPickerProps) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const camera = useRef<CameraRef>(null);
  const [hintVisible, setHintVisible] = useState(interactive);
  // The live-location dot (the old showsUserLocation) shows only when permission is already granted:
  // the picker only checks, it never asks.
  const [located, setLocated] = useState(false);
  useEffect(() => {
    let live = true;
    void locationPermission().then((p) => {
      if (live) setLocated(p.granted);
    });
    return () => {
      live = false;
    };
  }, []);

  // Where we last sent the camera. A region-change that lands there is our own
  // animation finishing, not the user choosing a spot, so it is not reported.
  const sentRef = useRef({ lat, lng });
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;

  // Follow the caller when it repositions us (current location, a search hit).
  useEffect(() => {
    if (same(sentRef.current, { lat, lng })) return;
    sentRef.current = { lat, lng };
    camera.current?.easeTo({ center: [lng, lat], zoom: tileToGl(zoom), duration: reduced ? 0 : 450 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lat, lng]);

  const lift = useRef(new Animated.Value(0)).current;
  const animateLift = useCallback(
    (up: boolean) => {
      Animated.spring(lift, { toValue: up ? 1 : 0, useNativeDriver: true, friction: 6, tension: 140 }).start();
    },
    [lift],
  );

  const dragging = useRef(false);
  const onRegionWillChange = (e: { nativeEvent: { userInteraction: boolean } }) => {
    // Only a finger lifts the pin; our own camera moves should not.
    if (!interactive || dragging.current) return;
    if (!e.nativeEvent.userInteraction) return;
    dragging.current = true;
    setHintVisible(false);
    animateLift(true);
  };

  const onRegionDidChange = (e: { nativeEvent: { center: [number, number] } }) => {
    if (dragging.current) {
      dragging.current = false;
      animateLift(false);
    }
    const next = { lat: e.nativeEvent.center[1], lng: e.nativeEvent.center[0] };
    if (same(next, sentRef.current)) return;
    sentRef.current = next;
    onMovedRef.current?.(next);
  };

  const pinLift = lift.interpolate({ inputRange: [0, 1], outputRange: [0, -14] });
  const shadowScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.55] });
  const shadowFade = lift.interpolate({ inputRange: [0, 1], outputRange: [0.35, 0.18] });

  return (
    <View
      style={{
        ...(height === undefined ? { flex: 1 } : { height }),
        borderRadius: radius,
        overflow: 'hidden',
        backgroundColor: t.colors.surface2,
        ...(radius > 0 ? { borderWidth: 1, borderColor: t.colors.line } : null),
      }}
    >
      <MLMap
        style={{ flex: 1 }}
        mapStyle={glStyleUrl(t.isDark)}
        onRegionWillChange={onRegionWillChange}
        onRegionDidChange={onRegionDidChange}
        dragPan={interactive}
        touchZoom={interactive}
        touchRotate={false}
        touchPitch={false}
        compass={false}
        logo={false}
        attribution
        attributionPosition={{ bottom: 8, right: 8 }}
      >
        <Camera ref={camera} initialViewState={{ center: [lng, lat], zoom: tileToGl(zoom) }} />
        {located ? <UserLocation /> : null}
      </MLMap>

      {/* The pin never moves. That is the whole idea — the map moves under it. */}
      <View
        pointerEvents="none"
        style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}
      >
        {hintVisible && (
          <View style={{ position: 'absolute', bottom: '50%', marginBottom: 58, alignItems: 'center' }}>
            <View
              style={{
                backgroundColor: t.colors.ink,
                paddingHorizontal: 12,
                paddingVertical: 8,
                borderRadius: 10,
                shadowColor: '#000',
                shadowOpacity: 0.2,
                shadowRadius: 8,
                shadowOffset: { width: 0, height: 3 },
                elevation: 5,
              }}
            >
              <RNText style={tx('700', 12, t.colors.bg)}>Move the map to place the pin exactly</RNText>
            </View>
            <View
              style={{
                width: 10,
                height: 10,
                backgroundColor: t.colors.ink,
                transform: [{ rotate: '45deg' }],
                marginTop: -5,
              }}
            />
          </View>
        )}
        {/* The pin's tip sits on the exact centre: it is drawn above it. */}
        <Animated.View style={{ marginBottom: 50, transform: [{ translateY: pinLift }] }}>
          <Pin color={t.colors.accent} />
        </Animated.View>
        <Animated.View
          style={{
            position: 'absolute',
            width: 14,
            height: 5,
            borderRadius: 999,
            backgroundColor: '#000',
            opacity: shadowFade,
            transform: [{ scaleX: shadowScale }],
          }}
        />
      </View>
    </View>
  );
}
