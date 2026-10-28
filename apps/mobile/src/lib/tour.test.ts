import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  nextBeat,
  offersEarningSide,
  shouldOfferTour,
  TOUR_COPY,
  TOUR_STEPS,
  tourAnnouncement,
  tourBeats,
  tourCta,
  tourPathFor,
  tourTabNames,
  tourText,
  type TourBeat,
  type TourPath,
} from './tour.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = (p: string) => readFileSync(join(here, '..', p), 'utf8');
const PATHS: TourPath[] = ['hire', 'earn'];
const NUMBERS = { feePct: 0.03, reviewDays: 3, clearDays: 7 };

test('the onboarding answer picks the side; "both" starts with hiring and offers the earning side', () => {
  assert.equal(tourPathFor('post'), 'hire');
  assert.equal(tourPathFor('earn'), 'earn');
  assert.equal(tourPathFor('both'), 'hire');
  assert.equal(tourPathFor(undefined), 'hire');
  assert.equal(offersEarningSide('both'), true);
  assert.equal(offersEarningSide('post'), false);
  assert.equal(offersEarningSide('earn'), false);
});

test('each side has exactly five numbered stops, in order, with the loop post -> paid on Hire', () => {
  for (const p of PATHS) {
    const beats = tourBeats(p);
    const stops = beats.map((b) => b.stop);
    assert.deepEqual([...new Set(stops)], [1, 2, 3, 4, 5], `${p} stops`);
    assert.deepEqual(stops, [...stops].sort(), `${p} stops are in order`);
    assert.equal(new Set(beats.map((b) => b.id)).size, beats.length, `${p} ids are unique`);
    assert.equal(Math.max(...stops), TOUR_STEPS);
  }
  const hire = tourBeats('hire').map((b) => b.id);
  assert.ok(hire.indexOf('post-send') < hire.indexOf('offers-pick'));
  assert.ok(hire.indexOf('money-held') < hire.indexOf('approve'));
});

test('every beat asks for a tap on a target or offers a Next button, never both and never neither', () => {
  for (const p of PATHS) {
    for (const b of tourBeats(p)) {
      if (b.cta) assert.ok(b.target, `${b.id} has a cta but nothing is lit up`);
      assert.ok(Boolean(b.cta) !== Boolean(b.next), `${b.id} needs exactly one of cta or next`);
      assert.ok(b.title.length > 0 && b.body.length > 0);
    }
  }
});

test('the switch is flipped to the other side and then put back', () => {
  for (const p of PATHS) {
    const [first, back] = tourBeats(p);
    const own = p === 'hire' ? 'poster' : 'worker';
    const flipped = p === 'hire' ? 'worker' : 'poster';
    assert.equal(first.setSide, flipped);
    assert.equal(back.setSide, own);
    assert.equal(back.target, 'modeSwitch');
  }
});

