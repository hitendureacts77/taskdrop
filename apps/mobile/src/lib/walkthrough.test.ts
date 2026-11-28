import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  shouldShowWalkthrough,
  stagingCardCanBlock,
  stagingCardIsClear,
  swipeDirection,
  tapHalf,
  videoUrl,
  walkCard,
  walkAnnouncement,
  walkSideFor,
  walkStepClamp,
  walkSeenKey,
  WALK_AUTO_TRIES,
  WALK_AUTOPLAY_MS,
  WALK_STEPS,
  WALK_LAST,
} from './walkthrough.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('each side has five real screens, and every picture is in assets/walkthrough', () => {
  for (const side of ['hire', 'earn'] as const) {
    assert.equal(WALK_STEPS[side].length, 5);
    for (const s of WALK_STEPS[side]) {
      assert.ok(existsSync(join(here, '..', '..', 'assets', 'walkthrough', `${s.shot}.jpg`)), `${s.shot}.jpg is missing`);
      assert.ok(s.title.length > 0 && s.body.length <= 120, `${s.shot} copy`);
      assert.ok(s.purpose.length > 0 && s.purpose.length <= 60, `${s.shot} says what it is for, in one short line`);
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

test('it opens by itself after a new sign-in or Continue as guest, on Home, once, after the staging card', () => {
  const base = { entered: true, seen: false, screen: 'home', stagingCardClear: true };
  assert.equal(shouldShowWalkthrough(base), true, 'a signed-in person or a new guest');
  assert.equal(shouldShowWalkthrough({ ...base, entered: false }), false, 'a signed-out visitor who has not chosen guest');
  assert.equal(shouldShowWalkthrough({ ...base, screen: 'welcome' }), false, 'never on the sign-in page');
  assert.equal(shouldShowWalkthrough({ ...base, seen: true }), false, 'already seen on this device');
  assert.equal(shouldShowWalkthrough({ ...base, seen: null }), false, 'not read yet');
  assert.equal(shouldShowWalkthrough({ ...base, screen: 'aiPost' }), false, 'a post being resumed comes first');
  assert.equal(shouldShowWalkthrough({ ...base, stagingCardClear: false }), false, 'the tester card is still open');
});

test('the staging tester card only holds the walkthrough back for a signed-in person on staging (a guest never sees that card)', () => {
  assert.equal(stagingCardCanBlock({ stagingUi: true, signedIn: true }), true, 'signed in on staging: the card goes first');
  assert.equal(stagingCardCanBlock({ stagingUi: true, signedIn: false }), false, 'a guest on staging has no card to wait for');
  assert.equal(stagingCardCanBlock({ stagingUi: false, signedIn: true }), false, 'production has no card');
  // A guest on staging: nothing blocks, so the walkthrough opens.
  assert.equal(
    shouldShowWalkthrough({ entered: true, seen: false, screen: 'home', stagingCardClear: !stagingCardCanBlock({ stagingUi: true, signedIn: false }) }),
    true,
  );
});

test('right after a sign-in on staging the tester card goes first: an old "clear" is never carried across the sign-in', () => {
  const staging = { stagingUi: true };
  assert.equal(stagingCardIsClear({ ...staging, signedIn: false, storedSeen: null }), true, 'signed out: nothing to wait for');
  assert.equal(stagingCardIsClear({ ...staging, signedIn: true, storedSeen: null }), false, 'signed in, not read yet: wait');
  assert.equal(stagingCardIsClear({ ...staging, signedIn: true, storedSeen: false }), false, 'signed in, card not closed yet');
  assert.equal(stagingCardIsClear({ ...staging, signedIn: true, storedSeen: true }), true, 'the card was closed');
  assert.equal(stagingCardIsClear({ stagingUi: false, signedIn: true, storedSeen: null }), true, 'production has no card');
});

test('steps clamp at both ends and the last one does not loop', () => {
  assert.equal(walkStepClamp(0, -1), 0);
  assert.equal(walkStepClamp(0, 1), 1);
  assert.equal(walkStepClamp(3, 1), 4);
  assert.equal(walkStepClamp(4, 1), 4, 'stops on the last step');
  assert.equal(walkStepClamp(2, -1), 1);
});

test('swipe left is next, swipe right is back, a small drag is nothing', () => {
  assert.equal(swipeDirection(-80), 'next');
  assert.equal(swipeDirection(80), 'prev');
  assert.equal(swipeDirection(-39), null);
  assert.equal(swipeDirection(12), null);
  assert.equal(swipeDirection(-40), 'next');
});

test('tap on the right half is next, left half is back', () => {
  assert.equal(tapHalf(300, 390), 'next');
  assert.equal(tapHalf(40, 390), 'prev');
  assert.equal(tapHalf(195, 390), 'next');
  assert.equal(tapHalf(10, 0), 'next');
});

test('each step plays five seconds', () => {
  assert.equal(WALK_AUTOPLAY_MS, 5000);
});

test('it is remembered per person: each account and the guest get their own first time on a device (28 Nov)', () => {
  assert.equal(walkSeenKey({ userId: null, guest: false }), null, 'nobody is in: nothing to remember');
  const guestKey = walkSeenKey({ userId: null, guest: true });
  const a = walkSeenKey({ userId: 'acc-a', guest: false });
  const b = walkSeenKey({ userId: 'acc-b', guest: false });
  assert.ok(guestKey && a && b);
  assert.notEqual(a, b, 'a new account on the same phone gets it once too');
  assert.notEqual(a, guestKey, 'a guest who then makes an account sees it once as the new account');
  assert.equal(walkSeenKey({ userId: 'acc-a', guest: true }), a, 'signed in wins over the guest flag');
  // The old one-per-device flag was also set by the old pre-sign-in intro, so it is never read again.
  for (const k of [guestKey, a, b]) assert.notEqual(k, 'taskdrop.intro.v1');
});

test('it opens by itself at most twice per person per app run, so it can never loop', () => {
  const base = { entered: true, seen: false, screen: 'home', stagingCardClear: true };
  assert.equal(shouldShowWalkthrough({ ...base, tries: 0 }), true, 'first try');
  assert.equal(shouldShowWalkthrough({ ...base, tries: 1 }), true, 'one retry when a phone dropped the first open');
  assert.equal(shouldShowWalkthrough({ ...base, tries: WALK_AUTO_TRIES }), false, 'never more, even if the mark could not be stored');
  assert.equal(shouldShowWalkthrough({ ...base, seen: true, tries: 0 }), false, 'seen by this person: not on a later start');
});
