/**
 * Which TaskDrop this is: the staging copy (fake money, fake data, for
 * testers) or production. The server says so in the public app-config answer
 * (`environment`); this file turns that answer into what the screens show.
 *
 * No React and no react-native imports, so `node --test` can run the tests.
 *
 *   node --experimental-strip-types --test apps/mobile/src/lib/environment.test.ts
 */

export type AppEnvironment = 'staging' | 'production';

/**
 * Anything that is not exactly "production" counts as staging: the field is
 * missing until the backend is deployed, and an unknown value must not hide
 * the warning. Only a clear "production" turns the staging screens off.
 */
export function parseEnvironment(raw: unknown): AppEnvironment {
  return raw === 'production' ? 'production' : 'staging';
}

/** The ribbon, the tester card and the legal notice show in staging and nowhere else. */
export function showStagingUi(environment: AppEnvironment): boolean {
  return environment !== 'production';
}

/** Sign-in, welcome and the public pages: the tester card waits until someone is past these. */
const NO_CARD_SCREENS = ['splash', 'welcome', 'signup', 'setup', 'terms', 'privacy', 'support', 'copyright'];

/**
 * Whether to open "How staging works" now. Only in staging, only when signed in
 * and on a main screen, and only if this device has not seen it (`seen` is null
 * while the device's answer is still being read, which shows nothing).
 */
export function shouldShowStagingCard(a: {
  environment: AppEnvironment;
  signedIn: boolean;
  screen: string;
  seen: boolean | null;
}): boolean {
  return showStagingUi(a.environment) && a.signedIn && a.seen === false && !NO_CARD_SCREENS.includes(a.screen);
}

/** Where testers send problems. */
export const STAGING_REPORT_EMAIL = 'hitendureacts@gmail.com';

/** The ribbon, on every screen. */
export const STAGING_RIBBON = 'Staging: fake money and fake data';

/** "How staging works": shown once after sign-in, on each device. */
export const STAGING_CARD = {
  title: 'How staging works',
  intro:
    'You are using a test copy of TaskDrop. Ask for anything. Someone gets it done for you. A task can be done in person nearby or online from anywhere.',
  points: [
    'The money is fake. Nothing you pay or withdraw reaches a real bank, card or UPI account.',
    'The data is fake too, and it can be erased at any time.',
    'Never type a real address, ID number or bank detail. Make them up.',
  ],
  testHeading: 'Please try the whole journey',
  test: ['Post a task', 'Send an offer', 'Pay', 'Do the work', 'Approve', 'Review', 'Withdraw'],
  reportHeading: 'Found a problem?',
  // The address sits between the two halves and is a link in the card.
  reportBefore: 'Email ',
  reportAfter: ' and say what you tapped and what you expected.',
  button: 'Got it',
} as const;

/** Where the tester card is remembered on a device. */
export const STAGING_CARD_SEEN_KEY = 'taskdrop.stagingCardSeen';
