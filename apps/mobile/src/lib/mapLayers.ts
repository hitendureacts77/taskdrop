import type { MapItem } from './mapLayout';

/**
 * Everything on the map that is not a pin (plan 1.20, design D33): the reach
 * ring, the soft circle behind a spread area, the heat glow under job areas,
 * the "Approximate area" circle round a picked pin, and 3D buildings close in.
 *
 * One description for both engines. The web's MapLibre GL (GlMap.web.tsx) and
 * the phone's MapLibre Native (JobsMap.native.tsx) take the same style-spec
 * layers and the same GeoJSON, so the two maps look the same. These are drawn
 * by the map engine on the graphics chip, not as React views, so moving the
 * map never re-renders them.
 *
 * Privacy: every place here comes from the published (rounded) spots or from
 * the screen layout of them. Nothing here ever needs an exact location.
 *
 * Pure numbers only, so it runs in Node tests.
 */

export type LngLat = { lat: number; lng: number };
type Props = Record<string, number | string | boolean>;
export type PolygonFeature = { type: 'Feature'; properties: Props; geometry: { type: 'Polygon'; coordinates: [number, number][][] } };
export type PointFeature = { type: 'Feature'; properties: Props; geometry: { type: 'Point'; coordinates: [number, number] } };
export type Collection<F> = { type: 'FeatureCollection'; features: F[] };

/** A style-spec layer, as both engines take it. */
export type LayerSpec = {
  id: string;
  type: 'line' | 'fill' | 'circle' | 'symbol' | 'fill-extrusion';
  source: string;
  'source-layer'?: string;
  minzoom?: number;
  filter?: unknown[];
  paint: Record<string, unknown>;
  layout?: Record<string, unknown>;
};

const EARTH_M = 6371008.8;
const RAD = Math.PI / 180;

/** Published spots are rounded to about a kilometre (migration 074): a picked pin shows this circle, never a spot. */
export const APPROX_M = 1000;
export const APPROX_LABEL = 'Approximate area';

/** GL zoom counts 512 px tiles; lib/mapLayout and lib/mapReach count 256 px ones, one level higher. */
export const GL_TO_TILE = 1;
export const glToTile = (glZoom: number) => glZoom + GL_TO_TILE;
export const tileToGl = (tileZoom: number) => tileZoom - GL_TO_TILE;

/** Buildings rise from the app's zoom 16 (street level): GL zoom 15. */
export const BUILDINGS_GL_ZOOM = 15;
/** Close in the map leans back to show the buildings, and lies flat again further out. */
export const TILT_IN_GL_ZOOM = 15.5;
export const TILT_OUT_GL_ZOOM = 14.5;
export const TILT_DEG = 40;

/** OpenFreeMap's vector source in its Positron and Dark styles (OpenMapTiles schema). */
export const BASE_VECTOR_SOURCE = 'openmaptiles';

/** Source ids this module fills. Prefixed so they never clash with the base style's own. */
export const SRC = {
  ring: 'td-ring',
  areas: 'td-areas',
  glow: 'td-glow',
  approx: 'td-approx',
  approxLabel: 'td-approx-label',
} as const;

/** A circle of `metres` round `center`, as a closed polygon (good to well under a pixel at 64 steps). */
export function circle(center: LngLat, metres: number, steps = 64, properties: Props = {}): PolygonFeature {
  const lat0 = center.lat * RAD;
  const ring: [number, number][] = [];
  for (let i = 0; i < steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    const dLat = (metres * Math.cos(a)) / EARTH_M;
    const dLng = (metres * Math.sin(a)) / (EARTH_M * Math.max(0.01, Math.cos(lat0)));
    ring.push([center.lng + dLng / RAD, center.lat + dLat / RAD]);
  }
  ring.push(ring[0]!);
  return { type: 'Feature', properties, geometry: { type: 'Polygon', coordinates: [ring] } };
}

