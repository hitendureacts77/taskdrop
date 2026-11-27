import type { ChatState } from '../lib/chatWindow';
import { ApiError, friendlyMessage, reportError } from '../lib/errors';
import { callApi } from '../lib/gateway';
import { ACCOUNT_WRITES, NeedsAccountError, isGuestOp, needAccount } from '../lib/guest';
import { clientHeaders } from '../lib/appInfo';
import { FUNCTIONS_REGION, currentUserId, supabase } from '../lib/supabase';
import { subscribeLive } from '../lib/live';
import { count, log } from '../lib/monitoring';
import { noteChange, reusePublic, reuseWhileFresh } from '../lib/freshness';
import { isPlanB } from '../lib/moneyFlow';
import { signInRouteFor, type SignInRoute } from '../lib/username';
import type { Database, Tables, Enums } from '@taskdrop/db-types';

/**
 * Every read and write the app performs, by name.
 *
 * Each function here asks the server (supabase/functions/api) to do one named
 * thing and returns what it answers. Which tables, filters, checks and
 * calculations sit behind a name is decided on the server and is not part of
 * this bundle. The types below are compile-time only and do not ship.
 */

export type Task = Tables<'tasks'>;
export type Bid = Tables<'bids'>;
export type Assignment = Tables<'assignments'>;
export type Wallet = Tables<'wallets'>;
export type Profile = Tables<'profiles'>;

const myId = currentUserId;

/** The poster's wallet does not cover a job; `shortMinor` is exactly what is missing. */
export class WalletShortError extends Error {
  constructor(public shortMinor: number) {
    super('Not enough money in your wallet');
  }
}

/**
 * Signed out: a guest may make the public reads (lib/guest.ts). A write opens the
 * "Make your account" pop-up and throws; any other read fails as it always did.
 */
export async function guestGate(op: string, signedOutRead = 'Sign in first'): Promise<void> {
  if (await myId()) return;
  if (isGuestOp(op)) return;
  if (!ACCOUNT_WRITES.has(op)) throw new Error(signedOutRead);
  needAccount();
  throw new NeedsAccountError();
}

/** Ask the server to do something by name. */
async function act<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  await guestGate(op);
  try {
    return await callApi<T>(op, args);
  } catch (e) {
    if (e instanceof ApiError && e.code === 'NEEDS_ACCOUNT') {
      needAccount();
      throw new NeedsAccountError();
    }
    const short = e instanceof ApiError ? Number(e.details) : 0;
    if (e instanceof ApiError && e.message === 'Not enough money in your wallet' && short > 0) {
      throw new WalletShortError(short);
    }
    throw e;
  }
}

/**
 * Smart search hints (chips, suggestions, next steps): never the account pop-up and never an error. A server that
 * does not know the op yet, or refuses it, just means no hints; the search itself still runs.
 */
async function hint<T>(op: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  if (!(await myId()) && !isGuestOp(op)) return fallback;
  try {
    return await callApi<T>(op, args);
  } catch {
    return fallback;
  }
}

/** Same, but signed out simply means "nothing" rather than an error. */
async function ask<T>(op: string, args: Record<string, unknown>, signedOut: T): Promise<T> {
  if (!(await myId()) && !isGuestOp(op)) return signedOut;
  return act<T>(op, args);
}

/** Same, but any failure means "nothing": for counts, badges and other niceties. */
async function quietly<T>(op: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return await ask<T>(op, args, fallback);
  } catch {
    return fallback;
  }
}

const toMap = <V>(o: Record<string, V> | null | undefined) => new Map(Object.entries(o ?? {}));

// ---------------------------------------------------------------- reads ----

/** What a post is: a poster's request for work, or a worker's listed service. */
export type TaskKind = 'request' | 'service';

/** The kind of post each mode browses. */
export const kindFor = (mode: 'worker' | 'poster'): TaskKind => (mode === 'worker' ? 'request' : 'service');

export const listOpenTasks = (limit = 30, kind: TaskKind = 'request') =>
  act<Task[]>('listOpenTasks', { limit, kind });

export const listMyTasks = (_userId: string, kind: TaskKind = 'request') => act<Task[]>('listMyTasks', { kind });

export const listMyBids = (_userId: string) => act<(Bid & { tasks: Task | null })[]>('listMyBids');

export const listMyAssignments = (_userId: string) =>
  act<(Assignment & { tasks: Task | null })[]>('listMyAssignments');

export const listBidsForTask = (taskId: string) =>
  act<(Bid & { profiles: Profile | null })[]>('listBidsForTask', { taskId });

export async function countBidsByTask(taskIds: string[]): Promise<Map<string, number>> {
  if (taskIds.length === 0) return new Map();
  return toMap(await act<Record<string, number>>('countBidsByTask', { taskIds }));
}

export type TaskSearch = {
  q?: string;
  pillar?: Enums<'pillar'> | null;
  minMinor?: number | null;
  maxMinor?: number | null;
  limit?: number;
  kind?: TaskKind;
  near?: { lat: number; lng: number; radiusKm: number } | null;
  /** Smart search: chip ids the person removed ("Searching for" pills). */
  drop?: string[];
  /** Smart search: keep the spelling as typed (no correction). */
  exact?: boolean;
};

export const searchTasks = (input: TaskSearch = {}) => act<Task[]>('searchTasks', { ...input });

/** A search result row: the post plus why it matched ("Same need: plumber, leak"), when the server says. */
export type TaskWithPoster = Task & { poster: Profile | null; match_why?: string | null };

export type SearchChip = { id: string; label: string };
export type SearchSuggestion = { id: string; label: string; count: number | null };
export type SearchSuggestResult = { corrected: string | null; chips: SearchChip[]; suggestions: SearchSuggestion[] };
export type SearchSuggestInput = {
  q: string;
  kind: 'request' | 'service';
  near?: { lat: number; lng: number; radiusKm: number } | null;
  drop?: string[];
  exact?: boolean;
  /** false skips the counts (fast; use while typing). */
  counts?: boolean;
};

