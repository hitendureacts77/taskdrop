import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fakePinCount, makeFakePins } from './fakePins.ts';

test('makeFakePins: count, rounded coordinates, a mix of offers and some fresh, same every time', () => {
  const a = makeFakePins(2000);
  assert.equal(a.length, 2000);
  assert.equal(new Set(a.map((p) => p.id)).size, 2000);
  for (const p of a) {
    assert.equal(p.lat, Number(p.lat.toFixed(3)));
    assert.equal(p.lng, Number(p.lng.toFixed(3)));
    assert.ok(Math.abs(p.lat - 12.9716) < 0.3 && Math.abs(p.lng - 77.5946) < 0.3);
  }
  assert.ok(new Set(a.map((p) => p.amount)).size >= 5);
  const fresh = a.filter((p) => p.fresh).length;
  assert.ok(fresh > 100 && fresh < 400, `fresh ${fresh}`);
  assert.deepEqual(makeFakePins(50), makeFakePins(50));
});

test('fakePinCount: off unless the build flag is set', () => {
  delete process.env.EXPO_PUBLIC_E2E_FAKE_PINS;
  assert.equal(fakePinCount('?fakepins=2000'), 0);
  process.env.EXPO_PUBLIC_E2E_FAKE_PINS = '1';
  assert.equal(fakePinCount('?fakepins=2000'), 2000);
  assert.equal(fakePinCount(''), 0);
  assert.equal(fakePinCount('?fakepins=abc'), 0);
  assert.equal(fakePinCount('?fakepins=99999999'), 20000);
  delete process.env.EXPO_PUBLIC_E2E_FAKE_PINS;
});