function point(at: LngLat, properties: Props = {}): PointFeature {
  return { type: 'Feature', properties, geometry: { type: 'Point', coordinates: [at.lng, at.lat] } };
}

const collection = <F>(features: F[]): Collection<F> => ({ type: 'FeatureCollection', features });

/** The point `metres` due north of `at` (where the "Approximate area" words sit). */
export function northOf(at: LngLat, metres: number): LngLat {
  return { lat: Math.min(85, at.lat + metres / EARTH_M / RAD), lng: at.lng };
}

/** Where a picked item really is: a spread pin's area centre (the published spot), else the pin itself. */
export function approxCentrePx(it: MapItem): { x: number; y: number } {
  return it.kind === 'one' && it.area ? { x: it.area.x, y: it.area.y } : { x: it.x, y: it.y };
}

export type Shapes = {
  ring: Collection<PolygonFeature>;
  areas: Collection<PolygonFeature>;
  glow: Collection<PointFeature>;
  approx: Collection<PolygonFeature>;
  approxLabel: Collection<PointFeature>;
};

/**
 * The GeoJSON for every non-pin shape, from the same screen layout the pins use
 * (groupPins + layoutPins). Run it when the map stops moving, with that moment's
 * layout; the engine keeps the shapes in place while the map moves.
 *
 * - `toPlace` turns layout pixels back into a place, `mpp` is metres per pixel then.
 * - `offers` is offersOf() for jobs (null for helpers and people: no glow).
 * - `pickedId` gets the "Approximate area" circle.
 */
export function sceneShapes(o: {
  items: MapItem[];
  toPlace: (x: number, y: number) => LngLat;
  mpp: number;
  ring: { at: LngLat; km: number } | null;
  offers: { top: (number | null)[]; best: number | null } | null;
  pickedId: string | null;
}): Shapes {
  const areas = new Map<string, PolygonFeature>();
  const glow: PointFeature[] = [];
  let picked: LngLat | null = null;

  o.items.forEach((it, i) => {
    if (it.kind === 'one' && it.area) {
      const key = `${Math.round(it.area.x)},${Math.round(it.area.y)}`;
      if (!areas.has(key)) areas.set(key, circle(o.toPlace(it.area.x, it.area.y), Math.max(it.area.rx, it.area.ry) * o.mpp));
    } else if (o.offers && o.offers.best) {
      // Spread pins sit inside their area's circle instead; everything else glows by its share of the best offer.
      const top = o.offers.top[i];
      if (top !== null && top !== undefined) glow.push(point(o.toPlace(it.x, it.y), { k: Math.max(0, Math.min(1, top / o.offers.best)) }));
    }
    if (o.pickedId !== null && it.kind === 'one' && it.id === o.pickedId) {
      const c = approxCentrePx(it);
      picked = o.toPlace(c.x, c.y);
    }
  });

  const at = picked as LngLat | null;
  return {
    ring: collection(o.ring ? [circle(o.ring.at, o.ring.km * 1000, 96)] : []),
    areas: collection([...areas.values()]),
    glow: collection(glow),
    approx: collection(at ? [circle(at, APPROX_M)] : []),
    approxLabel: collection(at ? [point(northOf(at, APPROX_M), { label: APPROX_LABEL })] : []),
  };
}

export type LayerColours = {
  /** The side's colour: jade on Hire, royal blue on Earn (theme tokens, never raw hex in screens). */
  hue: string;
  /** The reach ring's colour (today the blue/purple token). */
  ring: string;
  /** Text colour for the "Approximate area" words, and the halo behind them. */
  ink: string;
  halo: string;
  isDark: boolean;
  reduced: boolean;
};

/**
 * The shape layers, bottom to top. Put them under the base style's first
 * symbol layer so street and place names stay readable on top; the pins are
 * drawn above everything by the caller.
 */