/** What the search understood (chips), a spelling fix, and what the person may mean. */
export const searchSuggest = (input: SearchSuggestInput) =>
  hint<SearchSuggestResult>('searchSuggest', { ...input }, { corrected: null, chips: [], suggestions: [] });

export type SearchFallbacks = {
  wider: { km: number; count: number } | null;
  remote: number;
  related: { labels: string[]; q: string; count: number } | null;
};
export type SearchFallbacksInput = {
  q: string;
  kind: 'request' | 'service';
  near?: { lat: number; lng: number; radiusKm: number } | null;
  drop?: string[];
};

/** For an empty result: a wider area, remote jobs, close matches. */
export const searchFallbacks = (input: SearchFallbacksInput) =>
  hint<SearchFallbacks>('searchFallbacks', { ...input }, { wider: null, remote: 0, related: null });

export async function attachPosters(tasks: Task[]): Promise<TaskWithPoster[]> {
  if (tasks.length === 0) return [];
  return act<TaskWithPoster[]>('attachPosters', { taskIds: tasks.map((t) => t.id) });
}

/**
 * searchTasks with each task's poster attached, in one request instead of two back to back (Explore once
 * waited 13 s on the pair). A server that does not know the operation yet gets the two old calls.
 */
export async function searchTasksWithPosters(input: TaskSearch = {}): Promise<TaskWithPoster[]> {
  try {
    return await act<TaskWithPoster[]>('searchTasksWithPosters', { ...input });
  } catch (e) {
    if (!(e instanceof ApiError) || e.code !== 'UNKNOWN_OP') throw e;
    return attachPosters(await searchTasks(input));
  }
}

export const getTask = (taskId: string) => act<Task | null>('getTask', { taskId });

export type TaskDetail = {
  task: Task;
  /** The typed address (flat, building, landmark). Only the poster and the person hired get it; everyone else gets null. */
  address?: string | null;
  assignment: Assignment | null;
  poster: Profile | null;
  worker: Profile | null;
};

export const getTaskDetail = (taskId: string) => act<TaskDetail | null>('getTaskDetail', { taskId });

export const getWallet = () => ask<Wallet | null>('getWallet', {}, null);

/** Escrow tied up in live jobs. With a side, only that side. */
export const getEscrowHeld = (side?: 'poster' | 'worker') => ask<number>('getEscrowHeld', { side: side ?? null }, 0);

// ----------------------------------------------------- Plan B money -----
// Pay per task, the payment company holds the money (docs/design/plan-b-money/DESIGN.md). Every figure is paise.

export type PayeeStatus = 'pending' | 'active' | 'rejected' | 'suspended';
export type MoneyMode = {
  flow: 'wallet' | 'plan_b';
  provider: 'razorpay_route' | 'simulated';
  paused: boolean;
  payee: { status: PayeeStatus; method: 'upi' | 'bank' | null; hint: string | null; note: string | null } | null;
};
export type TaskHoldStatus =
  | 'awaiting_payment' | 'held' | 'release_asked' | 'released' | 'refund_asked' | 'refunded' | 'split_asked' | 'split' | 'expired';
export type TaskHold = {
  status: TaskHoldStatus;
  stuck: boolean;
  offer_minor: number;
  charged_minor: number;
  fee_minor: number;
  worker_share_minor: number;
  release_minor: number;
  refund_minor: number;
  expires_at: string | null;
  paid_at: string | null;
  settled_at: string | null;
  provider: string;
  mine: 'poster' | 'worker';
};
export type MoneyLedgerRow = {
  kind: 'paid' | 'on_hold' | 'hold_cancelled' | 'released' | 'fine_paid' | 'refunded';
  amount_minor: number;
  created_at: string;
  task_id: string | null;
  task_title: string | null;
};
export type MoneyLedger = {
  totals: { paid_minor: number; refunded_minor: number; released_minor: number };
  on_hold_for_me_minor: number;
  my_money_held_minor: number;
  rows: MoneyLedgerRow[];
};

/** Which money flow is on and the caller's payee state. Null when signed out. */
export const getMoneyMode = () => ask<MoneyMode | null>('getMoneyMode', {}, null);
/** The hold on one task, or null when it has none. */
export const getTaskHold = (taskId: string) => ask<TaskHold | null>('getTaskHold', { taskId }, null);
export const getMoneyLedger = (limit = 100) => ask<MoneyLedger | null>('getMoneyLedger', { limit }, null);

export type Review = Tables<'reviews'> & { author: Profile | null };

export const listReviewsAbout = (userId: string, role: Enums<'app_role'>, limit = 10) =>
  act<Review[]>('listReviewsAbout', { userId, role, limit });

export type PosterStats = { profile: Profile | null; requestsPosted: number };

export const getPosterStats = (posterId: string) => act<PosterStats>('getPosterStats', { posterId });

export type WalletEvent = {
  id: string;
  kind: 'released' | 'escrow' | 'incoming' | 'clearing' | 'payout' | 'topup';
  title: string;
  meta: string;
  amountMinor: number;
  incoming: boolean;
  at: string;
};

export const listWalletActivity = (_userId: string, limit = 12) => act<WalletEvent[]>('listWalletActivity', { limit });

/** The tab bar's badge. Recounted on every screen change, so a count from moments ago with nothing changed since is reused (lib/freshness.ts). */
export const countNeedsAttention = (_userId: string, mode: 'poster' | 'worker') =>
  reuseWhileFresh('countNeedsAttention', mode, () => act<number>('countNeedsAttention', { mode }));

/**
 * Profiles are read by many screens, often for the same person within the same
 * second, so they are kept briefly and concurrent reads share one request.
 */
