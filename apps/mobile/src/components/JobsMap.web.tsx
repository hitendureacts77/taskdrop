import { createElement, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { View, Text as RNText, Pressable, type LayoutChangeEvent } from 'react-native';
import type * as Gl from 'maplibre-gl';
import { useTheme } from '../providers/ThemeProvider';
import { useReducedMotion } from '../lib/motion';
import { SPREAD_ZOOM } from '../lib/mapLayout';
import { zoomToFit } from '../lib/mapReach';
import { sceneShapes, tiltAfterZoom, type Shapes } from '../lib/mapLayers';
import { project, unproject } from './MapPicker.tiles';
import { tx } from './primitives';
import { Icon } from './Icon';
import { JobsMap as TileJobsMap, YouMarker, type JobsMapProps } from './JobsMap.tiles';
import { CALLOUT_LIFT, MapPinLayer, controlsRect, type LayoutFrame, type Scene } from './MapPinLayer';
import { sideHue } from './MapMarkers';
import type { Rect } from '../lib/mapLabels';
import { GL_TO_TILE, MAX_PITCH, baseOptions, ctrlDragPitch, glStyleUrl, installLayers, noRotation, setShapes, useMapLib, useSharpMap, type MapLib } from './GlMap.web';

export { mapWords, type JobPin, type JobsMapProps, type MapTone } from './JobsMap.tiles';

const RING_KM = 10;
const DEFAULT_CENTRE = { lat: 12.9716, lng: 77.5946 };
/** A touch screen with no fine pointer: a phone or tablet, where pinching is the way to zoom. */
/** The map as it stood when it last stopped: where the layout (grouping, spreading, names) is made from. */
type Snap = { zoom: number; centre: { lat: number; lng: number }; at: { x: number; y: number } };
function takeSnap(m: Gl.Map): Snap {
  const c = m.getCenter();
  return { zoom: m.getZoom() + GL_TO_TILE, centre: { lat: c.lat, lng: c.lng }, at: m.project(c) };
}
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
  meKind = 'area',
}: JobsMapProps & { lib: MapLib | null }) {
  const t = useTheme();
  const reduce = useReducedMotion();
  const box = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<Gl.Map | null>(null);
  const [size, setSize] = useState({ w: 0, h: height });
  // Re-draws the pins once per frame while the map moves: they only follow their places, nothing is re-grouped.
  const [, setFrame] = useState(0);
  // The map when it last stopped; grouping, spreading and names are made from it (plan 1.20 step C).
  const [snap, setSnap] = useState<Snap | null>(null);
  // What the pins laid out last, which the engine-drawn shapes follow.
  const [scene, setScene] = useState<Scene | null>(null);
  // True while the map's style (and so our layers) is in place; false while a new look loads.
  const styleReady = useRef(false);
  const shapesRef = useRef<Shapes | null>(null);
  const zoomed = useRef(false);
  const moved = useRef(false);
  // Moves the app makes itself (fit, focus, a tapped group) do not count as the person moving the map.
  const programmatic = useRef(0);
  // Which look (light or dark) the map's style was made for, so the theme effect does not load the same style a second time.
  const styledDark = useRef<boolean | null>(null);
  const onMoveEndRef = useRef(onMoveEnd);
  onMoveEndRef.current = onMoveEnd;
  const ms = (n: number) => (reduce ? 0 : n);
  const people = tone === 'people';
  const colours = { hue: sideHue(t, people), ring: sideHue(t, people), ink: t.colors.ink, halo: t.colors.bg, isDark: t.isDark, reduced: reduce };
  const coloursRef = useRef(colours);
  coloursRef.current = colours;
  const reduceRef = useRef(reduce);
  reduceRef.current = reduce;

  // Make the map once the library is here.
  useEffect(() => {
    if (!lib || !box.current) return;
    const start = me ?? startAt ?? (pins[0] ? { lat: pins[0].lat, lng: pins[0].lng } : DEFAULT_CENTRE);
    styledDark.current = t.isDark;
    const m = new lib.Map({
      ...baseOptions(t.isDark),
      container: box.current,
      center: [start.lng, start.lat],
      zoom: startZoom - GL_TO_TILE,
      // Inside a page the wheel scrolls the page; Ctrl + scroll or a pinch zooms the map.
      cooperativeGestures: !fill,
      interactive: !bare,
      // Two fingers lean the map back close in (3D buildings); rotation stays off.
      touchPitch: true,
      maxPitch: MAX_PITCH,
    });
    noRotation(m);
    const stopPitch = ctrlDragPitch(m);
    // Our layers go in once the style is there, and again after a light/dark swap replaces it.
    m.on('style.load', () => {
      styleReady.current = true;
      installLayers(m, coloursRef.current);
      if (shapesRef.current) setShapes(m, shapesRef.current);
    });
    m.on('zoomend', () => (zoomed.current = true));
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
      // The map has stopped: lay the pins out again from here.
      setSnap(takeSnap(m));
      redraw();
      const wasZoom = zoomed.current;
      zoomed.current = false;
      if (programmatic.current > 0) programmatic.current -= 1;
      else {
        const c = m.getCenter();
        onMoveEndRef.current?.({ lat: c.lat, lng: c.lng });
      }
      // After a zoom: lean back close in, lie flat further out (the move is the app's own, not the person's).
      const pitch = wasZoom ? tiltAfterZoom(m.getZoom(), m.getPitch(), reduceRef.current) : null;
      if (pitch !== null) {
        programmatic.current += 1;
        m.easeTo({ pitch, duration: 500 });
      }
    });
    setMap(m);
    setSnap(takeSnap(m));
    return () => {
      stopPitch();
      styleReady.current = false;
      cancelAnimationFrame(raf);
      m.remove();
      setMap(null);
    };
    // The map is made once; later changes go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lib]);

  // Light and dark.
  useEffect(() => {
    if (!map || styledDark.current === t.isDark) return;
    styledDark.current = t.isDark;
    styleReady.current = false;
    map.setStyle(glStyleUrl(t.isDark));
  }, [map, t.isDark]);

  // Colours changed (the other side, or a new look): remake our layers if the style is already there.
  const hueKey = `${colours.hue}|${colours.ring}|${colours.ink}|${colours.halo}|${colours.isDark}|${colours.reduced}`;
  useEffect(() => {
    if (!map || !styleReady.current) return;
    installLayers(map, coloursRef.current);
    if (shapesRef.current) setShapes(map, shapesRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, hueKey]);
  useSharpMap(map);

  // A side panel or sheet covers part of the map: places are centred in what is left.
  const fillKey = fill ? `${fill.top},${fill.bottom},${fill.left ?? 0}` : '';
  useEffect(() => {
    if (map && fill) map.setPadding({ top: fill.top, bottom: fill.bottom, left: fill.left ?? 0, right: 0 });
    if (map) setSnap(takeSnap(map));
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
    if (map) setSnap(takeSnap(map));
  };

  const toScreen = (lat: number, lng: number) => {
    if (!map) return { x: -9999, y: -9999 };
    const p = map.project([lng, lat]);
    return { x: p.x, y: p.y };
  };
  const zoom = map ? map.getZoom() + GL_TO_TILE : startZoom;
  const blue = sideHue(t, people);
  const you = me && map ? toScreen(me.lat, me.lng) : null;
  const ringCentre = ringAt ?? me;

  // The layout frame: flat pixels at the zoom and middle of the last stop, and back to places.
  const frame = useMemo<LayoutFrame | null>(() => {
    if (!snap) return null;
    const c = project(snap.centre.lat, snap.centre.lng, snap.zoom);
    const toScreen2 = (lat: number, lng: number) => {
      const w = project(lat, lng, snap.zoom);
      return { x: snap.at.x + w.x - c.x, y: snap.at.y + w.y - c.y };
    };
    return {
      zoom: snap.zoom,
      toScreen: toScreen2,
      toPlace: (x, y) => unproject(c.x + x - snap.at.x, c.y + y - snap.at.y, snap.zoom),
      you: me ? toScreen2(me.lat, me.lng) : null,
      mpp: (156543.03392 * Math.cos((snap.centre.lat * Math.PI) / 180)) / 2 ** snap.zoom,
    };
  }, [snap, me?.lat, me?.lng]);

  // Ring, spread areas, heat glow and the "Approximate area" circle: map layers, fed when the layout changes.
  const ringKey = ringCentre ? `${ringCentre.lat},${ringCentre.lng},${ringKm}` : '';
  useEffect(() => {
    if (!map || !scene) return;
    const f = scene.frame;
    const shapes = sceneShapes({
      items: scene.items,
      toPlace: f.toPlace,
      mpp: f.mpp,
      ring: ringCentre ? { at: ringCentre, km: ringKm } : null,
      offers: scene.offers,
      pickedId: selectedId,
    });
    shapesRef.current = shapes;
    if (styleReady.current) setShapes(map, shapes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, scene, selectedId, ringKey]);

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
  // The + and − buttons, one rule on every map (Opus map audit): they zoom round the same middle and never
  // search again by themselves, as on Android and the tile map; a drag or a pinch is what searches.
  const zoomBy = (step: 1 | -1) => {
    if (!map) return;
    const next = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), map.getZoom() + step));
    if (next === map.getZoom()) return;
    moved.current = true;
    ease({ zoom: next, duration: 300 });
  };
  // Where the map's buttons sit, so pins step out from under them (P1-14): the full map's column at the
  // bottom right (compass, then + and − on a mouse), or the small map's expand button at the top right.
  const buttonsTall = (me ? 36 : 0) + (me && !COARSE ? 10 : 0) + (COARSE ? 0 : 73);
  const buttons: Rect | null = bare
    ? null
    : fill
      ? buttonsTall > 0
        ? { x: size.w - 16 - 40, y: size.h - (16 + fill.bottom + 18) - buttonsTall, w: 40, h: buttonsTall }
        : null
      : onExpand
        ? controlsRect(size, { right: 8, top: 8, button: 36, gap: 0, count: 1 })
        : null;
  const glass = { backgroundColor: t.colors.bg, borderWidth: 1, borderColor: t.colors.line, shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } };

  const overlay =
    map && frame && size.w > 0 ? (
      <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: size.w, height: size.h }}>
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
          controls={buttons}
          youLive={meKind === 'live'}
          layoutAt={frame ?? undefined}
          onScene={setScene}
        />
        {/* After the pins, so it is on top, and outside the dim layer. */}
        {you ? <YouMarker x={you.x} y={you.y} kind={meKind} /> : null}
      </View>
    ) : null;

  const frameStyle = fill
    ? { flex: 1, overflow: 'hidden' as const, backgroundColor: t.colors.surface2 }
    : { height, borderRadius: 18, overflow: 'hidden' as const, backgroundColor: t.colors.surface2, borderWidth: 1, borderColor: t.colors.line };

  return (
    <View onLayout={onLayout} style={frameStyle} testID="gl-map">
      {createElement('div', {
        ref: box,
        style: { position: 'absolute', inset: 0 },
        'aria-label': 'Map',
        role: 'region',
        // Read by the e2e tests (zoom and where the middle is), never by the app.
        'data-zoom': map ? map.getZoom().toFixed(2) : '',
        'data-layers': map ? ['td-ring-line', 'td-areas-fill', 'td-glow-outer', 'td-approx-fill', 'td-buildings-3d'].filter((id) => map.getLayer(id)).length : '',
        'data-pitch': map ? map.getPitch().toFixed(0) : '',
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
              {control('Zoom in', () => zoomBy(1), <RNText style={tx('700', 18, t.colors.text)}>+</RNText>, true)}
              <View style={{ height: 1, backgroundColor: t.colors.line }} />
              {control('Zoom out', () => zoomBy(-1), <RNText style={tx('700', 18, t.colors.text)}>−</RNText>, true)}
            </View>
          )}
        </View>
      ) : bare ? null : onExpand ? (
        <View style={{ position: 'absolute', right: 8, top: 8 }}>{control('Open the full map', onExpand, <Icon name="expand" size={16} color={t.colors.ink} />)}</View>
      ) : null}
    </View>
  );
}
