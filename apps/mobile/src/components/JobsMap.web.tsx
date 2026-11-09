import { createElement, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { View, Text as RNText, Pressable, type LayoutChangeEvent } from 'react-native';
import type * as Gl from 'maplibre-gl';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';
import { SPREAD_ZOOM } from '../lib/mapLayout';
import { zoomToFit } from '../lib/mapReach';
import { tx } from './primitives';
import { Icon } from './Icon';
import { JobsMap as TileJobsMap, type JobsMapProps } from './JobsMap.tiles';
import { CALLOUT_LIFT, MapPinLayer } from './MapPinLayer';
import { GL_TO_TILE, baseOptions, glStyleUrl, kmNorth, noRotation, useMapLib, type MapLib } from './GlMap.web';

export { mapWords, type JobPin, type JobsMapProps, type MapTone } from './JobsMap.tiles';

const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };
/** A touch screen with no fine pointer: a phone or tablet, where pinching is the way to zoom. */
const COARSE = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches && !window.matchMedia?.('(pointer: fine)').matches;

/**
 * The job and helper map on the web (plan D21). Same props and the same pins
 * as the tile map (JobsMap.tiles.tsx, still used in Expo Go and when a browser
 * has no WebGL), drawn over a MapLibre GL map so it zooms like Google Maps:
 * wheel and trackpad pinch round the pointer, double-click, flicks that glide,
 * and no blank screen while zooming. A full-screen map takes every gesture; a
 * map inside a page (Home, the Find work strip) asks for Ctrl + scroll, so the
 * page still scrolls under the mouse.
 */
export function JobsMap(props: JobsMapProps) {
  const lib = useMapLib();
  if (lib === null) return <TileJobsMap {...props} />;
  return <GlJobsMap {...props} lib={lib === 'loading' ? null : lib} />;
}

