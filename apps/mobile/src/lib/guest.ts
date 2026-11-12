import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';
import { handoffFresh } from './guestHandoff';

/**
 * Guest mode (design D15): use the whole app first, make the account only at the last step.
 *
 * A guest has no session. The server answers a short list of public reads for them
 * (supabase/functions/api/guest.ts, GUEST_OPS) and refuses everything else with
 * NEEDS_ACCOUNT. Here: whether this device chose "Continue as guest", the one
 * "Make your account" pop-up, and the action to finish once the account exists.
 */

/**
 * The reads a guest may make. Must match GUEST_OPS on the server; api.test.ts checks
 * that the two lists are the same.
 */
export const GUEST_OPS: ReadonlySet<string> = new Set([
  'trendingCategories', 'platformHighlights', 'topEarners', 'platformFees', 'publicProfileStats', 'adAuctionRanks',
  'listOpenTasks', 'searchTasks', 'searchTasksWithPosters', 'attachPosters', 'getTask', 'getTaskDetail',
  'countBidsByTask', 'getPosterStats', 'recommendedTasks', 'remoteTasks', 'tasksNear', 'urgentTasks',
  'workerServices', 'workersNear', 'listActiveWorkers', 'getProfile', 'listReviewsAbout', 'signMedia',
  'listTaskQuestions', 'listFeedbackBoard', 'getFeedbackPost', 'nearbyPulse', 'workerProofPhotos',
]);

export const isGuestOp = (op: string) => GUEST_OPS.has(op);

/**
 * Writes a guest might start by hand: each opens the "Make your account" pop-up. Together with
 * QUIET_WRITES this is every write the server has (api.test.ts checks).
 */
export const ACCOUNT_WRITES: ReadonlySet<string> = new Set([
  'activatePromotion', 'addPayoutDestination', 'answerTaskQuestion', 'applyReferralCode', 'askTaskQuestion', 'attachMedia',
  'blockUser', 'cancelPromotion', 'cancelTask', 'cancelWithdrawal', 'commentFeedbackIdea', 'confirmRelease', 'createTask',
  'createUpload', 'deleteMyAccount', 'endMySessions', 'lockBid', 'markWorkDone', 'openDispute', 'openTicket',
  'payTaskFromWallet', 'placeBid', 'postFeedbackIdea', 'removeListing', 'removeMedia', 'removePayoutDestination',
  'replyTicket', 'reportContent', 'requestRevision', 'requestWithdrawal', 'resolveTicket', 'sendCrewMessage', 'sendFeedback',
  'sendMessage', 'setDefaultPayoutDestination', 'setRepeat', 'setSaved', 'setWeeklyGoal', 'startPromotion', 'startTask',
  'submitProof', 'submitReview', 'unblockUser', 'updateBid', 'updateListing', 'updateProfile', 'updateProfileExtras',
  'voteFeedbackIdea', 'huntLook', 'huntSendFind', 'huntAcceptFind', 'huntDeclineFind', 'huntAskPart', 'setMapSharing', 'setMapAudience', 'clearMapSpot',
]);

/** Writes the app makes on its own (presence, ad counters, devices): signed out they simply do not happen. */
export const QUIET_WRITES: ReadonlySet<string> = new Set([
  'markNotificationsRead', 'recordAdClick', 'recordAdImpression', 'recordBirthDate', 'recordDevice', 'registerPushToken', 'forgetPushToken',
  'settleClearedEarnings', 'touchPresence',
]);

// ------------------------------------------------------------- the choice --

const CHOICE_KEY = 'taskdrop.guest.v1';

/** Whether this device chose "Continue as guest" before (decision 19: then it opens on Home). */
export async function loadGuestChoice(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(CHOICE_KEY)) === '1';
  } catch {
    return false;
  }
}