const PROFILE_TTL_MS = 20_000;
const profileCache = new Map<string, { at: number; p: Promise<Profile | null> }>();

export function getProfile(userId: string, opts: { fresh?: boolean } = {}): Promise<Profile | null> {
  const hit = profileCache.get(userId);
  if (!opts.fresh && hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.p;
  const p = act<Profile | null>('getProfile', { userId });
  profileCache.set(userId, { at: Date.now(), p });
  p.catch(() => profileCache.delete(userId));
  return p;
}

/** Store a profile row the app just wrote, so the next read has it. */
export function primeProfile(row: Profile): void {
  profileCache.set(row.id, { at: Date.now(), p: Promise.resolve(row) });
}

/** Drop a cached profile after a write that did not return the row. */
export function forgetProfile(userId: string): void {
  profileCache.delete(userId);
}

/**
 * Where a freshly-signed-in user should land: setup for a first run, the "Pick a username" page for a finished
 * setup with no username (plan 1.18), home otherwise.
 */
export async function postSignInRoute(userId: string): Promise<SignInRoute> {
  try {
    return signInRouteFor(await getProfile(userId));
  } catch (e) {
    // Reads already retry on a blip (lib/retry.ts). If the profile still cannot be read, a returning
    // person is far more likely than a new one, and putting them through onboarding again risks
    // overwriting what they set up. A brand-new person who lands on Home can finish from Profile.
    reportError(e, 'sign-in-route');
    return 'home';
  }
}

// ------------------------------------------------------------- analytics ---

export type PlatformStats = {
  windowDays: number;
  gmvMinor: number;
  revenueMinor: number;
  escrowHeldMinor: number;
  payoutsPendingMinor: number;
  tasksPosted: number;
  tasksCompleted: number;
  tasksCancelled: number;
  tasksOpen: number;
  tasksLive: number;
  disputesOpen: number;
  quotesPlaced: number;
  quotedRate: number;
  newUsers: number;
  totalUsers: number;
  activeUsers: number;
  avgWorkerRating: number;
  daily: { day: string; posted: number; completed: number; revenue_minor: number }[];
};

export const isAdmin = (_userId: string) => quietly<boolean>('isAdmin', {}, false);

export const platformStats = (days = 30) => act<PlatformStats>('platformStats', { days });

// -------------------------------------------------------------- messages ---

export type Message = {
  id: string;
  task_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

export const chatState = (taskId: string) => act<ChatState>('chatState', { taskId });

export const listMessages = (taskId: string) => act<Message[]>('listMessages', { taskId });

export async function sendMessage(taskId: string, _senderId: string, body: string): Promise<Message> {
  const text = body.trim();
  if (!text) throw new Error('Nothing to send');
  return act<Message>('sendMessage', { taskId, body: text });
}

export async function taskContactPhone(taskId: string): Promise<string | null> {
  return act<string | null>('taskContactPhone', { taskId });
}

/** Chat photos travel as an ordinary message whose body is this marker + a storage path. */
export const CHAT_MEDIA_PREFIX = '::media::';

/**
 * Live updates for a task's thread. On each ping the new messages are fetched
 * from the server. Returns an unsubscribe function; call it on unmount.
 */
export function subscribeToMessages(taskId: string, onInsert: (m: Message) => void): () => void {
  let after = new Date().toISOString();
  let busy: Promise<void> = Promise.resolve();
  return subscribeLive((ping) => {
    if (ping.kind !== 'message' || ping.taskId !== taskId) return;
    // One fetch at a time, so a burst of pings cannot deliver a message twice.
    busy = busy.then(async () => {
      try {
        const fresh = await act<Message[]>('listMessages', { taskId, after });
        for (const m of fresh) {
          if (m.created_at > after) after = m.created_at;
          onInsert(m);
        }
      } catch {
        /* the next ping, or the screen's own refresh, catches up */
      }
    });
  });
}

// --------------------------------------------------------------- writes ----

export type NewTask = {
  posterId: string;
  pillar: Enums<'pillar'>;
  title: string;
  description?: string;
  benchmarkMinor: number;
  /** The share added with the top-up bar; benchmarkMinor already includes it. */
  topUpPct?: number;
  timeLimitMinutes: number;
  flag?: Enums<'task_flag'>;
  media?: { kind: 'image' | 'video'; path: string; seconds?: number } | null;
  locLabel?: string | null;
  locLat?: number | null;
  locLng?: number | null;
  category?: string | null;
  skills?: string[];
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  assignmentMode?: 'bids' | 'auto';
  dueAt?: string | null;
  milestones?: { title: string; pct: number }[];
  kind?: TaskKind;
} & PosterOptionsInput;

/**
 * The options a poster switched on in the Options step (migration 134). The
 * server sets the Flash Drop and Regulars windows itself and refuses any
 * combination it does not accept.
 */
export type PosterOptionsInput = {
  /** Flash Drop: Auto-hire within 30 minutes, helpers nearby told at once. */
  flash?: boolean;
  /** A quick paid question about a place, answered with a live photo. */
  liveAnswer?: boolean;
  /** Crew: how many helpers (2 to 10); benchmarkMinor is the whole budget, split evenly. */
  crewSize?: number;
  repeatEvery?: 'week' | 'month' | null;
  /** Someone hired before, offered the task for the first 10 minutes. */
  preferWorkerId?: string | null;
  wantPhotos?: boolean;
  /** Let the helper show the photos on their profile. */
  photosPublic?: boolean;
  /** City Hunt (migration 158): how long it runs, and what a find must show. The reward is the price. */
  huntWindow?: '2h' | 'today' | '3d';
  huntNeeds?: ('photo' | 'place' | 'pin' | 'price')[];
};

export async function createTask(input: NewTask): Promise<Task> {
  const { posterId: _poster, ...rest } = input;
  const task = await act<Task>('createTask', { ...rest });
  count('task.posted');
  return task;
}

export async function placeBid(input: {
  taskId: string;
  workerId: string;
  priceMinor: number;
  timeLimitMinutes: number;
  message?: string;
  /** The worker's own finish date (plan 1.19 J); asked for when the task's date has passed. */
  proposedDueAt?: string | null;
}): Promise<Bid> {
  const { workerId: _worker, ...rest } = input;
  return act<Bid>('placeBid', { ...rest });
}

export const getMyBid = (taskId: string, _userId: string) => act<Bid | null>('getMyBid', { taskId });

export const updateBid = (
  bidId: string,
  edits: { priceMinor: number; timeLimitMinutes: number; message: string | null; proposedDueAt?: string | null },
) => act<Bid>('updateBid', { bidId, ...edits });

export type QuoteVerdict =
  | { allowed: true }
  | { allowed: false; code: 'own' | 'closed' | 'duplicate'; reason: string };

/** Whether this person may quote on this task, asked before the button is offered. */
export const canQuoteOn = (taskId: string, _userId: string) =>
  quietly<QuoteVerdict>('canQuoteOn', { taskId }, { allowed: true });

/** Which of these tasks this person has already sent an offer on (one offer per task, up to 100 ids). */
export const myBidTaskIds = (taskIds: string[]) => quietly<string[]>('myBidTaskIds', { taskIds: taskIds.slice(0, 100) }, []);

/** The server refused a second offer on the same task. */
export const isDuplicateOffer = (e: unknown) => e instanceof ApiError && e.code === 'DUPLICATE';

export type ProfileEdits = {
  displayName?: string;
  skills?: string[];
  locLabel?: string | null;
  locLat?: number | null;
  locLng?: number | null;
  /** Storage path of the profile photo, never a URL. */
  avatarUrl?: string | null;
  onboarded?: boolean;
};

export async function updateProfile(_userId: string, edits: ProfileEdits): Promise<Profile> {
  const row = await act<Profile>('updateProfile', { ...edits });
  primeProfile(row);
  return row;
}

// ------------------------------------------------------------- lifecycle --

/**
 * Choose an offer. `expectedPriceMinor` is the price the poster saw: the server refuses with
 * OFFER_CHANGED when the worker changed it since (isOfferChanged), so nobody is charged a price
 * they did not see. `expectedDueAt` is the offer's finish date the poster saw (null when it showed
 * none): the server refuses with OFFER_DUE_CHANGED when the worker changed it since (227).
 */
export const lockBid = (
  bidId: string,
  payoutMode: Enums<'payout_mode'> = 'one_time',
  expectedPriceMinor?: number,
  expectedDueAt?: string | null,
) =>
  act<Task>('lockBid', {
    bidId,
    payoutMode,
    ...(expectedPriceMinor == null ? null : { expectedPriceMinor }),
    ...(expectedDueAt === undefined ? null : { expectedDueAt }),
  });

/** The worker changed the offer's price or finish date after the poster looked; reload and show the new one. */
export const isOfferChanged = (e: unknown) =>
  e instanceof ApiError && (e.code === 'OFFER_CHANGED' || e.code === 'OFFER_DUE_CHANGED');
/** The message to show for a changed offer: which part changed. */
export const offerChangedMessage = (e: unknown) =>
  e instanceof ApiError && e.code === 'OFFER_DUE_CHANGED'
    ? 'The helper changed their finish time. Please look again.'
    : 'The offer changed. Please review the new price.';
export const payTaskFromWallet = (taskId: string) => act<Task>('payTaskFromWallet', { taskId });
export const startTask = (taskId: string) => act<Task>('startTask', { taskId });
export const markWorkDone = (taskId: string) => act<Task>('markWorkDone', { taskId });
/**
 * Under Plan B, run the task's waiting release or refund now. The flag is set by the first screen that asks
 * the server for the money flow; someone who came straight to the approve screen has not asked yet, so ask.
 */
function settleIfPlanB(taskId: string): void {
  if (isPlanB()) return moneySettle(taskId);
  void getMoneyMode()
    .then((m) => {
      if (m?.flow === 'plan_b') moneySettle(taskId);
    })
    .catch(() => {
      /* the server's own schedule picks it up */
    });
}
export const confirmRelease = async (taskId: string) => {
  const task = await act<Task>('confirmRelease', { taskId });
  settleIfPlanB(taskId); // release the worker's share at once (fire and forget)
  return task;
};
export const requestRevision = (taskId: string, note?: string) =>
  act<Task>('requestRevision', { taskId, note: note?.trim() || null });
export const cancelTask = async (taskId: string, reason?: string) => {
  const task = await act<Task>('cancelTask', { taskId, reason: reason?.trim() || null });
  settleIfPlanB(taskId); // refund (or split) at once (fire and forget)
  return task;
};
export const openDispute = (taskId: string, reason?: string) =>
  act<Task>('openDispute', { taskId, reason: reason?.trim() || null });
export const submitReview = (taskId: string, rating: number, comment?: string) =>
  act<unknown>('submitReview', { taskId, rating, comment: comment?.trim() ? comment.trim() : null });

/** Move cleared earnings into the spendable balance. Call before showing a balance; let it fail quietly. */
export const settleClearedEarnings = async () => {
  const settled = await act<number>('settleClearedEarnings');
  // Only a sweep that moved money changes what the other screens show.
  if (settled > 0) noteChange();
  return settled;
};

/** Ask for a withdrawal; the server debits the wallet and hands it to the bank in one go. */
export const requestWithdrawal = (amountMinor: number, destinationId: string | null, destinationLabel?: string) =>
  act<{ id: string }>('requestWithdrawal', {
    amountMinor,
    destination: destinationLabel?.trim() ? destinationLabel.trim() : null,
    destinationId,
  });

export type Payout = {
  id: string;
  amount_minor: number;
  status: 'requested' | 'processing' | 'paid' | 'failed' | 'cancelled';
  destination: string | null;
  failure_note: string | null;
  reference: string | null;
  created_at: string;
  updated_at: string;
};

export const listPayouts = (limit = 20) => ask<Payout[]>('listPayouts', { limit }, []);

export const cancelWithdrawal = (payoutId: string) => act<unknown>('cancelWithdrawal', { payoutId });

export type PayoutDestination = {
  id: string;
  kind: 'upi' | 'bank';
  label: string | null;
  upi_id: string | null;
  account_name: string | null;
  account_number: string | null;
  ifsc: string | null;
  is_default: boolean;
  created_at: string;
};

/** How a destination reads on screen, with the account number mostly hidden. */
export function describeDestination(d: PayoutDestination): string {
  if (d.kind === 'upi') return d.upi_id ?? 'UPI';
  const tail = (d.account_number ?? '').slice(-4);
  return `${d.account_name ?? 'Bank account'} ····${tail}`;
}

export const listPayoutDestinations = () => ask<PayoutDestination[]>('listPayoutDestinations', {}, []);

export const addPayoutDestination = (
  input:
    | { kind: 'upi'; upiId: string; label?: string }
    | { kind: 'bank'; accountName: string; accountNumber: string; ifsc: string; label?: string },
) => act<PayoutDestination>('addPayoutDestination', { ...input });

export async function removePayoutDestination(id: string): Promise<void> {
  await act<void>('removePayoutDestination', { id });
}

export const setDefaultPayoutDestination = (id: string) =>
  act<PayoutDestination>('setDefaultPayoutDestination', { destinationId: id });

export type PromotableTask = {
  id: string;
  title: string;
  benchmark_minor: number;
  status: string;
  quotes: number;
};

export const promotableTasks = () => ask<PromotableTask[]>('promotableTasks', {}, []);

/** A promotable post on the picker: open, with fewer workers than wanted ("1 of 5 workers"). */
export type PromotablePost = PromotableTask & {
  category: string | null;
  kind: 'request' | 'service';
  crew_id: string | null;
  filled: number;
  wanted: number;
};

export const PROMOTABLE_PAGE = 10;

/** The caller's promotable posts, newest first, one page at a time. `hasMore` says whether "Show more" has anything. */
export const promotableTasksPage = (kind: TaskKind, offset = 0, limit = PROMOTABLE_PAGE) =>
  ask<{ items: PromotablePost[]; hasMore: boolean }>('promotableTasksPage', { kind, offset, limit }, { items: [], hasMore: false });

/** Daily budgets in whole rupees and campaign lengths in days that `start_promotion` accepts. */
export type PromotionTiers = { budgets: number[]; days: number[] };

/** What migration 114 seeds, used until the settings load and whenever they look wrong. */
export const DEFAULT_PROMOTION_TIERS: PromotionTiers = { budgets: [50, 80, 150, 300], days: [1, 3, 7] };

const positiveInts = (v: unknown, divisor = 1): number[] | null => {
  if (!Array.isArray(v) || v.length === 0 || v.length > 12) return null;
  const out = v.map((n) => (typeof n === 'number' && Number.isInteger(n) && n > 0 && n % divisor === 0 ? n / divisor : NaN));
  return out.some(Number.isNaN) ? null : [...new Set(out)].sort((a, b) => a - b);
};

/**
 * The tiers the server will accept, from the `settings` rows staff edit in the admin (migration 114), read through the api.
 * The server still refuses anything outside them, so this only decides what the screen offers.
 */
export async function promotionTiers(): Promise<PromotionTiers> {
  try {
    const raw = await reusePublic('promotionTiers', '{}', () => callApi<{ budgetsMinor: unknown; days: unknown }>('promotionTiers'));
    return {
      budgets: positiveInts(raw?.budgetsMinor, 100) ?? DEFAULT_PROMOTION_TIERS.budgets,
      days: positiveInts(raw?.days) ?? DEFAULT_PROMOTION_TIERS.days,
    };
  } catch {
    return DEFAULT_PROMOTION_TIERS;
  }
}

/** Three budgets to show: the lowest three for people earning, the highest three for people hiring. */
export const budgetsForMode = (budgets: number[], worker: boolean): number[] =>
  budgets.length <= 3 ? budgets : worker ? budgets.slice(0, 3) : budgets.slice(-3);

export type PosterStatsMine = {
  role: 'poster';
  spentMinor: number;
  escrowHeldMinor: number;
  posted: number;
  open: number;
  live: number;
  completed: number;
  cancelled: number;
  quotesReceived: number;
  rating: number | null;
  ratingCount: number;
};

export type WorkerStatsMine = {
  role: 'worker';
  earnedMinor: number;
  clearingMinor: number;
  availableMinor: number;
  withdrawnMinor: number;
  quotesPlaced: number;
  quotesWon: number;
  jobsLive: number;
  jobsDone: number;
  rating: number | null;
  ratingCount: number;
};

export type MyStats = PosterStatsMine | WorkerStatsMine;

export const myStats = (role: 'worker' | 'poster') => act<MyStats>('myStats', { role });

// ------------------------------------------------------------ promotions ---

export type Promotion = {
  id: string;
  task_id: string;
  amount_minor: number;
  days: number;
  status: 'pending' | 'active' | 'expired' | 'cancelled';
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  /** listPromotions only (migration 203). */
  day_budget_minor?: number | null;
  spent_minor?: number;
  alerted_count?: number;
  task?: { title: string; kind: 'request' | 'service'; status: string } | null;
};

export const startPromotion = (taskId: string, days: number, amountMinor: number) =>
  act<Promotion>('startPromotion', { taskId, days, amountMinor });
export const activatePromotion = (promotionId: string, paymentId: string) =>
  act<Promotion>('activatePromotion', { promotionId, paymentId });
export const cancelPromotion = (promotionId: string) => act<Promotion>('cancelPromotion', { promotionId });
export const listPromotions = () => ask<Promotion[]>('listPromotions', {}, []);

/** The live ad auction's running order. Rank 1 is the winning campaign. */
export async function adAuctionRanks(): Promise<Map<string, number>> {
  // Reused for a few seconds only while the admin switch "public cache: app" is on (lib/freshness.ts). The
  // empty fallback on a failure is made here, outside the reuse, so it is never kept.
  try {
    if (!(await myId()) && !isGuestOp('adAuctionRanks')) return new Map();
    return toMap(await reusePublic('adAuctionRanks', '{}', () => callApi<Record<string, number>>('adAuctionRanks', {})));
  } catch {
    return new Map();
  }
}

export async function recordAdImpression(taskId: string): Promise<void> {
  await quietly('recordAdImpression', { taskId }, null);
}

export async function recordAdClick(taskId: string): Promise<void> {
  await quietly('recordAdClick', { taskId }, null);
}

// ------------------------------------------------- promotions: bidding (migration 203) ---

/** Everything the Promote screen needs for one post: budget limits, lengths, how busy the area is, its campaign. */
export type PromotionQuote = {
  kind: 'request' | 'service';
  remote: boolean;
  days: number[];
  minDayMinor: number;
  maxDayMinor: number;
  floorMinor: number;
  topSlots: number;
  viewerTopPerDay: number;
  areaKm: number;
  /** Other live promotions of the same kind in the area. */
  others: number;
  /** Average price of a top show in the area over the last 7 days; null when there is none yet. */
  areaPriceMinor: number | null;
  areaTopShowsDay: number | null;
  nearbyActive: number;
  promotion: {
    id: string; status: Promotion['status']; days: number; amountMinor: number; dayBudgetMinor: number | null;
    startsAt: string | null; endsAt: string | null;
  } | null;
};

export const promotionQuote = (taskId: string) => act<PromotionQuote>('promotionQuote', { taskId });
export const setPromoAlerts = (on: boolean) => act<boolean>('setPromoAlerts', { on });

/** A live promotion near the viewer; `top` when it won a top place in this auction (place 1 or 2). */
export type PromotedLive = {
  task_id: string;
  promotion_id: string;
  /** Who posted it: for a service, the helper to lift in Hire-side lists and the helpers map. */
  poster_id: string;
  top: boolean;
  place: number | null;
};

/**
 * Runs the auction for the top places when a list opens: live promoted tasks (kind 'request', for people
 * earning) or services (for people hiring) near a point. `taskIds` is the list the viewer is looking at after
 * their filters; only those can win. The server charges the winners, once per few minutes per viewer.
 */
export async function promotedLive(
  kind: 'request' | 'service',
  near: { lat: number; lng: number; radiusKm?: number } | null,
  opts: { surface?: 'list' | 'home' | 'map' | 'search'; taskIds?: string[] } = {},
): Promise<PromotedLive[]> {
  if (!(await myId())) return [];
  return quietly<PromotedLive[]>('promotedLive', {
    kind, lat: near?.lat ?? null, lng: near?.lng ?? null, radiusKm: Math.round(near?.radiusKm ?? 10),
    surface: opts.surface ?? 'list',
    ...(opts.taskIds ? { taskIds: opts.taskIds.slice(0, 500) } : {}),
  }, []);
}

export type PromoSurface = 'list' | 'home' | 'map' | 'search' | 'alert' | 'detail';

/** One showing of a promoted post that is not a top place (labels, map pins, alerts). Free; never fails the screen. */
export async function recordPromoView(taskId: string, surface: PromoSurface, top: boolean): Promise<void> {
  await quietly('recordPromoView', { taskId, surface, top }, null);
}

/** What the payer of a promotion sees. */
export type PromotionResults = {
  promotionId: string;
  taskId: string;
  kind: 'request' | 'service';
  status: Promotion['status'];
  days: number;
  amountMinor: number;
  dayBudgetMinor: number;
  spentMinor: number;
  todaySpentMinor: number;
  todayBudgetMinor: number;
  startsAt: string | null;
  endsAt: string | null;
  /** When it stops spending: the end, or up to 2 days later while money is left. */
  lastEndAt: string | null;
  topShows: number;
  avgPriceMinor: number | null;
  areaPriceMinor: number | null;
  saw: number;
  onTop: number;
  opened: number;
  bySurface: Partial<Record<PromoSurface | 'other', number>>;
  offersSince: number;
  offersBefore: number;
  alerted: number;
};

export const promotionResults = (promotionId: string) => act<PromotionResults>('promotionResults', { promotionId });

// -------------------------------------------------------------- payments ---

export type PaymentLink = { paymentId: string; url: string; amountMinor: number };

export type PaymentCheck = {
  status: 'created' | 'paid' | 'cancelled';
  funded: boolean;
};

/** The reason our payment function gave, from the body supabase-js tucks away on a non-2xx. */
async function functionError(error: unknown, fallback: string): Promise<Error> {
  const context = (error as { context?: unknown }).context;
  if (context instanceof Response) {
    try {
      const body = (await context.clone().json()) as { error?: string };
      if (body?.error) return new Error(body.error);
    } catch {
      /* not JSON — fall through */
    }
  }
  return new Error(friendlyMessage({ message: error instanceof Error ? error.message : '' }, fallback));
}

export async function createPaymentLink(input: {
  purpose: 'escrow' | 'topup' | 'promotion';
  amountMinor?: number;
  taskId?: string | null;
  /** For purpose 'promotion': the pending campaign from startPromotion. The server prices it. */
  promotionId?: string;
  returnUrl?: string;
}): Promise<PaymentLink> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    region: FUNCTIONS_REGION,
    headers: clientHeaders(),
    body: { action: 'create-link', ...input },
  });
  if (error) {
    log.error('payment link request failed', { purpose: input.purpose, taskId: input.taskId ?? null });
    throw await functionError(error, 'Could not start the payment. Nothing was charged. Please try again in a few minutes.');
  }
  const out = data as { paymentId?: string; url?: string; amountMinor?: number; error?: string };
  if (out.error) {
    log.error('payment link refused', { purpose: input.purpose, taskId: input.taskId ?? null });
    throw new Error(out.error);
  }
  if (!out.paymentId || !out.url) {
    log.error('payment link reply had no link', { purpose: input.purpose, taskId: input.taskId ?? null });
    throw new Error('Could not start the payment. Nothing was charged. Please try again in a few minutes.');
  }
  log.info('payment link opened', { purpose: input.purpose, taskId: input.taskId ?? null, paymentId: out.paymentId });
  count('payment.link_opened', { purpose: input.purpose });
  return {
    paymentId: out.paymentId,
    url: out.url,
    amountMinor: Number(out.amountMinor ?? input.amountMinor ?? 0),
  };
}

