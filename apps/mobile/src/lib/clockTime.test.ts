import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MINUTES,
  firstAllowedMinute,
  floorMinute,
  from24,
  isTimeAllowed,
  nearestAllowedMinute,
  pointToHour,
  pointToMinute,
  polar,
  snapMinute,
  to24,
} from './clockTime.ts';

test('12-hour dial to 24-hour clock', () => {
  assert.equal(to24(12, false), 0);
  assert.equal(to24(12, true), 12);
  assert.equal(to24(1, false), 1);
  assert.equal(to24(1, true), 13);
  assert.equal(to24(11, true), 23);
});

test('24-hour clock back to the dial, and the two agree for every hour', () => {
  assert.deepEqual(from24(0), { h12: 12, pm: false });
  assert.deepEqual(from24(12), { h12: 12, pm: true });
  assert.deepEqual(from24(23), { h12: 11, pm: true });
  for (let h = 0; h < 24; h++) {
    const { h12, pm } = from24(h);
    assert.equal(to24(h12, pm), h);
  }
});

test('minutes come in 5-minute steps', () => {
  assert.equal(MINUTES.length, 12);
  assert.equal(MINUTES[1], 5);
  assert.deepEqual(snapMinute(32), { minute: 30, carry: 0 });
  assert.deepEqual(snapMinute(33), { minute: 35, carry: 0 });
  assert.deepEqual(snapMinute(58), { minute: 0, carry: 1 });
  assert.equal(floorMinute(34), 30);
  assert.equal(floorMinute(59), 55);
});

test('a point on the dial maps to the nearest hour and minute', () => {
  const c = 100;
  assert.equal(pointToHour(100, 20, c, c), 12); // straight up
  assert.equal(pointToHour(180, 100, c, c), 3); // right
  assert.equal(pointToHour(100, 180, c, c), 6); // down
  assert.equal(pointToHour(20, 100, c, c), 9); // left
  assert.equal(pointToMinute(100, 20, c, c), 0);
  assert.equal(pointToMinute(180, 100, c, c), 15);
  assert.equal(pointToMinute(100, 180, c, c), 30);
  assert.equal(pointToMinute(20, 100, c, c), 45);
  // just left of 12 still reads 55, not 0
  assert.equal(pointToMinute(60, 22, c, c), 55);
});

test('polar places hour 3 to the right of the centre', () => {
  const p = polar(3, 12, 80, 100, 100);
  assert.ok(Math.abs(p.x - 180) < 1e-9 && Math.abs(p.y - 100) < 1e-9);
});

test('min and max limits decide which times are allowed', () => {
  const day = new Date(2026, 10, 30);
  const now = new Date(2026, 10, 30, 10, 12);
  assert.equal(isTimeAllowed(day, 10, 10, {}, now), false); // already gone
  assert.equal(isTimeAllowed(day, 10, 15, {}, now), true);
  assert.equal(isTimeAllowed(day, 10, 15, { max: new Date(2026, 10, 30, 10, 10) }, now), false);
  assert.equal(isTimeAllowed(day, 9, 0, { min: new Date(2026, 10, 30, 8, 0) }, now), true); // own min beats now
  assert.equal(isTimeAllowed(new Date(2026, 11, 1), 0, 0, {}, now), true);
});

test('first and nearest allowed minute inside an hour', () => {
  const day = new Date(2026, 10, 30);
  const now = new Date(2026, 10, 30, 10, 12);
  assert.equal(firstAllowedMinute(day, 10, {}, now), 15);
  assert.equal(firstAllowedMinute(day, 9, {}, now), null);
  assert.equal(nearestAllowedMinute(day, 10, 0, {}, now), 15);
  assert.equal(nearestAllowedMinute(day, 11, 20, {}, now), 20);
  assert.equal(nearestAllowedMinute(day, 9, 20, {}, now), null);
});
