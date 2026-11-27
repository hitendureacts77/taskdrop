import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { shouldShowWalkthrough, videoUrl, walkCard, walkAnnouncement, walkSideFor, WALK_STEPS, WALK_LAST } from './walkthrough.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('each side has five real screens, and every picture is in assets/walkthrough', () => {
  for (const side of ['hire', 'earn'] as const) {
    assert.equal(WALK_STEPS[side].length, 5);
    for (const s of WALK_STEPS[side]) {
      assert.ok(existsSync(join(here, '..', '..', 'assets', 'walkthrough', `${s.shot}.jpg`)), `${s.shot}.jpg is missing`);
      assert.ok(s.title.length > 0 && s.body.length <= 120, `${s.shot} copy`);
    }
  }
});

test('cards go first card, five screens, last card, and clamp at both ends', () => {
  assert.deepEqual(walkCard('hire', 0), { kind: 'intro' });
  assert.deepEqual(walkCard('hire', -3), { kind: 'intro' });
  const c = walkCard('earn', 2);
  assert.equal(c.kind, 'step');
  if (c.kind === 'step') assert.equal(c.step.title, 'Send your price');
  assert.deepEqual(walkCard('earn', WALK_LAST), { kind: 'done' });
  assert.deepEqual(walkCard('earn', 99), { kind: 'done' });
});

test('the video button shows only for a YouTube link', () => {
  assert.equal(videoUrl(''), null);
  assert.equal(videoUrl('   '), null);
  assert.equal(videoUrl('https://example.com/watch?v=abcdefg'), null);
  assert.equal(videoUrl('http://youtu.be/abcdefg'), null);
  assert.equal(videoUrl('https://youtu.be/dQw4w9WgXcQ'), 'https://youtu.be/dQw4w9WgXcQ');
  assert.equal(videoUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), 'https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  assert.equal(videoUrl(' https://youtube.com/shorts/dQw4w9WgXcQ '), 'https://youtube.com/shorts/dQw4w9WgXcQ');
});

test('screen readers hear the step and the side', () => {
  assert.equal(walkAnnouncement('hire', 3), 'Step 3 of 5: Offers come to you');
  assert.match(walkAnnouncement('earn', 0), /get paid/);
});

test('it opens on the side asked for, else the mode the person is in', () => {
  assert.equal(walkSideFor('earn', 'poster'), 'earn');
  assert.equal(walkSideFor(undefined, 'worker'), 'earn');
  assert.equal(walkSideFor(undefined, null), 'hire');
  assert.equal(walkSideFor('other', 'poster'), 'hire');
});

test('it never opens by itself: people sign in and use the app first (owner, 27 Nov)', () => {
  const base = { signedIn: true, seen: false, screen: 'home', stagingCardClear: true };
  assert.equal(shouldShowWalkthrough(base), false);
});

test('switched back on, it opens only after sign-in, on Home, once, after the staging card', () => {
  const base = { signedIn: true, seen: false, screen: 'home', stagingCardClear: true };
  assert.equal(shouldShowWalkthrough(base, true), true);
  assert.equal(shouldShowWalkthrough({ ...base, signedIn: false }, true), false, 'a guest or a signed-out visitor');
  assert.equal(shouldShowWalkthrough({ ...base, seen: true }, true), false, 'already seen on this device');
  assert.equal(shouldShowWalkthrough({ ...base, seen: null }, true), false, 'not read yet');
  assert.equal(shouldShowWalkthrough({ ...base, screen: 'aiPost' }, true), false, 'a post being resumed comes first');
  assert.equal(shouldShowWalkthrough({ ...base, stagingCardClear: false }, true), false, 'the tester card is still open');
});
