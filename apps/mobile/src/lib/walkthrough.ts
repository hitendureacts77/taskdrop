/**
 * "How TaskDrop works": the one walkthrough (plan task 1.19 row N, design in
 * docs/design/walkthrough/DESIGN.html). A first card with the explainer video,
 * five real app screens per side, and a last card. It replaces the drawn
 * welcome story, the hands-on tour and the "quick look" pictures.
 *
 * No React and no react-native imports, so `node --test` can run the tests:
 *
 *   node --experimental-strip-types --test apps/mobile/src/lib/walkthrough.test.ts
 */

export type WalkSide = 'hire' | 'earn';

/**
 * One of the five real screens. `shot` names a picture in assets/walkthrough. `purpose` is one short plain line on
 * what the feature is FOR (owner, 28 Nov: "this map feature is for easily identifying the tasks around us").
 */
export type WalkStep = { shot: string; title: string; purpose: string; body: string };

/**
 * The explainer video on YouTube. Empty until the owner uploads it to the
 * TaskDrop channel: while it is empty the "Watch the video" buttons are hidden.
 * SLOT: paste the YouTube link here (https://youtu.be/... or https://www.youtube.com/watch?v=...).
 */
export const WALKTHROUGH_VIDEO_URL = '';
/** Said on the button, so people know what they are opening. */
export const WALKTHROUGH_VIDEO_LABEL = 'Watch the video';
export const WALKTHROUGH_VIDEO_NOTE = 'TaskDrop in Telugu · YouTube';

/** Only a real YouTube address opens; anything else (empty, a typo, another site) hides the button. */
export function videoUrl(raw: string = WALKTHROUGH_VIDEO_URL): string | null {
  const url = raw.trim();
  return /^https:\/\/(www\.)?(youtube\.com\/(watch\?v=|shorts\/)|youtu\.be\/)[\w-]{6,}/.test(url) ? url : null;
}

export const WALK_STEPS: Record<WalkSide, readonly WalkStep[]> = {
  hire: [
    { shot: 'h1', title: 'Say what you need', purpose: 'Ask for any help in your own words.', body: 'Type it, or tap Speak. Say it the way you would tell a friend.' },
    { shot: 'h3', title: 'Offers come to you', purpose: 'Pick the best person at a price you like.', body: 'Compare price, rating and time. Tap Choose this offer on the one you like.' },
    { shot: 'h4', title: 'Your money is held safely', purpose: 'Your money stays safe until the work is done.', body: 'You pay when you choose. It stays held until you approve the work.' },
    { shot: 'h5', title: 'Approve, and they are paid', purpose: 'Pay only for work you are happy with.', body: 'Check the work, then tap Approve. Not right? Ask for changes or report a problem.' },
    // The map is the last screen on both sides (owner, 28 Nov): second, it broke the story of posting a request.
    { shot: 'h2', title: 'See who is near you', purpose: 'See helpers and services around you at a glance.', body: 'Helpers around you show on the map. You can also get help online, from anywhere.' },
  ],
  earn: [
    { shot: 'e1', title: 'Find work near you or online', purpose: 'Browse open jobs near you, or work online.', body: 'Every open job nearby and remote, with the price shown.' },
    { shot: 'e2', title: 'Send your price', purpose: 'You decide what your work is worth.', body: 'Accept the posted price or send your own. Ask a question first if you need to.' },
    { shot: 'e3', title: 'The money is held before you start', purpose: 'Start work knowing the money is already there.', body: 'The customer paid when they chose you. You see exactly what you earn.' },
    { shot: 'e4', title: 'Finish and send proof', purpose: 'Show the customer the work is done.', body: 'Say what you did, add photos, then tap Mark work done.' },
    { shot: 'e5', title: 'Get paid to your bank or UPI', purpose: 'Your earnings reach you safely.', body: 'Add your bank or UPI once. Your share is paid out when the customer approves.' },
    { shot: 'e6', title: 'See work on the map', purpose: 'Spot the tasks around you at a glance.', body: 'Open jobs near you show on the map with their price. Tap one to see the task.' },
  ],
};

export const WALK_COPY = {
  header: 'How TaskDrop works',
  skip: 'Skip',
  next: 'Next',
  back: 'Back',
  finish: 'Done',
  showApp: 'Show me the app',
  introHire: 'Ask for anything. Someone gets it done for you.',
  introEarn: 'Do tasks near you or online, and get paid.',
  doneTitle: 'You’re set',
  doneHire: 'Post your first request. See this again any time in Profile.',
  doneEarn: 'Find your first job. See this again any time in Profile.',
  goHire: 'Post a request',
  goEarn: 'Find work',
  videoAgain: 'Watch the video again',
  menuLabel: 'How TaskDrop works',
  menuSub: 'Real app screens, about 30 seconds',
  backHome: 'Back to Home',
  backSignIn: 'Back to sign in',
  close: 'Close',
  wantHire: 'I want to hire',
  wantEarn: 'I want to earn',
  hintAuto: 'Plays by itself',
  hintSwipe: 'Tap or swipe for the next step',
  pause: 'Pause',
  play: 'Play',
  prev: 'Previous step',
  nextStep: 'Next step',
} as const;