function GlJobsMap({
  lib,
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
  startAt,
  startZoom = 12,
  fit = null,
  ringAt,
  bare = false,
}: JobsMapProps & { lib: MapLib | null }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<Gl.Map | null>(null);
  const [size, setSize] = useState({ w: 0, h: height });
  // Re-draws the pins once per frame while the map moves.
  const [, setFrame] = useState(0);
  const moved = useRef(false);
  // Moves the app makes itself (fit, focus, a tapped group) do not count as the person moving the map.
  const programmatic = useRef(0);
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const ms = (n: number) => (reduce ? 0 : n);

  // Make the map once the library is here.
  useEffect(() => {
    if (!lib || !box.current) return;
    const start = me ?? startAt ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
    const m = new lib.Map({
      ...baseOptions(t.isDark),
      container: box.current,
      center: [start.lng, start.lat],
      zoom: startZoom - GL_TO_TILE,
      // Inside a page the wheel scrolls the page; Ctrl + scroll or a pinch zooms the map.
      cooperativeGestures: !fill,
      interactive: !bare,
    });
    noRotation(m);
    if (fill) m.setPadding({ top: fill.top, bottom: fill.bottom, left: fill.left ?? 0, right: 0 });
    let raf = 0;
    const redraw = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        setFrame((n) => n + 1);
      });
    };
    m.on('move', redraw);
    m.on('resize', redraw);
    m.on('dragstart', () => (moved.current = true));
    m.on('zoomstart', (e) => {
      if ((e as { originalEvent?: unknown }).originalEvent) moved.current = true;
    });
    m.on('moveend', () => {
      redraw();
      if (programmatic.current > 0) {
        programmatic.current -= 1;
        return;
      }
      const c = m.getCenter();
      onMoveEndRef.current?.({ lat: c.lat, lng: c.lng });
    });
    setMap(m);
    return () => {
      cancelAnimationFrame(raf);
      m.remove();
      setMap(null);
    };
    // The map is made once; later changes go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib]);

  // Light and dark.
  useEffect(() => {
    if (map) map.setStyle(glStyleUrl(t.isDark));
  }, [map, t.isDark]);

  // A side panel or sheet covers part of the map: places are centred in what is left.
  const fillKey = fill ? `${fill.top},${fill.bottom},${fill.left ?? 0}` : '';
  useEffect(() => {
    if (map && fill) map.setPadding({ top: fill.top, bottom: fill.bottom, left: fill.left ?? 0, right: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fillKey]);

  const ease = (opts: Gl.EaseToOptions) => {
    if (!map) return;
    programmatic.current += 1;
    map.easeTo({ ...opts, duration: ms(opts.duration ?? 500) });
  };

  // Once the first location arrives, start there; after that the map is the person's to move.
  useEffect(() => {
    if (!map || !me || moved.current) return;
    programmatic.current += 1;
    map.jumpTo({ center: [me.lng, me.lat] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, me?.lat, me?.lng]);

  // The full map's list picks a pin: bring it into the middle of the uncovered part, close enough to see it alone.
  useEffect(() => {
    const hit = focusId ? pins.find((p) => p.id === focusId) : null;
    if (!map || !hit) return;
    moved.current = true;
    ease({ center: [hit.lng, hit.lat], zoom: Math.max(map.getZoom(), SPREAD_ZOOM - GL_TO_TILE), offset: [0, callout ? CALLOUT_LIFT : 0] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, focusId]);

  // The reach buttons: fit the circle in the uncovered part. Not the person's own move.
  useEffect(() => {
    if (!map || !fit || size.w === 0) return;
    moved.current = true;
    const w = size.w - (fill?.left ?? 0);
    const h = size.h - (fill ? fill.top + fill.bottom : 0);
    const z = zoomToFit(fit.km, fit.at.lat, Math.min(w, h)) - GL_TO_TILE;
    ease({ center: [fit.at.lng, fit.at.lat], zoom: z, duration: 600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, fit?.key, size.w > 0]);

  const onLayout = (e: LayoutChangeEvent) => {
    setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) });
    map?.resize();
  };

  const toScreen = (lat: number, lng: number) => {
    if (!map) return { x: -9999, y: -9999 };
    const p = map.project([lng, lat]);
    return { x: p.x, y: p.y };
  };
  const zoom = map ? map.getZoom() + GL_TO_TILE : startZoom;
  const people = tone === 'people';
  const blue = t.colors.purple;
  // The poster is a dark dot on a map of helpers' faces, so the two never mix up.
  const youColor = people ? t.colors.ink : blue;
  const you = me && map ? toScreen(me.lat, me.lng) : null;
  const ringCentre = ringAt ?? me;
  const ring = ringCentre && map ? toScreen(ringCentre.lat, ringCentre.lng) : null;
  const ringPx = ring && ringCentre && map ? Math.abs(ring.y - map.project(kmNorth(ringCentre, ringKm)).y) : 0;

  const intoGroup = (x: number, y: number) => {
    if (!map) return;
    moved.current = true;
    const at = map.unproject([x, y]);
    ease({ center: at, zoom: Math.max(map.getZoom() + 2, SPREAD_ZOOM - GL_TO_TILE) });
    onMoveEndRef.current?.({ lat: at.lat, lng: at.lng });
  };

  const control = (label: string, onPress: () => void, child: React.ReactNode, small = false) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={{
        width: small ? 40 : 36,
        height: small ? 36 : 36,
        borderRadius: small ? 0 : 10,
        backgroundColor: small ? 'transparent' : t.colors.bg,
        borderWidth: small ? 0 : 1,
        borderColor: t.colors.line,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {child}
    </Pressable>
  );
  const glass = { backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } };

  const overlay =
    map && size.w > 0 ? (
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: size.w, height: size.h }}>
        {ring ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: ring.x, top: ring.y, width: 0, height: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', width: ringPx * 2, height: ringPx * 2, borderRadius: 999, borderWidth: 1, borderColor: blue + '77', borderStyle: 'dashed' }} />
          </View>
        ) : null}
        {you ? (
          <View pointerEvents="none" style={{ position: 'absolute', left: you.x, top: you.y, width: 0, height: 0, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ position: 'absolute', width: 26, height: 26, borderRadius: 999, backgroundColor: youColor + '40' }} />
            <View style={{ position: 'absolute', width: 14, height: 14, borderRadius: 999, backgroundColor: youColor, borderWidth: 2.5, borderColor: '#FFFFFF' }} />
          </View>
        ) : null}
        <MapPinLayer
          pins={pins}
          tone={tone}
          selectedId={selectedId}
          onSelect={onSelect}
          dim={dim}
          callout={callout}
          leftInset={fill?.left ?? 0}
          size={size}
          zoom={zoom}
          toScreen={toScreen}
          you={you}
          onGroup={intoGroup}
        />
      </View>
    ) : null;

  const frame = fill
    ? { flex: 1, overflow: 'hidden' as const, backgroundColor: t.colors.surface2 }
    : { height, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line };

  return (
    <View onLayout={onLayout} style={frame} testID="gl-map">
      {createElement('div', {
        ref: box,
        style: { position: 'absolute', inset: 0 },
        'aria-label': 'Map',
        role: 'region',
        // Read by the e2e tests (zoom and where the middle is), never by the app.
        'data-zoom': map ? map.getZoom().toFixed(2) : '',
        'data-centre': map ? `${map.getCenter().lat.toFixed(3)},${map.getCenter().lng.toFixed(3)}` : '',
      })}
      {/* The pins live inside the map's own layer, so a wheel or pinch over a pin still zooms the map. */}
      {map && overlay ? createPortal(overlay, map.getCanvasContainer()) : null}

      {fill ? (
        <View style={{ position: 'absolute', right: 16, bottom: 16 + fill.bottom + 18, gap: 10, alignItems: 'flex-end' }}>
          {me
            ? control(
                'Back to my area',
                () => {
                  moved.current = false;
                  ease({ center: [me.lng, me.lat], zoom: 12 - GL_TO_TILE });
                  onMoveEndRef.current?.(me);
                },
                <Icon name="compass" size={18} color={blue} />,
              )
            : null}
          {/* Phones pinch; the two small buttons are for a mouse with no wheel and for keyboards (decision 36c). */}
          {COARSE ? null : (
            <View style={[{ borderRadius: 12, overflow: 'hidden' }, glass]}>
              {control('Zoom in', () => map?.zoomIn({ duration: ms(300) }), <RNText style={tx('700', 18, t.colors.text)}>+</RNText>, true)}
              <View style={{ height: 1, backgroundColor: t.colors.line }} />
              {control('Zoom out', () => map?.zoomOut({ duration: ms(300) }), <RNText style={tx('700', 18, t.colors.text)}>−</RNText>, true)}
            </View>
          )}
        </View>
      ) : bare ? null : onExpand ? (
        <View style={{ position: 'absolute', right: 8, top: 8 }}>{control('Open the full map', onExpand, <Icon name="expand" size={16} color={t.colors.ink} />)}</View>
      ) : null}
    </View>
  );
}
