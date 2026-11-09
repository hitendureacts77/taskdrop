import { createElement, useEffect, useRef, useState } from 'react';
import { View, Text as RNText, Pressable, Animated } from 'react-native';
import type * as Gl from 'maplibre-gl';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';
import { tx } from './primitives';
import { Ripples } from './Ripples';
import { MapPicker as TileMapPicker } from './MapPicker.tiles';
import { GL_TO_TILE, baseOptions, glStyleUrl, noRotation, useMapLib, type MapLib } from './GlMap.web';

type Props = Parameters<typeof TileMapPicker>[0];

/**
 * The location picker on the web (plan D21): the same pin nailed to the middle
 * with the map moving under it, but on the MapLibre map, so choosing your area
 * zooms and drags like Google Maps too. Falls back to the tile picker without WebGL.
 */
export function MapPicker(props: Props) {
  const lib = useMapLib();
  if (lib === null) return <TileMapPicker {...props} />;
  return <GlPicker {...props} lib={lib === 'loading' ? null : lib} />;
}

function GlPicker({ lib, lat, lng, zoom = 15, onMoved, height, radius = 12, controlsTop = 8, interactive = true }: Props & { lib: MapLib | null }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const box = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<Gl.Map | null>(null);
  const onMovedRef = useRef(onMoved);
  onMovedRef.current = onMoved;
  const dragging = useRef(false);
  const programmatic = useRef(0);
  const lift = useRef(new Animated.Value(0)).current;
  const landed = useRef(new Animated.Value(reduced ? 1 : 0)).current;

  useEffect(() => {
    if (!lib || !box.current) return;
    const m = new lib.Map({
      ...baseOptions(t.isDark),
      container: box.current,
      center: [lng, lat],
      zoom: zoom - GL_TO_TILE,
      interactive,
      // The picker sits in a sheet that scrolls: the wheel scrolls it, Ctrl + scroll or a pinch zooms the map.
      cooperativeGestures: true,
    });
    noRotation(m);
    const up = (on: boolean) => Animated.spring(lift, { toValue: on ? 1 : 0, useNativeDriver: true, friction: 6, tension: 140 }).start();
    m.on('dragstart', () => {
      dragging.current = true;
      up(true);
    });
    m.on('dragend', () => {
      dragging.current = false;
      up(false);
    });
    m.on('moveend', () => {
      if (programmatic.current > 0) {
        programmatic.current -= 1;
        return;
      }
      const c = m.getCenter();
      onMovedRef.current?.({ lat: c.lat, lng: c.lng });
    });
    setMap(m);
    return () => {
      m.remove();
      setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib]);

  useEffect(() => {
    if (map) map.setStyle(glStyleUrl(t.isDark));
  }, [map, t.isDark]);

  // Follow the caller when it repositions us (current location, a search hit), but not mid-drag.
  useEffect(() => {
    if (!map || dragging.current) return;
    const c = map.getCenter();
    if (Math.abs(c.lat - lat) < 1e-6 && Math.abs(c.lng - lng) < 1e-6) return;
    programmatic.current += 1;
    map.easeTo({ center: [lng, lat], duration: reduced ? 0 : 400 });
  }, [map, lat, lng, reduced]);

  // The pin drops onto the map when it opens.
  useEffect(() => {
    if (reduced) return;
    const anim = Animated.spring(landed, { toValue: 1, useNativeDriver: true, friction: 6, tension: 60 });
    anim.start();
    return () => anim.stop();
  }, [landed, reduced]);
  const pinLift = Animated.add(
    lift.interpolate({ inputRange: [0, 1], outputRange: [0, -10] }),
    landed.interpolate({ inputRange: [0, 1], outputRange: [-120, 0] }),
  );
  const shadowScale = lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.6] });

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
      {createElement('div', { ref: box, style: { position: 'absolute', inset: 0 }, 'aria-label': 'Map: drag to move the pin', role: 'region' })}

      {/* The pin never moves; the map moves under it. */}
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ position: 'absolute', top: '50%', left: '50%', width: 0, height: 0, alignItems: 'center', justifyContent: 'center' }}>
          <Ripples color={t.colors.accent} size={120} count={2} duration={2400} peak={0.7} />
        </View>
        <Animated.View style={{ alignItems: 'center', opacity: landed, transform: [{ translateY: pinLift }], marginBottom: 39 }}>
          <View
            style={{
              width: 26,
              height: 26,
              borderRadius: 999,
              backgroundColor: t.colors.btn,
              borderWidth: 3,
              borderColor: '#FFFFFF',
              shadowColor: '#000',
              shadowOpacity: 0.25,
              shadowRadius: 6,
              shadowOffset: { width: 0, height: 3 },
            }}
          />
          <View style={{ width: 2.5, height: 13, backgroundColor: t.colors.btn }} />
        </Animated.View>
        <Animated.View
          style={{ position: 'absolute', bottom: '50%', marginBottom: -2, width: 10, height: 4, borderRadius: 999, backgroundColor: 'rgba(0,0,0,0.35)', transform: [{ scaleX: shadowScale }] }}
        />
      </View>

      {interactive ? (
        <View style={{ position: 'absolute', right: 8, top: controlsTop, gap: 6 }}>
          {([1, -1] as const).map((by) => (
            <Pressable
              key={by}
              onPress={() => (by > 0 ? map?.zoomIn({ duration: reduced ? 0 : 300 }) : map?.zoomOut({ duration: reduced ? 0 : 300 }))}
              accessibilityRole="button"
              accessibilityLabel={by > 0 ? 'Zoom in' : 'Zoom out'}
              style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line, alignItems: 'center', justifyContent: 'center' }}
            >
              <RNText style={tx('700', 16, t.colors.ink)}>{by > 0 ? '+' : '−'}</RNText>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