export async function saveGuestChoice(on: boolean): Promise<void> {
  try {
    if (on) await AsyncStorage.setItem(CHOICE_KEY, '1');
    else await AsyncStorage.removeItem(CHOICE_KEY);
  } catch {
    // Not remembered: the sign-in page shows next time, which is only a tap more.
  }
}

// -------------------------------------------------------------- the pop-up --

/** Why the pop-up opened: it picks the headline. */
export type AccountReason = 'post' | 'publish' | 'offer' | 'hire' | 'chat' | 'money' | 'profile' | 'save' | 'general';

/** The pop-up's headline and line for each reason (design D15, "The last tap"). */
export const ACCOUNT_COPY: Record<AccountReason, { title: string; body: string }> = {
  post: { title: 'Your request is ready. One step left.', body: 'Make your account to post it. Takes a minute: your number, date of birth and a code.' },
  publish: { title: 'Your service is ready. One step left.', body: 'Make your account to publish it. Takes a minute: your number, date of birth and a code.' },
  offer: { title: 'Your offer is ready. One step left.', body: 'Make your account to send it. Takes a minute: your number, date of birth and a code.' },
  hire: { title: 'Make your account to hire.', body: 'Your money is held safely until you approve the work.' },
  chat: { title: 'Make your account to chat.', body: 'Messages and alerts need an account, so people know who they are talking to.' },
  money: { title: 'Money needs an account.', body: 'Add money and withdraw once your account is made.' },
  profile: { title: 'Make your account to set up your profile.', body: 'Your name, photo and skills go on your account.' },
  save: { title: 'Make your account first.', body: 'This needs an account.' },
  general: { title: 'Make your account first.', body: 'You can look around as much as you like. This step needs an account.' },
};

/**
 * `held` is true from the moment the pop-up opens until the guest says "Not now" or comes back
 * from the sign-in pages it opened. A sheet the guest was filling in (an offer, an idea, a report)
 * steps aside while it is true: on web a sheet that is already open would sit on top of the pop-up,
 * and on any platform it would cover the sign-in page.
 */
type PromptState = { open: boolean; reason: AccountReason; held: boolean };

let state: PromptState = { open: false, reason: 'general', held: false };
/** What to do once the account exists: the action the guest was finishing. Kept outside React on purpose. */
let pending: (() => void | Promise<void>) | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/**
 * Open the "Make your account" pop-up. `then` runs once the account exists and the
 * guest is back where they were (the post posts, the offer is sent).
 */
export function needAccount(reason: AccountReason = 'general', then?: () => void | Promise<void>): void {
  pending = then ?? null;
  state = { open: true, reason, held: true };
  emit();
}

/** The guest is back from the sign-in pages (or never went): sheets that stepped aside come back. */
export function releaseAccountHold(): void {
  if (!state.held) return;
  state = { ...state, held: false };
  emit();
}

/** When the guest last said "Not now" (in the pop-up or on the sign-in page opened from it). */
let declinedAt = 0;

/** "Not now" on the sign-in page opened from the pop-up: nothing is kept, and the page below does not ask again at once. */
export function declineAccount(): void {
  pending = null;
  declinedAt = Date.now();
  releaseAccountHold();
}

/**
 * For a page that opens the pop-up as soon as a guest arrives (Messages, Notifications): not when the
 * guest has just said "Not now", which would bring the same question straight back.
 */
export function needAccountOnArrival(reason: AccountReason): void {
  if (Date.now() - declinedAt < 5_000) return;
  needAccount(reason);
}

/** "Not now": the pop-up closes and nothing is kept. */
export function closeAccountPrompt(keepPending = false): void {
  if (!keepPending) {
    pending = null;
    declinedAt = Date.now();
  }
  const held = keepPending && state.held;
  if (!state.open && state.held === held) return;
  state = { ...state, open: false, held };
  emit();
}

/** For a sheet the guest may be filling in: true while it should step aside for the pop-up. */
export function useAccountHold(): boolean {
  return useAccountPrompt().held;
}

export function useAccountPrompt(): PromptState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