export async function refundEscrow(taskId: string): Promise<{ refundedMinor: number; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    region: FUNCTIONS_REGION,
    body: { action: 'refund-escrow', taskId },
  });
  // Money may have moved: what other screens read before is out of date (lib/freshness.ts).
  noteChange();
  if (error) {
    log.error('refund request failed', { taskId });
    throw await functionError(error, 'Could not start the refund');
  }
  const out = data as { refundedMinor?: number; reason?: string; error?: string };
  if (out.error) {
    log.error('refund refused', { taskId });
    throw new Error(out.error);
  }
  return { refundedMinor: Number(out.refundedMinor ?? 0), reason: out.reason };
}

/** One call to the `money` function (Plan B). Plain-words errors from the server are passed on as they are. */
async function callMoney<T>(body: Record<string, unknown>, failed: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('money', {
    region: FUNCTIONS_REGION,
    headers: clientHeaders(),
    body,
  });
  // Money may have moved: what other screens read before is out of date (lib/freshness.ts).
  noteChange();
  if (error) {
    // Never log the body: payout set-up carries a PAN and a bank or UPI id.
    log.error('money request failed', { action: String(body.action) });
    throw await functionError(error, failed);
  }
  const out = data as T & { error?: string };
  if (out?.error) throw new Error(out.error);
  return out;
}

