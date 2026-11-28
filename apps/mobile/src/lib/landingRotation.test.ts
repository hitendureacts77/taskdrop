import test from 'node:test';
import assert from 'node:assert/strict';
import { createRotator, nextIndex, ROTATE_MS, type RotatorTimers } from './landingRotation.ts';

function fake() {
  let now = 0;
  let nid = 0;
  const pending = new Map<number, { at: number; fn: () => void }>();
  const timers: RotatorTimers = {
    set: (fn, ms) => {
      pending.set(++nid, { at: now + ms, fn });
      return nid;
    },
    clear: (id) => void pending.delete(id as number),
  };
  const advance = (ms: number) => {
    const end = now + ms;
    for (;;) {
      const next = [...pending.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      if (!next || next[1].at > end) break;
      now = next[1].at;
      pending.delete(next[0]);
      next[1].fn();
    }
    now = end;
  };
  return { timers, advance };
}

test('nextIndex wraps', () => {
  assert.equal(nextIndex(0, 2), 1);
  assert.equal(nextIndex(1, 2), 0);
});

test('swaps every 20 s, forever', () => {
  const f = fake();
  const seen: number[] = [];
  const r = createRotator({ count: 2, onChange: (i) => seen.push(i), timers: f.timers });
  r.start();
  f.advance(ROTATE_MS - 1);
  assert.deepEqual(seen, []);
  f.advance(1);
  f.advance(ROTATE_MS);
  f.advance(ROTATE_MS);
  assert.deepEqual(seen, [1, 0, 1]);
});

test('a dot click restarts the 20 s wait', () => {
  const f = fake();
  const seen: number[] = [];
  const r = createRotator({ count: 2, onChange: (i) => seen.push(i), timers: f.timers });
  r.start();
  f.advance(15000);
  r.select(1);
  f.advance(19999);
  assert.deepEqual(seen, [1]);
  f.advance(1);
  assert.deepEqual(seen, [1, 0]);
});

test('paused while the tab is hidden, full wait after it returns', () => {
  const f = fake();
  const seen: number[] = [];
  const r = createRotator({ count: 2, onChange: (i) => seen.push(i), timers: f.timers });
  r.start();
  f.advance(10000);
  r.pause();
  f.advance(120000);
  assert.deepEqual(seen, []);
  r.resume();
  f.advance(ROTATE_MS - 1);
  assert.deepEqual(seen, []);
  f.advance(1);
  assert.deepEqual(seen, [1]);
});
