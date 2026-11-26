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

/** One of the five real screens. `shot` names a picture in assets/walkthrough. */
export type WalkStep = { shot: string; title: string; body: string };

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
    { shot: 'h1', title: 'Say what you need', body: 'Type it, or tap Speak. Say it the way you would tell a friend.' },
    { shot: 'h2', title: 'See who is near you', body: 'Helpers around you show on the map. You can also get help online, from anywhere.' },
    { shot: 'h3', title: 'Offers come to you', body: 'Compare price, rating and time. Tap Choose this offer on the one you like.' },
    { shot: 'h4', title: 'Your money is held safely', body: 'You pay when you choose. It stays held until you approve the work.' },
    { shot: 'h5', title: 'Approve, and they are paid', body: 'Check the work, then tap Approve. Not right? Ask for changes or report a problem.' },
  ],
  earn: [
    { shot: 'e1', title: 'Find work near you or online', body: 'Every open job nearby and remote, with the price shown.' },
    { shot: 'e2', title: 'Send your price', body: 'Accept the posted price or send your own. Ask a question first if you need to.' },
    { shot: 'e3', title: 'The money is held before you start', body: 'The customer paid when they chose you. You see exactly what you earn.' },
    { shot: 'e4', title: 'Finish and send proof', body: 'Say what you did, add photos, then tap Mark work done.' },
    { shot: 'e5', title: 'Get paid to your bank or UPI', body: 'Add your bank or UPI once. Your share is paid out when the customer approves.' },
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
  menuSub: 'Five real screens, about 30 seconds',
} as const;

/** Cards in order: 0 is the first card, 1..5 the screens, 6 the last card. */
export const WALK_LAST = 6;
export type WalkCard = { kind: 'intro' } | { kind: 'step'; n: number; step: WalkStep } | { kind: 'done' };

export function walkCard(side: WalkSide, i: number): WalkCard {
  const at = Math.max(0, Math.min(WALK_LAST, Math.round(i)));
  if (at === 0) return { kind: 'intro' };
  if (at === WALK_LAST) return { kind: 'done' };
  return { kind: 'step', n: at, step: WALK_STEPS[side][at - 1] };
}

/** "Step 2 of 5: Send your price", read out by screen readers when a card changes. */
export function walkAnnouncement(side: WalkSide, i: number): string {
  const c = walkCard(side, i);
  if (c.kind === 'intro') return `${WALK_COPY.header}. ${side === 'hire' ? WALK_COPY.introHire : WALK_COPY.introEarn}`;
  if (c.kind === 'done') return WALK_COPY.doneTitle;
  return `Step ${c.n} of 5: ${c.step.title}`;
}

/** The side the walkthrough opens on: what the caller asked for, else the mode the person is in. */
export function walkSideFor(param: unknown, mode: 'poster' | 'worker' | null | undefined): WalkSide {
  if (param === 'earn' || param === 'hire') return param;
  return mode === 'worker' ? 'earn' : 'hire';
}

/**
 * When the walkthrough opens by itself (owner, 26 Nov): never before sign-in. Sign-in comes first; once someone is
 * signed in and on Home, it opens once per device, after the staging tester card (if any) is closed. A guest sees it
 * only from the "?" on Home, Profile or the account menu.
 */
export function shouldShowWalkthrough(a: { signedIn: boolean; seen: boolean | null; screen: string; stagingCardClear: boolean }): boolean {
  return a.signedIn && a.seen === false && a.screen === 'home' && a.stagingCardClear;
}
