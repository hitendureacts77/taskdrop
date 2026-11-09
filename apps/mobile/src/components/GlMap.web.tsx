import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useState } from 'react';
import type * as Gl from 'maplibre-gl';

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

/** OpenFreeMap styles: Positron is light and quiet, Dark is its night version. */
export function glStyleUrl(isDark: boolean): string {
  return isDark ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/positron';
}

/** The map stops here: India with a margin, so the edges can still sit beside a side panel. [west, south], [east, north]. */
export const INDIA_BOUNDS: [[number, number], [number, number]] = [
  [58, -2],
  [108, 42],
];

/** GL zoom counts 512-px tiles; the rest of the app (and lib/mapLayout) counts 256-px ones, one level higher. */
export const GL_TO_TILE = 1;
export const GL_MIN_ZOOM = 3;
export const GL_MAX_ZOOM = 17;

let lib: Promise<MapLib> | null = null;

export function loadMapLib(): Promise<MapLib> {
  // The package is a UMD bundle: the namespace may sit on `default`.
  lib ??= import('maplibre-gl').then((m) => ((m as unknown as { default?: MapLib }).default ?? m) as MapLib);
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

/** Shared options for every map on the web: no tilting or turning, the map stays on India. */
export function baseOptions(isDark: boolean): Partial<Gl.MapOptions> {
  return {
    style: glStyleUrl(isDark),
    minZoom: GL_MIN_ZOOM,
    maxZoom: GL_MAX_ZOOM,
    maxBounds: INDIA_BOUNDS,
    renderWorldCopies: false,
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