export type MoneyCheckout =
  | { ok: true; status: 'held' }
  | {
      ok: true;
      status: 'awaiting_payment';
      holdId: string;
      provider: string;
      chargedMinor: number;
      workerShareMinor: number;
      simulated: boolean;
      checkout: { url?: string; html?: string };
    };

/** Start paying for a hired task: the payment company's checkout, or "already held". */
export const moneyCheckout = (taskId: string, returnUrl: string) =>
  callMoney<MoneyCheckout>({ action: 'checkout', taskId, returnUrl }, 'Could not start the payment. Nothing was charged. Please try again in a few minutes.');

/** Ask whether the payment arrived. On staging, `simulate` is the test payment itself. */
export const moneySync = (taskId: string, simulate = false) =>
  callMoney<{ ok?: boolean; status: string }>(
    simulate ? { action: 'sync', taskId, simulate: true } : { action: 'sync', taskId },
    'Could not check the payment',
  );

export type PayoutSetupInput = {
  name: string;
  pan: string;
  method: 'upi' | 'bank';
  upi?: string;
  accountNumber?: string;
  ifsc?: string;
};
/** Goes straight to the payment company. The caller must clear its form afterwards; nothing is kept here. */
export const moneyPayoutSetup = (input: PayoutSetupInput) =>
  callMoney<{ ok?: boolean; status: PayeeStatus; hint?: string | null }>({ action: 'payout-setup', ...input }, 'Could not save your payout details. Please try again.');

