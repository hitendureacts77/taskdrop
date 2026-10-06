import { ApiError, friendlyMessage } from '../lib/errors';
import { callApi } from '../lib/gateway';
import { FUNCTIONS_REGION, currentUserId, supabase } from '../lib/supabase';
import { subscribeLive } from '../lib/live';
import type { Tables, Enums } from '@taskdrop/db-types';

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

/** Ask the server to do something by name. */
async function act<T>(op: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!(await myId())) throw new Error('Sign in first');
  try {
    return await callApi<T>(op, args);
  } catch (e) {
    const short = e instanceof ApiError ? Number(e.details) : 0;
    if (e instanceof ApiError && e.message === 'Not enough money in your wallet' && short > 0) {
      throw new WalletShortError(short);
    }
    throw e;
  }
}

/** Same, but signed out simply means "nothing" rather than an error. */
async function ask<T>(op: string, args: Record<string, unknown>, signedOut: T): Promise<T> {
  if (!(await myId())) return signedOut;
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
};

export const searchTasks = (input: TaskSearch = {}) => act<Task[]>('searchTasks', { ...input });

export type TaskWithPoster = Task & { poster: Profile | null };

export async function attachPosters(tasks: Task[]): Promise<TaskWithPoster[]> {
  if (tasks.length === 0) return [];
  return act<TaskWithPoster[]>('attachPosters', { taskIds: tasks.map((t) => t.id) });
}

export const getTask = (taskId: string) => act<Task | null>('getTask', { taskId });

export type TaskDetail = {
  task: Task;
  assignment: Assignment | null;
  poster: Profile | null;
  worker: Profile | null;
};

export const getTaskDetail = (taskId: string) => act<TaskDetail | null>('getTaskDetail', { taskId });

export const getWallet = () => ask<Wallet | null>('getWallet', {}, null);

/** Escrow tied up in live jobs. With a side, only that side. */
export const getEscrowHeld = (side?: 'poster' | 'worker') => ask<number>('getEscrowHeld', { side: side ?? null }, 0);

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

export const countNeedsAttention = (_userId: string, mode: 'poster' | 'worker') =>
  act<number>('countNeedsAttention', { mode });

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

/** Where a freshly-signed-in user should land: setup for a first run, home otherwise. */
export async function postSignInRoute(userId: string): Promise<'home' | 'setup'> {
  try {
    return (await getProfile(userId))?.onboarded_at ? 'home' : 'setup';
  } catch {
    return 'setup';
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
};

export async function createTask(input: NewTask): Promise<Task> {
  const { posterId: _poster, ...rest } = input;
  return act<Task>('createTask', { ...rest });
}

export async function placeBid(input: {
  taskId: string;
  workerId: string;
  priceMinor: number;
  timeLimitMinutes: number;
  message?: string;
}): Promise<Bid> {
  const { workerId: _worker, ...rest } = input;
  return act<Bid>('placeBid', { ...rest });
}

export const getMyBid = (taskId: string, _userId: string) => act<Bid | null>('getMyBid', { taskId });

export const updateBid = (
  bidId: string,
  edits: { priceMinor: number; timeLimitMinutes: number; message: string | null },
) => act<Bid>('updateBid', { bidId, ...edits });

export type QuoteVerdict =
  | { allowed: true }
  | { allowed: false; code: 'own' | 'closed' | 'duplicate'; reason: string };

/** Whether this person may quote on this task, asked before the button is offered. */
export const canQuoteOn = (taskId: string, _userId: string) =>
  quietly<QuoteVerdict>('canQuoteOn', { taskId }, { allowed: true });

export type ProfileEdits = {
  displayName?: string;
  skills?: string[];
  locLabel?: string | null;
  locLat?: number | null;
  locLng?: number | null;
  /** Storage path of the profile photo, never a URL. */
  avatarUrl?: string | null;
  payoutUpi?: string | null;
  onboarded?: boolean;
};

export async function updateProfile(_userId: string, edits: ProfileEdits): Promise<Profile> {
  const row = await act<Profile>('updateProfile', { ...edits });
  primeProfile(row);
  return row;
}

// ------------------------------------------------------------- lifecycle --

export const lockBid = (bidId: string, payoutMode: Enums<'payout_mode'> = 'one_time') =>
  act<Task>('lockBid', { bidId, payoutMode });
export const payTaskFromWallet = (taskId: string) => act<Task>('payTaskFromWallet', { taskId });
export const startTask = (taskId: string) => act<Task>('startTask', { taskId });
export const markWorkDone = (taskId: string) => act<Task>('markWorkDone', { taskId });
export const confirmRelease = (taskId: string) => act<Task>('confirmRelease', { taskId });
export const requestRevision = (taskId: string, note?: string) =>
  act<Task>('requestRevision', { taskId, note: note?.trim() || null });
export const cancelTask = (taskId: string, reason?: string) =>
  act<Task>('cancelTask', { taskId, reason: reason?.trim() || null });
export const openDispute = (taskId: string, reason?: string) =>
  act<Task>('openDispute', { taskId, reason: reason?.trim() || null });
export const submitReview = (taskId: string, rating: number, comment?: string) =>
  act<unknown>('submitReview', { taskId, rating, comment: comment?.trim() ? comment.trim() : null });

/** Move cleared earnings into the spendable balance. Call before showing a balance; let it fail quietly. */
export const settleClearedEarnings = () => act<number>('settleClearedEarnings');

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
};

export const startPromotion = (taskId: string, days: number, amountMinor: number) =>
  act<Promotion>('startPromotion', { taskId, days, amountMinor });
export const activatePromotion = (promotionId: string, paymentId: string) =>
  act<Promotion>('activatePromotion', { promotionId, paymentId });
export const cancelPromotion = (promotionId: string) => act<Promotion>('cancelPromotion', { promotionId });
export const listPromotions = () => ask<Promotion[]>('listPromotions', {}, []);

/** The live ad auction's running order. Rank 1 is the winning campaign. */
export async function adAuctionRanks(): Promise<Map<string, number>> {
  return toMap(await quietly<Record<string, number>>('adAuctionRanks', {}, {}));
}

export async function recordAdImpression(taskId: string): Promise<void> {
  await quietly('recordAdImpression', { taskId }, null);
}

export async function recordAdClick(taskId: string): Promise<void> {
  await quietly('recordAdClick', { taskId }, null);
}

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
  purpose: 'escrow' | 'topup';
  amountMinor?: number;
  taskId?: string | null;
  returnUrl?: string;
}): Promise<PaymentLink> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    region: FUNCTIONS_REGION,
    body: { action: 'create-link', ...input },
  });
  if (error) throw await functionError(error, 'Could not start the payment');
  const out = data as { paymentId?: string; url?: string; amountMinor?: number; error?: string };
  if (out.error) throw new Error(out.error);
  if (!out.paymentId || !out.url) throw new Error('Could not start the payment');
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
  if (error) throw await functionError(error, 'Could not start the refund');
  const out = data as { refundedMinor?: number; reason?: string; error?: string };
  if (out.error) throw new Error(out.error);
  return { refundedMinor: Number(out.refundedMinor ?? 0), reason: out.reason };
}

export async function syncPayment(paymentId: string): Promise<PaymentCheck> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    region: FUNCTIONS_REGION,
    body: { action: 'sync', paymentId },
  });
  if (error) throw await functionError(error, 'Could not check the payment');
  const out = data as { status?: string; funded?: boolean; error?: string };
  if (out.error) throw new Error(out.error);
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

export const getProof = (taskId: string) => quietly<Proof | null>('getProof', { taskId }, null);
