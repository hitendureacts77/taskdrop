/**
 * The app tour (Phase 8): the list of steps, every word on them, and the rules
 * for when it is offered. Design v2, docs/design/tour/TOUR_DESIGN_V2.html.
 *
 * No React and no react-native imports, so `node --test` can run the tests:
 *
 *   node --experimental-strip-types --test apps/mobile/src/lib/tour.test.ts
 *
 * The tour is hands-on: each step lights one thing and waits for a tap on it.
 * The practice task (post, offers, money held, approve, paid) is drawn by the
 * tour itself; nothing is sent to the server and no money moves. The one real
 * change is the Hire/Earn switch, which the tour puts back at the end.
 */

/** Which side the tour walks through. "Both" starts with hiring. */
export type TourPath = 'hire' | 'earn';
export type TourSide = 'poster' | 'worker';

/** The things the tour can light up. Each is registered by the real control (or the practice view). */
export type TourTarget =
  | 'modeSwitch'
  | 'fab'
  | 'headerTools'
  | 'postPlace'
  | 'postButton'
  | 'offerPick'
  | 'chooseButton'
  | 'vaultAction'
  | 'vaultMoney'
  | 'jobPick'
  | 'sendOffer'
  | 'alert'
  | 'threadAddress'
  | 'payee';

/** What the person sees behind the coach card. "real" is the app itself. */
export type TourView =
  | 'real'
  | 'post'
  | 'offers'
  | 'vault'
  | 'jobs'
  | 'job'
  | 'alert'
  | 'thread'
  | 'tabs'
  | 'done';

export type TourBeat = {
  id: string;
  /** 1 to 5; 0 is the start sheet and the closing card. */
  stop: 0 | 1 | 2 | 3 | 4 | 5;
  view: TourView;
  title: string;
  /** Plain text; `{fee}`, `{review}` and `{clear}` are filled in from packages/rules. */
  body: string;
  /** The lit-up control. Beats with no target wait for the "Next" button. */
  target?: TourTarget;
  /** What the person is asked to do, for a tap beat ("Tap Earn"). */
  cta?: string;
  /** The button label for a beat with no target. */
  next?: string;
  /** A tap on the target flips the real Hire/Earn switch to this side. */
  setSide?: TourSide;
  /** Practice state this beat's tap leaves behind, for the drawn views. */
  then?: 'placeChosen' | 'offerPicked' | 'moneyHeld' | 'paid' | 'jobSent' | 'picked';
};

/** The numbers the words quote. Read from packages/rules by the screen, never typed here. */
export type TourNumbers = { feePct: number; reviewDays: number; clearDays: number };

export const TOUR_SEEN_KEY = 'taskdrop.tourSeen';
export const TOUR_STEPS = 5;

/** The onboarding answer (`intent` on the profile) decides which side the tour shows. */
export function tourPathFor(intent: unknown): TourPath {
  return intent === 'earn' ? 'earn' : 'hire';
}

/** "Both" gets a link to the earning side on the last card. */
export function offersEarningSide(intent: unknown): boolean {
  return intent === 'both';
}

const other = (p: TourPath): TourPath => (p === 'hire' ? 'earn' : 'hire');
const sideOf = (p: TourPath): TourSide => (p === 'hire' ? 'poster' : 'worker');
const word = (p: TourPath) => (p === 'hire' ? 'Hire' : 'Earn');

/** The five bottom tabs for each side, as the app names them (Explore is Find work, My Tasks is My Work, on Earn). */
export function tourTabNames(path: TourPath): readonly string[] {
  return path === 'earn'
    ? ['Home', 'Find work', 'My Work', 'Wallet', 'Profile']
    : ['Home', 'Explore', 'My Tasks', 'Wallet', 'Profile'];
}

const hireStops = (): TourBeat[] => [
  {
    id: 'post-drop', stop: 2, view: 'real', target: 'fab', cta: 'Tap the drop',
    title: 'Ask for anything',
    body: 'Describe what you need in plain words. Someone gets it done for you.',
  },
  {
    id: 'post-place', stop: 2, view: 'post', target: 'postPlace', cta: 'Pick one', then: 'placeChosen',
    title: 'Near you, or online',
    body: 'Pick “At a place” for help nearby, or “Remote / online” for work done from anywhere.',
  },
  {
    id: 'post-send', stop: 2, view: 'post', target: 'postButton', cta: 'Tap Post',
    title: 'Your address stays private',
    body: 'Workers see only your area name. The exact address unlocks when the work starts.',
  },
  {
    id: 'offers-pick', stop: 3, view: 'offers', target: 'offerPick', cta: 'Tap an offer', then: 'offerPicked',
    title: 'Offers come to you',
    body: 'Compare the price and who’s active now, then pick the one you like.',
  },
  {
    id: 'money-held', stop: 4, view: 'offers', target: 'chooseButton', cta: 'Tap Choose offer', then: 'moneyHeld',
    title: 'Your money is held safely',
    body: 'You pay the offer plus a {fee}% service fee. TaskDrop holds it until you approve the work.',
  },
  {
    id: 'approve', stop: 4, view: 'vault', target: 'vaultAction', cta: 'Tap Approve', then: 'paid',
    title: 'Ravi says the work is done',
    body: 'Happy with it? Approve to pay him. You have {review} days to approve or report a problem.',
  },
  {
    id: 'paid', stop: 4, view: 'vault', target: 'payee', next: 'Next',
    title: 'Paid',
    body: 'Ravi is paid. Nothing here was real: no task was posted and no money moved.',
  },
];

