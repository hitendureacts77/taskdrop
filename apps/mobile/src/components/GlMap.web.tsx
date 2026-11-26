import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef, useState } from 'react';
import type * as Gl from 'maplibre-gl';
import { useLayout } from '../lib/layout';
import { pageZoom } from '../lib/desktopScale';
import { glStyleUrl } from '../lib/mapStyle';
import { BASE_VECTOR_SOURCE, SRC, buildingLayer, shapeLayers, type LayerColours, type LayerSpec, type Shapes } from '../lib/mapLayers';

/**
 * The web map engine (plan D21): MapLibre GL drawing OpenFreeMap's free vector
 * map. It gives the map what the owner asked for on 8 Nov: the mouse wheel,
 * a trackpad pinch and a double-click zoom the map (never the page), zoom is
 * smooth and in-between, the old map stays while the sharper one loads, and the
 * map stays on India. No key, no account, no request limit.
 *
 * The library is about 230 KB zipped, so it is only fetched when a map opens.
 * Without WebGL the callers fall back to the old tile map.
 */

export type MapLib = typeof Gl;

/** OpenFreeMap styles, shared with the phone map (lib/mapStyle.ts). */
export { glStyleUrl };

/** India with a margin. [west, south], [east, north]. The map no longer stops here (owner video, 9 Nov). */
export const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [58, -2],
  [108, 42],
];

/** GL zoom counts 512-px tiles; the rest of the app (and lib/mapLayout) counts 256-px ones, one level higher. */
export const GL_TO_TILE = 1;
/** Far enough out to see the whole world (owner video, 9 Nov: the map must move over the whole globe). */
export const GL_MIN_ZOOM = 1;
export const GL_MAX_ZOOM = 17;

let lib: Promise<MapLib> | null = null;

/** Where the site serves MapLibre's worker (copied in by scripts/copy-map-worker.mjs). */
const WORKER_PATH = '/map/maplibre-gl-worker.mjs';

export function loadMapLib(): Promise<MapLib> {
  lib ??= import('maplibre-gl').then((m) => {
    // Bundlers may hand the namespace back on `default`.
    const gl = ((m as unknown as { default?: MapLib }).default ?? m) as MapLib;
    // MapLibre looks for its worker next to its own file, which Metro cannot tell it; the version busts old caches.
    gl.setWorkerUrl(`${WORKER_PATH}?v=${gl.getVersion()}`);
    return gl;
  });
  return lib;
}

let webgl: boolean | null = null;

export function hasWebGL(): boolean {
  if (webgl !== null) return webgl;
  try {
    const c = document.createElement('canvas');
    webgl = !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    webgl = false;
  }
  return webgl;
}

/** The library once it has loaded; 'loading' until then; null when this browser cannot draw it (use the tile map). */
export function useMapLib(): MapLib | 'loading' | null {
  const [state, setState] = useState<MapLib | 'loading' | null>(() => (hasWebGL() ? 'loading' : null));
  useEffect(() => {
    if (state !== 'loading') return;
    let alive = true;
    loadMapLib()
      .then((m) => alive && setState(m))
      .catch(() => alive && setState(null));
    return () => {
      alive = false;
    };
  }, [state]);
  return state;
}

/** Shared options for every map on the web: no tilting or turning; the map moves over the whole world. */
export function baseOptions(isDark: boolean): Partial<Gl.MapOptions> {
  return {
    style: glStyleUrl(isDark),
    minZoom: GL_MIN_ZOOM,
    maxZoom: GL_MAX_ZOOM,
    renderWorldCopies: true,
    dragRotate: false,
    pitchWithRotate: false,
    touchPitch: false,
    attributionControl: { compact: true },
    fadeDuration: 200,
  };
}

/**
 * Turns off the rotation that pinch and the keyboard would otherwise allow, and folds the map credit
 * into its small (i) button: MapLibre opens it at first, and on a small map it covered half the view.
 * The credit stays one tap away, as the map's licence asks.
 */
export function noRotation(map: Gl.Map) {
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  const fold = () => map.getContainer().querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')?.classList.remove('maplibregl-compact-show');
  map.once('load', fold);
  // The credit text arrives with the map's data and opens the box again; fold it once the map has settled.
  map.once('idle', fold);
}

