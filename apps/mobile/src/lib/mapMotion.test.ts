import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DOT_SCALE, MAX_INTRO_MS, RIPPLE_MS, SPOT_MS, SPREAD_MS, START_MS,
  areaAt, groupScale, introDelays, introEnd, isFresh, rippleAt, tagAt,
} from './mapMotion.ts';

test('areas start nearest to you first', () => {
  const d = introDelays([{ x: 300, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }], { x: 0, y: 0 });
  assert.equal(d[1], START_MS);
  assert.ok(d[1]! < d[2]! && d[2]! < d[0]!);
});

test('a long list still finishes its intro in time', () => {
  const pts = Array.from({ length: 80 }, (_, i) => ({ x: i, y: 0 }));
  const d = introDelays(pts, { x: 0, y: 0 });
  assert.ok(Math.max(...d) + SPOT_MS + SPREAD_MS <= MAX_INTRO_MS);
  assert.ok(introEnd(80) <= MAX_INTRO_MS);
});

test('an area is hidden, then a dense dot, then a settled soft circle', () => {
  assert.equal(areaAt(0, 100).shown, false);
  const dot = areaAt(100 + SPOT_MS - 1, 100);
  assert.ok(dot.shown && dot.dense === 1 && dot.scale <= DOT_SCALE);
  const done = areaAt(100 + SPOT_MS + SPREAD_MS, 100);
  assert.equal(done.scale, 1);
  assert.equal(done.dense, 0);
});

test('a tag pops in only after its circle has mostly spread', () => {
  assert.equal(tagAt(SPOT_MS, 0), 0);
  assert.equal(tagAt(5000, 0), 1);
});

test('ripples come and go, and only recent tasks ripple', () => {
  assert.equal(rippleAt(0), 0);
  assert.equal(rippleAt(RIPPLE_MS + 10), null);
  const now = Date.parse('2026-11-01T12:00:00Z');
  assert.equal(isFresh('2026-11-01T11:55:00Z', now), true);
  assert.equal(isFresh('2026-11-01T10:00:00Z', now), false);
  assert.equal(isFresh(null, now), false);
});

test('busier groups get a bigger circle, up to a limit', () => {
  assert.equal(groupScale(1), 1);
  assert.ok(groupScale(5) > groupScale(2));
  assert.equal(groupScale(500), 1.6);
});