export const moneyPayoutStatus = () =>
  callMoney<{ status: PayeeStatus; hint?: string | null }>({ action: 'payout-status' }, 'Could not check your payout set-up');

/** Run this task's waiting release or refund now. Fire and forget: the server retries on its own. */
export function moneySettle(taskId: string): void {
  void callMoney({ action: 'settle', taskId }, 'settle failed').catch(() => {
    /* the server's own schedule picks it up */
  });
}

export async function syncPayment(paymentId: string): Promise<PaymentCheck> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    region: FUNCTIONS_REGION,
    body: { action: 'sync', paymentId },
  });
  // A payment found paid funds a task or a wallet: what other screens read before is out of date.
  noteChange();
  if (error) {
    log.error('payment check failed', { paymentId });
    throw await functionError(error, 'Could not check the payment');
  }
  const out = data as { status?: string; funded?: boolean; error?: string };
  if (out.error) {
    log.error('payment check refused', { paymentId });
    throw new Error(out.error);
  }
  // Paid but the task is not funded is the case a poster gets stuck on.
  if (out.status === 'paid' && !out.funded) log.warn('payment paid but task not funded yet', { paymentId });
  return {
    status: (out.status as 'created' | 'paid' | 'cancelled') ?? 'created',
    funded: Boolean(out.funded),
  };
}