const earnStops = (): TourBeat[] => [
  {
    id: 'job-pick', stop: 2, view: 'jobs', target: 'jobPick', cta: 'Tap a job', then: 'jobSent',
    title: 'Find work near you or online',
    body: 'Jobs from your area, plus remote work you can do from your phone or laptop.',
  },
  {
    id: 'job-send', stop: 2, view: 'job', target: 'sendOffer', cta: 'Tap Send offer',
    title: 'Name your price',
    body: 'Offer the customer’s budget, or change the amount first.',
  },
  {
    id: 'picked', stop: 3, view: 'alert', target: 'alert', cta: 'Tap the alert', then: 'picked',
    title: 'The customer picks you',
    body: 'You get an alert the moment it happens.',
  },
  {
    id: 'chat', stop: 3, view: 'thread', target: 'threadAddress', next: 'Next',
    title: 'Now you can chat',
    body: 'Until the work starts, you see only the area name. The exact address unlocks then.',
  },
  {
    id: 'held-already', stop: 4, view: 'vault', target: 'vaultMoney', next: 'Next', then: 'moneyHeld',
    title: 'The money is already held',
    body: 'Priya paid when she chose you, so you know it’s there before you start.',
  },
  {
    id: 'mark-done', stop: 4, view: 'vault', target: 'vaultAction', cta: 'Tap Mark as done', then: 'paid',
    title: 'Finished the job?',
    body: 'Tell Priya it’s done. She approves it, or it is approved for you after {review} days.',
  },
  {
    id: 'paid-wallet', stop: 4, view: 'vault', target: 'payee', next: 'Next',
    title: 'Paid to your wallet',
    body: 'Earnings clear after {clear} days, then withdraw to UPI or bank. Fees are in How fees work.',
  },
];

/** The whole tour for one side, in order. */
export function tourBeats(path: TourPath): TourBeat[] {
  const first = other(path);
  return [
    {
      id: 'sides-first', stop: 1, view: 'real', target: 'modeSwitch', cta: `Tap ${word(first)}`, setSide: sideOf(first),
      title: 'One account, two sides',
      body: 'Hire when you need something done. Earn when you want to do the work.',
    },
    {
      id: 'sides-back', stop: 1, view: 'real', target: 'modeSwitch', cta: `Tap ${word(path)} to switch back`, setSide: sideOf(path),
      title: first === 'earn' ? 'Now you’re earning' : 'Now you’re hiring',
      body:
        first === 'earn'
          ? 'The colour turns blue and the tabs rename themselves: My Tasks is now My Work.'
          : 'The colour turns jade and the tabs rename themselves: My Work is now My Tasks.',
    },
    ...(path === 'hire' ? hireStops() : earnStops()),
    {
      id: 'around', stop: 5, view: 'real', target: 'headerTools', next: 'Next',
      title: 'Everything else, one tap away',
      body: 'The bell shows what’s new. The chat icon opens your messages. Your photo opens settings, Help & support, and this tour again.',
    },
    {
      id: 'tabs', stop: 5, view: 'tabs', next: 'Got it',
      title: 'Five tabs at the bottom',
      body:
        path === 'earn'
          ? 'Home for what’s new, Find work for open jobs, My Work to track your jobs, Wallet for your earnings, Profile for you.'
          : 'Home for what’s new, Explore for ideas, My Tasks to track your jobs, Wallet for your money, Profile for you.',
    },
  ];
}

/**
 * What the person is asked to tap. Wide screens (desktop and tablet) have no
 * drop button, so the first practice step lights "Post a request" in the side menu.
 */
export function tourCta(beat: TourBeat, wide: boolean): string | undefined {
  return beat.id === 'post-drop' && wide ? 'Tap Post a request' : beat.cta;
}

/** Fills the quoted numbers into a beat's words. */
export function tourText(body: string, n: TourNumbers): string {
  return body
    .replace('{fee}', String(Math.round(n.feePct * 100)))
    .replace('{review}', String(n.reviewDays))
    .replace('{clear}', String(n.clearDays));
}

/** The words on the start sheet and the closing card. */
export const TOUR_COPY = {
  offerTitle: 'Take a 1-minute tour?',
  offerBody: 'Try TaskDrop with a pretend task. Nothing is posted and no money moves.',
  start: 'Start the tour',
  skip: 'Skip',
  later: 'Not now',
  doneTitle: 'You’re set!',
  doneBody: 'You can take this tour again any time: tap your photo, then “Take the app tour”.',
  doneHire: 'Post a request',
  doneEarn: 'Find work',
  seeEarning: 'See the earning side (30 s)',
  practice: 'PRACTICE',
  example: 'EXAMPLE',
  menuLabel: 'Take the app tour',
  menuSub: 'One minute, with a pretend task',
} as const;

/** "Step 2 of 5: Ask for anything", read out by screen readers. */
export function tourAnnouncement(beat: TourBeat): string {
  return `Tour step ${beat.stop} of ${TOUR_STEPS}: ${beat.title}`;
}

/** Sign-in, welcome and the public pages: the tour waits until someone is past these, on Home. */
export function shouldOfferTour(a: {
  pending: boolean;
  signedIn: boolean;
  screen: string;
  seen: boolean | null;
  /** The staging card ("How staging works") has been closed, or this is not staging. */
  stagingCardClear: boolean;
}): boolean {
  return a.pending && a.signedIn && a.seen === false && a.screen === 'home' && a.stagingCardClear;
}

/** Index of the next beat after `i`, or -1 when `i` was the last. */
export function nextBeat(beats: readonly TourBeat[], i: number): number {
  return i + 1 < beats.length ? i + 1 : -1;
}