/** A point `km` north of `at`, for drawing a ring of that radius in screen pixels. */
export function kmNorth(at: { lat: number; lng: number }, km: number): [number, number] {
  return [at.lng, Math.min(85, at.lat + km / 111.32)];
}

/**
 * Keeps the map sharp on a zoomed desktop page (lib/desktopScale). MapLibre sizes its canvas from the
 * container's layout width, which under CSS zoom is in design px, so the browser would stretch a
 * smaller picture over the real pixels. Asking for `devicePixelRatio × zoom` gives one canvas pixel per
 * screen pixel. The mouse needs nothing: MapLibre already divides by the box's on-screen scale.
 * Off a zoomed page this never touches the map, so phones and tablets draw exactly as before.
 */
export function useSharpMap(map: Gl.Map | null): void {
  const { scale, width, height } = useLayout();
  const overridden = useRef(false);
  useEffect(() => {
    if (!map || typeof window === 'undefined') return;
    const zoom = pageZoom();
    if (zoom === 1) {
      // Back to MapLibre's own devicePixelRatio (its types do not list the null it accepts for that).
      if (overridden.current) map.setPixelRatio(null as unknown as number);
      overridden.current = false;
      return;
    }
    const ratio = window.devicePixelRatio * zoom;
    if (Math.abs(map.getPixelRatio() - ratio) > 0.001) map.setPixelRatio(ratio);
    overridden.current = true;
    // width and height: the browser's own zoom changes devicePixelRatio and the window size together.
  }, [map, scale, width, height]);
}

/**
 * Lets Ctrl + drag lean the map back (pitch) with the mouse, while rotation stays off: MapLibre's own
 * right/Ctrl-drag also turns the map, which this app never does (plan 1.20 step C). Touch pitch (two
 * fingers) is MapLibre's, switched on in the map's options.
 */
export function ctrlDragPitch(map: Gl.Map): () => void {
  const el = map.getCanvasContainer();
  let from: { y: number; pitch: number } | null = null;
  const move = (e: MouseEvent) => {
    if (!from) return;
    map.setPitch(Math.max(0, Math.min(MAX_PITCH, from.pitch + (from.y - e.clientY) * 0.4)));
  };
  const up = () => {
    from = null;
    window.removeEventListener('mousemove', move);
    window.removeEventListener('mouseup', up);
  };
  const down = (e: MouseEvent) => {
    if (e.button !== 0 || !e.ctrlKey) return;
    from = { y: e.clientY, pitch: map.getPitch() };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  el.addEventListener('mousedown', down);
  return () => {
    el.removeEventListener('mousedown', down);
    up();
  };
}

export const MAX_PITCH = 60;

/**
 * Puts the non-pin layers (lib/mapLayers.ts) and the 3D buildings into the map's style, under the base style's
 * first label layer so names stay readable. Safe to call again after a style swap (it replaces what it made).
 */
export function installLayers(map: Gl.Map, colours: LayerColours): void {
  const style = map.getStyle();
  if (!style) return;
  const before = style.layers.find((l) => l.type === 'symbol')?.id;
  const add = (spec: LayerSpec) => {
    if (map.getLayer(spec.id)) map.removeLayer(spec.id);
    map.addLayer(spec as unknown as Gl.LayerSpecification, before);
  };
  for (const id of Object.values(SRC)) if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  if (map.getSource(BASE_VECTOR_SOURCE)) add(buildingLayer(colours.isDark));
  for (const spec of shapeLayers(colours)) add(spec);
}

/** Feeds the shape sources (call when the map stops moving). */
export function setShapes(map: Gl.Map, shapes: Shapes): void {
  const put = (id: string, data: unknown) => (map.getSource(id) as Gl.GeoJSONSource | undefined)?.setData(data as GeoJSON.FeatureCollection);
  put(SRC.ring, shapes.ring);
  put(SRC.areas, shapes.areas);
  put(SRC.glow, shapes.glow);
  put(SRC.approx, shapes.approx);
  put(SRC.approxLabel, shapes.approxLabel);
}