/**
 * Sign-in or sign-up from the pop-up has finished and the guest is back on the screen they left.
 * Runs the action they were finishing, once.
 */
export function runPendingAfterSignIn(): void {
  const then = pending;
  pending = null;
  releaseAccountHold();
  if (!then) return;
  // After the screens above have gone, so the action's own navigation lands on top.
  setTimeout(() => {
    void Promise.resolve()
      .then(then)
      .catch(() => {});
  }, 50);
}

/** A guest is part-way through something (an offer, a post) that runs once the account exists. */
export function hasPendingAccountAction(): boolean {
  return pending !== null;
}

/** Whether the sign-in screen was opened from the pop-up (so it goes back, not to Home). */
export const FROM_GUEST = 'fromGuest';

// ------------------------------------------------------------ the hand-off --

const HANDOFF_KEY = 'taskdrop.guest.handoff.v1';
let handoffLive = false;

/**
 * The sign-in page opened from the pop-up (FROM_GUEST) is showing: a sign-in now is the guest's own, so their
 * drafts, saves and half-made post may move into the account (lib/guestHandoff.ts). Only in memory: that covers the
 * in-app code and native Google. Nothing is written to the device here, so a mark cannot outlive an app kill and
 * let an ordinary later sign-in take the guest's things (B31); see saveGuestHandoffMark for the web redirect.
 */
export function markGuestHandoff(): void {
  handoffLive = true;
}

/**
 * Right before the web Google redirect starts (the page reloads on the way back, so memory is lost): keep the mark on
 * the device too, for a few minutes. Does nothing unless the pop-up's sign-in page is the one starting it.
 */
export async function saveGuestHandoffMark(): Promise<void> {
  if (!handoffLive) return;
  try {
    await AsyncStorage.setItem(HANDOFF_KEY, String(Date.now()));
  } catch {
    // Not kept: the redirect still works, only the hand-over of the guest's things is lost.
  }
}

/** The redirect did not happen (an error before leaving the page): the device mark goes again. */
export async function dropGuestHandoffMark(): Promise<void> {
  try {
    await AsyncStorage.removeItem(HANDOFF_KEY);
  } catch {
    // Nothing to do.
  }
}

/**
 * On app start: a mark left on the device counts only when this start is the return from Google (the URL carries an
 * OAuth code). Any other start (an app kill, a reload, a new visit) clears it.
 */
export async function clearStaleGuestHandoff(returningFromOAuth: boolean): Promise<void> {
  if (returningFromOAuth) return;
  await dropGuestHandoffMark();
}

/** The pop-up's sign-in page has gone: a later sign-in is not a hand-off. */
export function clearGuestHandoff(): void {
  handoffLive = false;
  void AsyncStorage.removeItem(HANDOFF_KEY).catch(() => {});
}

/** Whether the pop-up's sign-in page is showing right now. Read at once when a session appears. */
export const guestHandoffLive = (): boolean => handoffLive;

/** Whether this sign-in is the guest's own (`live` as read when it happened). Used up: the mark is removed. */
export async function takeGuestHandoff(live: boolean): Promise<boolean> {
  let markedAt: string | null = null;
  try {
    markedAt = await AsyncStorage.getItem(HANDOFF_KEY);
    await AsyncStorage.removeItem(HANDOFF_KEY);
  } catch {
    // Unreadable: only the live mark counts.
  }
  handoffLive = false;
  return handoffFresh(live, markedAt);
}

/** Thrown by the data layer when a guest tries something that needs an account. */
export class NeedsAccountError extends Error {
  readonly code = 'NEEDS_ACCOUNT';
  constructor() {
    super('Make your account first.');
  }
}

export const isNeedsAccount = (e: unknown): boolean =>
  e instanceof NeedsAccountError || (typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 'NEEDS_ACCOUNT');

/** The drafts owner id a guest's half-written posts are kept under, until they have an account (lib/drafts.ts). */
export const GUEST_DRAFTS_OWNER = 'guest';