test('the quoted numbers come from the caller, never from the words', () => {
  const all = PATHS.flatMap((p) => tourBeats(p));
  for (const b of all) assert.doesNotMatch(b.body, /\b3%|\b3 days|\b7 days/, `${b.id} types a number`);
  const held = all.find((b) => b.id === 'money-held') as TourBeat;
  assert.match(tourText(held.body, NUMBERS), /plus a 3% service fee/);
  assert.match(tourText(held.body, { ...NUMBERS, feePct: 0.05 }), /plus a 5% service fee/);
  const approve = all.find((b) => b.id === 'approve') as TourBeat;
  assert.match(tourText(approve.body, { ...NUMBERS, reviewDays: 5 }), /5 days/);
  const wallet = all.find((b) => b.id === 'paid-wallet') as TourBeat;
  assert.match(tourText(wallet.body, NUMBERS), /7 days/);
  for (const b of all) assert.doesNotMatch(tourText(b.body, NUMBERS), /\{/, `${b.id} has an unfilled number`);
});

test('the worker commission is never quoted (it is set by the admin)', () => {
  for (const b of PATHS.flatMap((p) => tourBeats(p))) assert.doesNotMatch(b.body, /commission|10%/i);
});

test('tab names match what the app calls them', () => {
  assert.deepEqual(tourTabNames('hire'), ['Home', 'Explore', 'My Tasks', 'Wallet', 'Profile']);
  assert.deepEqual(tourTabNames('earn'), ['Home', 'Find work', 'My Work', 'Wallet', 'Profile']);
  const tabs = src('app/(tabs)/_layout.tsx') + src('components/BottomTabBar.tsx') + src('navigation/nativeTabs.ts');
  for (const name of new Set([...tourTabNames('hire'), ...tourTabNames('earn')])) {
    assert.ok(tabs.includes(name), `the app no longer has a tab called "${name}"; update the tour`);
  }
});

test('labels the tour points at still exist in the app', () => {
  const header = src('components/AppHeader.tsx');
  assert.ok(header.includes('Help & support'), 'the account menu row the tour mentions');
  assert.ok(header.includes('Notifications') && header.includes('Messages') && header.includes('Account menu'));
  const fab = src('components/CreateFab.tsx');
  assert.ok(fab.includes('Post a request'));
  const modes = src('components/ModeSwitch.tsx');
  assert.ok(modes.includes('Hire') && modes.includes('Earn'));
  const onboarding = src('screens/OnboardingScreen.tsx');
  assert.ok(onboarding.includes('Go to TaskDrop'));
  assert.ok(src('screens/PricingScreen.tsx').length > 0);
});

test('every beat that lights something has its target registered somewhere in the app', () => {
  const registered = ['components/ModeSwitch.tsx', 'components/CreateFab.tsx', 'components/AppHeader.tsx', 'components/tour/TourPractice.tsx']
    .map(src)
    .join('\n');
  for (const p of PATHS) {
    for (const b of tourBeats(p)) {
      if (b.target) assert.ok(registered.includes(`'${b.target}'`), `nothing registers the target '${b.target}' (${b.id})`);
    }
  }
});

test('the tour is offered once, after onboarding, on Home, past the staging card', () => {
  const ok = { pending: true, signedIn: true, screen: 'home', seen: false, stagingCardClear: true };
  assert.equal(shouldOfferTour(ok), true);
  assert.equal(shouldOfferTour({ ...ok, pending: false }), false, 'not asked for');
  assert.equal(shouldOfferTour({ ...ok, signedIn: false }), false);
  assert.equal(shouldOfferTour({ ...ok, screen: 'explore' }), false);
  assert.equal(shouldOfferTour({ ...ok, seen: true }), false, 'this device has seen it');
  assert.equal(shouldOfferTour({ ...ok, seen: null }), false, 'storage not read yet');
  assert.equal(shouldOfferTour({ ...ok, stagingCardClear: false }), false, 'the two never stack');
});

test('wide screens are asked to tap Post a request instead of the drop', () => {
  const drop = tourBeats('hire').find((b) => b.id === 'post-drop') as TourBeat;
  assert.equal(tourCta(drop, false), 'Tap the drop');
  assert.equal(tourCta(drop, true), 'Tap Post a request');
  const other = tourBeats('hire')[0];
  assert.equal(tourCta(other, true), other.cta);
});

test('screen readers hear the step number and title', () => {
  const b = tourBeats('hire')[0];
  assert.equal(tourAnnouncement(b), 'Tour step 1 of 5: One account, two sides');
});

test('nextBeat walks to the end and then reports -1', () => {
  const beats = tourBeats('earn');
  assert.equal(nextBeat(beats, 0), 1);
  assert.equal(nextBeat(beats, beats.length - 1), -1);
});

test('the closing card names both actions', () => {
  assert.equal(TOUR_COPY.doneHire, 'Post a request');
  assert.equal(TOUR_COPY.doneEarn, 'Find work');
});