export function shapeLayers(c: LayerColours): LayerSpec[] {
  const fade = { duration: c.reduced ? 0 : 300, delay: 0 };
  const glowRadius = (scale: number) => ['*', scale, ['+', 36, ['*', 46, ['get', 'k']]]];
  const glowOpacity = ['+', 0.07, ['*', 0.12, ['get', 'k']]];
  return [
    {
      id: 'td-ring-line',
      type: 'line',
      source: SRC.ring,
      paint: { 'line-color': c.ring, 'line-opacity': 0.47, 'line-width': 1, 'line-dasharray': [10, 8] },
    },
    // The heat glow: two soft discs, the inner one doubling the colour, as the old map drew it.
    { id: 'td-glow-outer', type: 'circle', source: SRC.glow, paint: { 'circle-color': c.hue, 'circle-opacity': glowOpacity, 'circle-radius': glowRadius(1), 'circle-opacity-transition': fade } },
    { id: 'td-glow-inner', type: 'circle', source: SRC.glow, paint: { 'circle-color': c.hue, 'circle-opacity': glowOpacity, 'circle-radius': glowRadius(0.5), 'circle-opacity-transition': fade } },
    { id: 'td-areas-fill', type: 'fill', source: SRC.areas, paint: { 'fill-color': c.hue, 'fill-opacity': 0.1, 'fill-opacity-transition': fade } },
    { id: 'td-areas-line', type: 'line', source: SRC.areas, paint: { 'line-color': c.hue, 'line-opacity': 0.5, 'line-width': 1, 'line-dasharray': [8, 6] } },
    { id: 'td-approx-fill', type: 'fill', source: SRC.approx, paint: { 'fill-color': c.hue, 'fill-opacity': 0.14, 'fill-opacity-transition': fade } },
    { id: 'td-approx-line', type: 'line', source: SRC.approx, paint: { 'line-color': c.hue, 'line-opacity': 0.6, 'line-width': 1.5 } },
    {
      id: 'td-approx-label',
      type: 'symbol',
      source: SRC.approxLabel,
      layout: {
        'text-field': ['get', 'label'],
        // OpenFreeMap serves Noto Sans; check the style's glyphs if this ever shows boxes.
        'text-font': ['Noto Sans Bold'],
        'text-size': 11,
        'text-anchor': 'bottom',
        'text-offset': [0, -0.3],
        'text-allow-overlap': true,
      },
      paint: { 'text-color': c.ink, 'text-halo-color': c.halo, 'text-halo-width': 1.5 },
    },
  ];
}

/** 3D buildings from street zoom (owner, 26 Nov: "3D buildings at zoom 16+"). Rises over half a zoom level. */
export function buildingLayer(isDark: boolean, vectorSource: string = BASE_VECTOR_SOURCE): LayerSpec {
  return {
    id: 'td-buildings-3d',
    type: 'fill-extrusion',
    source: vectorSource,
    'source-layer': 'building',
    minzoom: BUILDINGS_GL_ZOOM,
    paint: {
      'fill-extrusion-color': isDark ? '#2B303B' : '#D9DCE2',
      'fill-extrusion-height': [
        'interpolate',
        ['linear'],
        ['zoom'],
        BUILDINGS_GL_ZOOM,
        0,
        BUILDINGS_GL_ZOOM + 0.5,
        ['coalesce', ['get', 'render_height'], 8],
      ],
      'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
      'fill-extrusion-opacity': 0.75,
    },
  };
}

/**
 * After a zoom ends: the pitch to ease to, or null to leave it. Leans back
 * close in and lies flat further out; in between, whatever the person chose
 * stays. Reduced motion never tilts by itself.
 */
export function tiltAfterZoom(glZoom: number, pitch: number, reduced: boolean): number | null {
  if (reduced) return null;
  if (glZoom >= TILT_IN_GL_ZOOM && pitch < 1) return TILT_DEG;
  if (glZoom < TILT_OUT_GL_ZOOM && pitch >= 1) return 0;
  return null;
}
