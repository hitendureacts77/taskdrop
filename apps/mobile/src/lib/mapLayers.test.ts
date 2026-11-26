import test from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROX_M,
  BUILDINGS_GL_ZOOM,
  TILT_DEG,
  buildingLayer,
  circle,
  glToTile,
  sceneShapes,
  shapeLayers,
  tiltAfterZoom,
  tileToGl,
} from './mapLayers.ts';
import type { MapItem } from './mapLayout.ts';

const M_PER_DEG_LAT = 111195;

test('a circle is closed and every corner sits at the radius', () => {
  const at = { lat: 12.97, lng: 77.59 };
  const c = circle(at, 1000);
  const ring = c.geometry.coordinates[0]!;
  assert.equal(ring.length, 65);
  assert.deepEqual(ring[0], ring[64]);
  for (const [lng, lat] of ring) {
    const dy = (lat - at.lat) * M_PER_DEG_LAT;
    const dx = (lng - at.lng) * M_PER_DEG_LAT * Math.cos((at.lat * Math.PI) / 180);
    assert.ok(Math.abs(Math.hypot(dx, dy) - 1000) < 5, `corner at ${Math.hypot(dx, dy)} m`);
  }
});

test('GL zoom and the app zoom are one level apart', () => {
  assert.equal(glToTile(13), 14);
  assert.equal(tileToGl(16), BUILDINGS_GL_ZOOM);
});

// A flat test projection: 1 px = 0.0001 degrees round (10, 70).
const toPlace = (x: number, y: number) => ({ lat: 10 - y * 0.0001, lng: 70 + x * 0.0001 });

const items: MapItem[] = [
  { kind: 'group', ids: ['a', 'b'], x: 0, y: 0 },
  { kind: 'one', id: 'c', x: 100, y: 0, area: null },
  { kind: 'one', id: 'd', x: 300, y: 0, area: { x: 320, y: 0, rx: 60, ry: 40 } },
  { kind: 'one', id: 'e', x: 340, y: 0, area: { x: 320, y: 0, rx: 60, ry: 40 } },
];

test('jobs glow by their share of the best offer; spread pins do not glow', () => {
  const s = sceneShapes({ items, toPlace, mpp: 10, ring: null, offers: { top: [800, 400, 900, 100], best: 800 }, pickedId: null });
  assert.equal(s.glow.features.length, 2);
  assert.equal(s.glow.features[0]!.properties.k, 1);
  assert.equal(s.glow.features[1]!.properties.k, 0.5);
});

test('helpers and people get no glow', () => {
  const s = sceneShapes({ items, toPlace, mpp: 10, ring: null, offers: null, pickedId: null });
  assert.equal(s.glow.features.length, 0);
});

test('one soft circle per spread area, sized from the layout', () => {
  const s = sceneShapes({ items, toPlace, mpp: 10, ring: null, offers: null, pickedId: null });
  assert.equal(s.areas.features.length, 1);
  const ring = s.areas.features[0]!.geometry.coordinates[0]!;
  const north = ring[0]!;
  assert.ok(Math.abs((north[1] - 10) * M_PER_DEG_LAT - 600) < 5); // 60 px x 10 m
});

test('a picked spread pin gets the approximate circle round its area centre, not round the pin', () => {
  const s = sceneShapes({ items, toPlace, mpp: 10, ring: null, offers: null, pickedId: 'e' });
  assert.equal(s.approx.features.length, 1);
  const centre = toPlace(320, 0);
  const ring = s.approx.features[0]!.geometry.coordinates[0]!;
  const north = ring[0]!;
  assert.ok(Math.abs(north[0] - centre.lng) < 1e-9);
  assert.ok(Math.abs((north[1] - centre.lat) * M_PER_DEG_LAT - APPROX_M) < 5);
  assert.equal(s.approxLabel.features[0]!.properties.label, 'Approximate area');
});

test('nothing picked, no ring asked: those collections are empty', () => {
  const s = sceneShapes({ items: [], toPlace, mpp: 10, ring: null, offers: null, pickedId: 'zzz' });
  assert.equal(s.approx.features.length, 0);
  assert.equal(s.ring.features.length, 0);
  const r = sceneShapes({ items: [], toPlace, mpp: 10, ring: { at: { lat: 10, lng: 70 }, km: 10 }, offers: null, pickedId: null });
  assert.equal(r.ring.features.length, 1);
});

test('layer ids are unique and point at our sources or the base vector source', () => {
  const layers = [...shapeLayers({ hue: '#0E8F72', ring: '#2F5BEA', ink: '#111111', halo: '#FFFFFF', isDark: false, reduced: false }), buildingLayer(false)];
  const ids = layers.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const l of layers) assert.ok(l.source.startsWith('td-') || l.source === 'openmaptiles', l.id);
  assert.equal(buildingLayer(true).minzoom, BUILDINGS_GL_ZOOM);
});

test('reduced motion turns the fades off', () => {
  const layers = shapeLayers({ hue: '#0E8F72', ring: '#2F5BEA', ink: '#111111', halo: '#FFFFFF', isDark: false, reduced: true });
  const fill = layers.find((l) => l.id === 'td-approx-fill')!;
  assert.deepEqual(fill.paint['fill-opacity-transition'], { duration: 0, delay: 0 });
});

test('the map leans back close in, lies flat further out, and never tilts itself under reduced motion', () => {
  assert.equal(tiltAfterZoom(15.6, 0, false), TILT_DEG);
  assert.equal(tiltAfterZoom(15.6, 30, false), null);
  assert.equal(tiltAfterZoom(14.2, TILT_DEG, false), 0);
  assert.equal(tiltAfterZoom(15, 0, false), null);
  assert.equal(tiltAfterZoom(16, 0, true), null);
});