// ------------------------------------------------------------- listings -----

export type ListingInput = {
  title: string;
  description: string;
  priceMinor: number;
  deliveryDays: number;
  category: string | null;
  /** Rough area only ("Kondapur"), or 'Remote'. Never a door-level address. */
  locLabel: string;
  locLat: number | null;
  locLng: number | null;
};

export async function createListing(userId: string, input: ListingInput): Promise<Task> {
  return createTask({
    posterId: userId,
    pillar: 'services',
    title: input.title,
    description: input.description,
    benchmarkMinor: input.priceMinor,
    timeLimitMinutes: input.deliveryDays * 1440,
    category: input.category,
    locLabel: input.locLabel,
    locLat: input.locLat,
    locLng: input.locLng,
    kind: 'service',
  });
}

export const updateListing = (id: string, input: ListingInput) => act<Task>('updateListing', { id, ...input });

export async function removeListing(id: string): Promise<void> {
  await act<void>('removeListing', { taskId: id });
}

// -------------------------------------------------------- proof of work -----

export type Proof = Omit<Tables<'task_proofs'>, 'files'> & { files: import('../lib/media').ProofFile[] };

export const submitProof = (input: {
  taskId: string;
  workerId: string;
  summary: string;
  files: import('../lib/media').ProofFile[];
}) => act<Proof>('submitProof', { taskId: input.taskId, summary: input.summary.trim(), files: input.files });

