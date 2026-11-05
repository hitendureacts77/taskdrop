import test from 'node:test';
import assert from 'node:assert/strict';
import { forgetEverything, onForget, personKey, setPerson, wipeCount } from './freshness.ts';
import { makeLinkMemory } from './signedLinks.ts';

// Built exactly as lib/media.ts builds it.
const { cachedLink, joinPending, keeperFor, linkCount, linkKey } = makeLinkMemory({ personKey, wipeCount, onForget });

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const REUSE = 50 * 60 * 1000;

test('nothing is kept before the first session is known', () => {
  assert.equal(linkKey('tasks/x.jpg', 'card'), null);
  keeperFor('card')('tasks/x.jpg', 'https://signed/a', 1_000);
  assert.equal(linkCount(), 0);
});

test("a photo link signed for person A is never handed to person B or a guest", () => {
  setPerson(A);
  keeperFor('card')('tasks/x.jpg', 'https://signed/for-A', 1_000);
  assert.equal(cachedLink('tasks/x.jpg', 'card', REUSE, 2_000), 'https://signed/for-A');
  // Another size is another link.
  assert.equal(cachedLink('tasks/x.jpg', 'full', REUSE, 2_000), null);

  setPerson(B);
  assert.equal(cachedLink('tasks/x.jpg', 'card', REUSE, 2_001), null);
  setPerson(null);
  assert.equal(cachedLink('tasks/x.jpg', 'card', REUSE, 2_002), null);
  // And A's link did not survive the switch either.
  setPerson(A);
  assert.equal(cachedLink('tasks/x.jpg', 'card', REUSE, 2_003), null);
  assert.equal(linkCount(), 0);
});

test('the key carries the person', () => {
  setPerson(A);
  const ka = linkKey('p.jpg', 'thumb');
  setPerson(B);
  const kb = linkKey('p.jpg', 'thumb');
  assert.notEqual(ka, kb);
  assert.ok(ka?.startsWith(`${A}|`));
  assert.ok(kb?.startsWith(`${B}|`));
});

test('a link that arrives after a sign-out or a switch is not kept', () => {
  setPerson(A);
  const keep = keeperFor('card');
  setPerson(B);
  keep('late.jpg', 'https://signed/late-for-A', 3_000);
  assert.equal(linkCount(), 0);
  setPerson(A);
  assert.equal(cachedLink('late.jpg', 'card', REUSE, 3_001), null);

  const keep2 = keeperFor('card');
  forgetEverything();
  keep2('late.jpg', 'https://signed/after-wipe', 3_002);
  assert.equal(linkCount(), 0);
});

test('an old link expires', () => {
  setPerson(A);
  keeperFor('card')('old.jpg', 'https://signed/old', 10_000);
  assert.equal(cachedLink('old.jpg', 'card', REUSE, 10_000 + REUSE - 1), 'https://signed/old');
  assert.equal(cachedLink('old.jpg', 'card', REUSE, 10_000 + REUSE), null);
});

test("person B does not join person A's signing in flight", async () => {
  setPerson(A);
  let release: (v: string) => void = () => {};
  const forA = joinPending(linkKey('f.jpg', 'card'), () => new Promise<string>((r) => (release = r)));
  setPerson(B);
  const forB = joinPending(linkKey('f.jpg', 'card'), async () => 'https://signed/for-B');
  assert.equal(await forB, 'https://signed/for-B');
  release('https://signed/for-A');
  assert.equal(await forA, 'https://signed/for-A');
});

test('sign-out empties every photo link', () => {
  setPerson(A);
  keeperFor('thumb')('a.jpg', 'https://signed/1', 1);
  keeperFor('card')('b.jpg', 'https://signed/2', 1);
  assert.equal(linkCount(), 2);
  setPerson(null);
  assert.equal(linkCount(), 0);
});