/** Each screen plays this long, then the next one starts by itself. */
export const WALK_AUTOPLAY_MS = 5000;
/** How many screens one side has (Hire 5, Earn 6: the sides may differ). */
export function walkCount(side: WalkSide): number {
  return WALK_STEPS[side].length;
}
/** The last screen's index on one side, counting from 0 (the card model below counts 1..n plus an intro and a last card). */
export function walkStepLast(side: WalkSide): number {
  return walkCount(side) - 1;
}

/** Move to another screen on that side, never past either end (the last screen stops, no loop). */
export function walkStepClamp(i: number, d: number, side: WalkSide): number {
  const at = Math.round(i) + Math.round(d);
  return Math.max(0, Math.min(walkStepLast(side), at));
}

/** Left or right swipe from the sideways distance, ignoring small drags. Swipe left (dx < 0) is next. */
export function swipeDirection(dx: number, threshold = 40): 'next' | 'prev' | null {
  if (dx <= -threshold) return 'next';
  if (dx >= threshold) return 'prev';
  return null;
}

/** Tap on the right half goes forward, on the left half goes back. */
export function tapHalf(x: number, width: number): 'next' | 'prev' {
  return width > 0 && x < width / 2 ? 'prev' : 'next';
}

/** Cards in order: 0 is the first card, 1..n the screens, n + 1 the last card. */
export function walkLast(side: WalkSide): number {
  return walkCount(side) + 1;
}
export type WalkCard = { kind: 'intro' } | { kind: 'step'; n: number; step: WalkStep } | { kind: 'done' };

export function walkCard(side: WalkSide, i: number): WalkCard {
  const last = walkLast(side);
  const at = Math.max(0, Math.min(last, Math.round(i)));
  if (at === 0) return { kind: 'intro' };
  if (at === last) return { kind: 'done' };
  return { kind: 'step', n: at, step: WALK_STEPS[side][at - 1] };
}

/** "Step 2 of 6: Send your price", read out by screen readers when a card changes. */
export function walkAnnouncement(side: WalkSide, i: number): string {
  const c = walkCard(side, i);
  if (c.kind === 'intro') return `${WALK_COPY.header}. ${side === 'hire' ? WALK_COPY.introHire : WALK_COPY.introEarn}`;
  if (c.kind === 'done') return WALK_COPY.doneTitle;
  return `Step ${c.n} of ${walkCount(side)}: ${c.step.title}`;
}

/** The side the walkthrough opens on: what the caller asked for, else the mode the person is in. */
export function walkSideFor(param: unknown, mode: 'poster' | 'worker' | null | undefined): WalkSide {
  if (param === 'earn' || param === 'hire') return param;
  return mode === 'worker' ? 'earn' : 'hire';
}

/**
 * Whether the staging tester card can still be in front of the walkthrough. It shows only on staging and only to a
 * signed-in person (lib/environment.ts shouldShowStagingCard), so a guest never has one to wait for. Waiting on a card
 * that is never shown left a new guest without the walkthrough for good (27 Nov).
 */
export function stagingCardCanBlock(a: { stagingUi: boolean; signedIn: boolean }): boolean {
  return a.stagingUi && a.signedIn;
}

/**
 * True when no tester card is in front of the walkthrough: there is none to show (production, a guest, signed out), or
 * this device has closed it. `storedSeen` is what the device remembers (null until it has been read). Worked out at
 * render time from the current sign-in, so the moment someone signs in on staging the answer is "not clear" until
 * the stored answer says the card was closed; it never carries an old "clear" across the sign-in.
 */
export function stagingCardIsClear(a: { stagingUi: boolean; signedIn: boolean; storedSeen: boolean | null }): boolean {
  return !stagingCardCanBlock(a) || a.storedSeen === true;
}

/**
 * When the walkthrough opens by itself (owner, 27 + 28 Nov): never on the sign-in page; on Home, once for each person
 * on each device: the first start as a guest, a brand-new account's first sign-in, and an account's first sign-in on
 * this device. `entered` is true for a signed-in person and for a device that chose "Continue as guest"; a signed-out
 * visitor who has not chosen yet is not "entered", so the sign-in page never shows it. `seen` is what the device
 * remembers for this person (walkSeenKey), null until it has been read.
 */
export function shouldShowWalkthrough(a: {
  entered: boolean;
  seen: boolean | null;
  screen: string;
  stagingCardClear: boolean;
  /** How many times it has already opened by itself for this person in this app run. */
  tries?: number;
}): boolean {
  return a.entered && a.seen === false && a.screen === 'home' && a.stagingCardClear && (a.tries ?? 0) < WALK_AUTO_TRIES;
}

/**
 * Opens by itself at most this often per person per app run. The second try covers an open the phone navigator
 * dropped; the cap means a device that cannot store the "seen" mark never sees it again and again.
 */
export const WALK_AUTO_TRIES = 2;

/**
 * Where a device remembers that one person has seen the walkthrough: one key per account, one for the guest. A new
 * account, or another account on the same phone, gets its own first time (owner, 28 Nov). `v2` on purpose: the v1
 * flag was one per device and was also set by the old pre-sign-in intro and by a replay from Profile, so on a phone
 * that had run an older build it was already "seen" and the walkthrough never opened again. Null when nobody is in.
 */
export function walkSeenKey(a: { userId: string | null | undefined; guest: boolean }): string | null {
  if (a.userId) return `taskdrop.walk.seen.v2.${a.userId}`;
  if (a.guest) return 'taskdrop.walk.seen.v2.guest';
  return null;
}