/** Report a person or a task to the team (migration 093). */
export const reportContent = (targetType: 'user' | 'task' | 'message' | 'review', targetId: string, reason: string) =>
  act<string | null>('reportContent', { targetType, targetId, reason: reason.trim() });
export const blockUser = (userId: string) => act<null>('blockUser', { userId });
export type BlockedUser = { id: string; name: string; blockedAt: string };
export const listBlockedUsers = () => act<BlockedUser[]>('listBlockedUsers');
export const unblockUser = (userId: string) => act<null>('unblockUser', { userId });

export const getProof = (taskId: string) => quietly<Proof | null>('getProof', { taskId }, null);

// -------------------------------------------------------- poster options --

/** One slot of a crew job. Names only reach the poster and the people hired. */
export type CrewSlot = {
  task_id: string;
  slot: number;
  size: number;
  status: Enums<'task_status'>;
  title: string;
  price_minor: number;
  worker_id: string | null;
  worker_name: string | null;
  worker_avatar: string | null;
};
export type CrewMessage = Tables<'crew_messages'>;

export const crewOverview = (crewId: string) => act<CrewSlot[]>('crewOverview', { crewId });
export const listCrewMessages = (crewId: string) => act<CrewMessage[]>('listCrewMessages', { crewId });
export const sendCrewMessage = (crewId: string, body: string) => act<CrewMessage>('sendCrewMessage', { crewId, body });

/** Someone this poster hired for finished jobs: the Regulars list. */
export type Regular = { profile: Profile; jobs: number; categories: string[]; lastAt: string | null };
export const myRegulars = () => quietly<Regular[]>('myRegulars', {}, []);

export const setRepeat = (taskId: string, every: 'week' | 'month' | null) =>
  act<{ id: string; repeat_every: string | null }>('setRepeat', { taskId, every });
/** A new date on an open post, or null to make it open-ended (plan 1.19 J). A crew's posts move together. */
export const setTaskDue = (taskId: string, dueAt: string | null) =>
  act<{ id: string; due_at: string | null }>('setTaskDue', { taskId, dueAt });
/** Raise the top-up on an open post to a bigger step (migration 194). The server works out the new price. */
export const raiseTopUp = (taskId: string, topUpPct: number) =>
  act<{ id: string; topup_pct: number; benchmark_minor: number } | null>('raiseTopUp', { taskId, topUpPct });

export type ProofPhotos = {
  task_id: string;
  title: string;
  category: string | null;
  completed_at: string | null;
  files: import('../lib/media').ProofFile[];
};
export const workerProofPhotos = (userId: string) => quietly<ProofPhotos[]>('workerProofPhotos', { userId }, []);

/** The Earn side's week: goal, on-time streak and the counts badges are made from. */
export type Streaks = {
  weekStart: string;
  weekEarnedMinor: number;
  weekJobs: number;
  weeklyGoalMinor: number | null;
  onTimeStreak: number;
  jobsDone: number;
  earlyStarts: number;
  fiveStars: number;
  crewJobs: number;
  liveAnswers: number;
  photoJobs: number;
};
export const myStreaks = () => act<Streaks>('myStreaks');
export const setWeeklyGoal = (goalMinor: number | null) =>
  act<{ weekly_goal_minor: number | null }>('setWeeklyGoal', { goalMinor });

// ------------------------------------------------------------ City Hunt ----
// Migration 158. Every rule (who may look or send, the 3-find cap, the time
// limit, what stays locked until accepted) and every rupee is decided in SQL.

/** One find as its reader may see it: the locked fields are null until the poster accepts it (or it is your own). */
export type HuntFind = Database['public']['Functions']['hunt_finds_for_task']['Returns'][number];
export type HuntCounts = Database['public']['Functions']['hunt_counts']['Returns'][number];

export const huntFinds = (taskId: string) => act<HuntFind[]>('huntFinds', { taskId });
export const huntCounts = (taskIds: string[]) =>
  taskIds.length ? quietly<HuntCounts[]>('huntCounts', { taskIds: taskIds.slice(0, 100) }, []) : Promise.resolve([] as HuntCounts[]);
export const huntLook = (taskId: string) =>
  act<{ taskId: string; lookers: number; finds: number; looking: boolean }>('huntLook', { taskId });
export const huntSendFind = (input: {
  taskId: string;
  photoPath: string | null;
  placeName: string | null;
  lat: number | null;
  lng: number | null;
  priceNote: string | null;
  note: string | null;
}) => act<Tables<'hunt_finds'>>('huntSendFind', input);
/** "This is it": pays the finder. A short wallet throws WalletShortError with exactly what is missing. */
export const huntAcceptFind = (findId: string) =>
  act<{ taskId: string; findId: string; status: string; paidMinor: number | null }>('huntAcceptFind', { findId });
export const huntDeclineFind = (findId: string, reason: 'not_it' | 'gone' | 'too_far' | 'other') =>
  act<{ findId: string; status: string }>('huntDeclineFind', { findId, reason });
export const huntAskPart = (findId: string, part: 'photo' | 'place' | 'pin' | 'price') =>
  act<{ findId: string; askedPart: string }>('huntAskPart', { findId, part });
