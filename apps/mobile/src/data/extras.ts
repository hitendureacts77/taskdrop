import { apiError } from '../lib/errors';
import { callApi } from '../lib/gateway';
import { clientHeaders } from '../lib/appInfo';
import { currentUserId, supabase } from '../lib/supabase';
import { subscribeLive } from '../lib/live';
import { reuseWhileFresh } from '../lib/freshness';
import type { Tables } from '@taskdrop/db-types';
import { primeProfile, type Task, type Profile } from './api';
import type { Idea, IdeaComment, IdeaKind, IdeaStatus } from '../lib/ideas';

/**
 * The second-wave features: notifications, saved tasks, help & support,
 * feedback, referrals, explore, public profiles, presence and sign-in extras.
 * Each call is one named request to the server (supabase/functions/api).
 */

const myId = currentUserId;

async function act<T>(op: string, args: Record<string, unknown> = {}, signedOutMessage = 'Sign in first'): Promise<T> {
  if (!(await myId())) throw new Error(signedOutMessage);
  return callApi<T>(op, args);
}

async function ask<T>(op: string, args: Record<string, unknown>, signedOut: T): Promise<T> {
  if (!(await myId())) return signedOut;
  return callApi<T>(op, args);
}

async function quietly<T>(op: string, args: Record<string, unknown>, fallback: T): Promise<T> {
  try {
    return await ask<T>(op, args, fallback);
  } catch {
    return fallback;
  }
}

// ------------------------------------------------------------ notifications --

export type Notification = Tables<'notifications'>;

export const listNotifications = (limit = 50) => ask<Notification[]>('listNotifications', { limit }, []);

export const countUnreadNotifications = () => quietly<number>('countUnreadNotifications', {}, 0);

/** Which side a notification belongs to: 'both' when it has no task. */
export type NotificationSide = 'poster' | 'worker' | 'both';

export async function notificationSides(rows: Notification[]): Promise<Map<string, NotificationSide>> {
  if (rows.length === 0) return new Map();
  const sides = await ask<Record<string, NotificationSide>>(
    'notificationSides',
    { rows: rows.map((r) => ({ id: r.id, task_id: r.task_id })) },
    {},
  );
  return new Map(Object.entries(sides));
}

/**
 * The bell's count for one side. Every open header recounts on every screen change, so a count from
 * moments ago, with no alert, write or sign-in since, is reused (lib/freshness.ts). A failure is never kept.
 */
export const countUnreadFor = (side: 'poster' | 'worker') =>
  reuseWhileFresh(`countUnreadFor:${side}`, () => ask<number>('countUnreadFor', { side }, 0)).catch(() => 0);

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  await ask('markNotificationsRead', { ids: ids ?? [] }, null);
}

/**
 * New notifications for this user, live. Returns an unsubscribe function. On
 * each ping the row is fetched from the server.
 */
export function subscribeToNotifications(_userId: string, onInsert: (n: Notification) => void): () => void {
  return subscribeLive((ping) => {
    if (ping.kind !== 'notification' || !ping.id) return;
    void ask<Notification | null>('getNotification', { id: ping.id }, null)
      .then((n) => {
        if (n) onInsert(n);
      })
      .catch(() => {});
  });
}

// ------------------------------------------------------------- saved tasks --

export async function listSavedTaskIds(): Promise<Set<string>> {
  return new Set(await ask<string[]>('listSavedTaskIds', {}, []));
}

export const listSavedTasks = () => ask<Task[]>('listSavedTasks', {}, []);

export async function setSaved(taskId: string, saved: boolean): Promise<void> {
  await act('setSaved', { taskId, saved }, 'Sign in to save tasks');
}

// ---------------------------------------------------------- help & support --

export type Ticket = Tables<'support_tickets'>;
export type TicketMessage = Tables<'support_messages'>;
export type TicketCategory = 'payment' | 'task' | 'account' | 'safety' | 'bug' | 'other';

export const TICKET_CATEGORIES: { key: TicketCategory; label: string }[] = [
  { key: 'payment', label: 'Payment or withdrawal' },
  { key: 'task', label: 'A task or a worker' },
  { key: 'account', label: 'My account' },
  { key: 'safety', label: 'Safety concern' },
  { key: 'bug', label: 'Something is broken' },
  { key: 'other', label: 'Something else' },
];

export const listTickets = () => ask<Ticket[]>('listTickets', {}, []);

export const getTicket = (id: string) =>
  act<{ ticket: Ticket; messages: TicketMessage[] } | null>('getTicket', { ticketId: id });

export const openTicket = (category: TicketCategory, body: string, page?: string) =>
  act<Ticket>('openTicket', { category, body, page: page ?? null });

export const replyTicket = (ticketId: string, body: string) => act<TicketMessage>('replyTicket', { ticketId, body });

export const resolveTicket = (ticketId: string) => act<Ticket>('resolveTicket', { ticketId });

// ---------------------------------------------------------------- feedback --

export type FeedbackKind = 'broken' | 'idea' | 'confusing' | 'praise';

export async function sendFeedback(kind: FeedbackKind, body: string, page?: string): Promise<void> {
  const text = body.trim();
  if (text.length < 3) throw new Error('Write a little more first');
  await act('sendFeedback', { kind, body: text, page: page ?? null }, 'Sign in to send feedback');
}

// ------------------------------------------------------ feedback board (136) --

export type IdeaQuery = {
  sort?: 'top' | 'new';
  status?: IdeaStatus | null;
  category?: IdeaKind | null;
  search?: string;
  limit?: number;
  offset?: number;
};

/** The public board: ideas people posted, most voted first unless asked for the newest. */
export const listIdeas = (q: IdeaQuery = {}) =>
  ask<Idea[]>(
    'listFeedbackBoard',
    {
      sort: q.sort ?? 'top',
      status: q.status ?? null,
      category: q.category ?? null,
      search: q.search?.trim() || null,
      limit: q.limit ?? 30,
      offset: q.offset ?? 0,
    },
    [],
  );

/** One idea and its comments; null once it has been hidden or removed. */
export const getIdea = (id: string) =>
  act<{ post: Idea; comments: IdeaComment[] } | null>('getFeedbackPost', { postId: id });

export async function postIdea(title: string, body: string, category: IdeaKind): Promise<Idea> {
  const t = title.trim();
  if (t.length < 3) throw new Error('Give your idea a short title first');
  return act<Idea>('postFeedbackIdea', { title: t, body: body.trim(), category }, 'Sign in to suggest an idea');
}

export const voteIdea = (id: string, on: boolean) =>
  act<{ votes: number; iVoted: boolean }>('voteFeedbackIdea', { postId: id, on }, 'Sign in to vote');

export const commentOnIdea = (id: string, body: string) =>
  act<IdeaComment>('commentFeedbackIdea', { postId: id, body: body.trim() }, 'Sign in to comment');

// ----------------------------------------------------- questions on a task --

/** A worker's question on a task and the poster's public answer (migration 140). */
export type TaskQuestion = {
  id: string;
  body: string;
  answer: string | null;
  answeredAt: string | null;
  /** First name only. */
  asker: string;
  mine: boolean;
  createdAt: string;
};

/** Empty when there are none or the task is closed to the caller; null when they could not be read (or are not switched on yet). */
export const listTaskQuestions = (taskId: string) => quietly<TaskQuestion[] | null>('listTaskQuestions', { taskId }, null);

export const askTaskQuestion = (taskId: string, body: string) =>
  act<TaskQuestion>('askTaskQuestion', { taskId, body: body.trim() }, 'Sign in to ask a question');

export const answerTaskQuestion = (questionId: string, answer: string) =>
  act<{ id: string; answer: string; answeredAt: string }>('answerTaskQuestion', { questionId, answer: answer.trim() });

/** Tasks finished near a point today and helpers active there now; null when it could not be counted. */
export type NearbyPulse = { doneToday: number; activeNow: number };
export const nearbyPulse = (near: { lat: number; lng: number }, radiusKm = 5) =>
  quietly<NearbyPulse | null>('nearbyPulse', { lat: near.lat, lng: near.lng, radiusKm }, null);

// --------------------------------------------------------------- referrals --

export const applyReferralCode = (code: string) => act<boolean>('applyReferralCode', { code });

export const countMyReferrals = () => quietly<number>('countMyReferrals', {}, 0);

// ------------------------------------------------------- explore / trending --

export type Highlights = {
  activeNow: number;
  activeToday: number;
  openTasks: number;
  completedToday: number;
  liveWorkers: number;
};

export const platformHighlights = () => act<Highlights>('platformHighlights');

export type TrendingCategory = {
  category: string;
  open_count: number;
  recent_count: number;
  avg_budget_minor: number;
};

export const trendingCategories = (limit = 8) => act<TrendingCategory[]>('trendingCategories', { limit });

export type EarnerKind = 'top_rated' | 'most_active' | 'new_talent';
export type Earner = {
  id: string;
  display_name: string;
  username: string | null;
  avatar_url: string | null;
  rating: number | null;
  rating_count: number;
  jobs_done: number;
  skill: string | null;
};

export const topEarners = (kind: EarnerKind, limit = 10) => act<Earner[]>('topEarners', { kind, limit });

export type PublicStats = { jobsDone: number; tasksPosted: number; tasksCompletedAsPoster: number };
export const publicProfileStats = (userId: string) => act<PublicStats>('publicProfileStats', { userId });

/** Open tasks that match this worker's skills, best match first. */
export const recommendedTasks = (skills: string[], limit = 10) => act<Task[]>('recommendedTasks', { skills, limit });

// ----------------------------------------------------------------- inbox ----

export type Thread = {
  taskId: string;
  title: string;
  lastBody: string;
  lastAt: string;
  lastFromMe: boolean;
  status: string;
};

export const listThreads = () => ask<Thread[]>('listThreads', {}, []);

// ---------------------------------------------------------------- disputes --

export const listMyDisputes = () => ask<Task[]>('listMyDisputes', {}, []);

export async function listDisputeReasons(taskIds: string[]): Promise<Map<string, { reason: string; mine: boolean }>> {
  if (taskIds.length === 0) return new Map();
  return new Map(Object.entries(await quietly<Record<string, { reason: string; mine: boolean }>>('listDisputeReasons', { taskIds }, {})));
}

// ------------------------------------------------------ profile & presence --

/** Is this @handle free? */
export async function usernameAvailable(username: string): Promise<boolean> {
  const handle = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) return false;
  return quietly<boolean>('usernameAvailable', { username: handle }, false);
}

export type ProfileExtras = {
  username?: string | null;
  bio?: string | null;
  workerBio?: string | null;
  languages?: string[];
  intent?: 'post' | 'earn' | 'both' | null;
  workerOnboarded?: boolean;
};

export async function updateProfileExtras(_userId: string, edits: ProfileExtras): Promise<Profile> {
  const row = await act<Profile>('updateProfileExtras', { ...edits });
  primeProfile(row);
  return row;
}

let lastPresence = 0;

/** Record that this person has TaskDrop open. At most every 45s; never throws. */
export async function touchPresence(_userId: string): Promise<void> {
  if (Date.now() - lastPresence < 45_000) return;
  lastPresence = Date.now();
  await quietly('touchPresence', {}, null);
}

// ------------------------------------------------------------------ fees -----

export type Fees = {
  commission: number;
  posterFee: number;
  clearingDays: number;
  /** Paid to the worker when the customer cancels after work started. Absent from older servers. */
  cancelFine?: number;
};

export const platformFees = () =>
  quietly<Fees>('platformFees', {}, { commission: 0.1, posterFee: 0.03, clearingDays: 7, cancelFine: 0.05 });

/** Platform fees this person actually paid since `since`. */
export const feesSince = (since: Date | null, commission: number) =>
  ask<{ serviceMinor: number; commissionMinor: number }>(
    'feesSince',
    { since: since?.toISOString() ?? null, commission },
    { serviceMinor: 0, commissionMinor: 0 },
  );

// ---------------------------------------------------------- password auth ---

const PW_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/password-auth`;

/** Sign in with @username + password. */
export async function signInWithUsername(username: string, password: string): Promise<void> {
  const res = await fetch(PW_URL, {
    method: 'POST',
    headers: {
      apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '',
      'Content-Type': 'application/json',
      ...clientHeaders(),
    },
    body: JSON.stringify({ username, password }),
  });
  const out = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    error?: string;
  };
  if (!res.ok || !out.access_token || !out.refresh_token) {
    throw new Error(out.error ?? 'Could not sign in');
  }
  const { error } = await supabase.auth.setSession({
    access_token: out.access_token,
    refresh_token: out.refresh_token,
  });
  if (error) throw apiError(error);
}

/** Set or change the password for username sign-in. */
export async function setPassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error('Use at least 8 characters');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw apiError(error);
}

/**
 * End this person's sessions on the server (migration 142). `all: true` is "Sign out of all devices" and includes this
 * one, so the caller then clears its own copy; `all: false` keeps this device and signs the others out (after a
 * password change). The other devices' tokens stop working on their next call, not within the hour.
 */
export const endMySessions = (all: boolean) => act<{ ended: number }>('endMySessions', { all });

/** One thing that has to be settled before an account can be deleted. */
export type DeletionBlocker = { code: string; message: string };

/** What stands in the way of deleting this account, and whether some records stay (anonymised). */
export const accountDeletionCheck = () =>
  act<{ blockers: DeletionBlocker[]; keepsRecords: boolean }>('accountDeletionCheck');

/**
 * Delete this account for good (migration 087). The server signs it out
 * everywhere, so only this device's copy of the session is left to clear.
 */
export async function deleteMyAccount(): Promise<void> {
  await act('deleteMyAccount', { confirm: 'DELETE MY ACCOUNT' });
  await supabase.auth.signOut({ scope: 'local' });
}

/** Which sign-in methods this account has. */
export async function verificationState(): Promise<{ phone: boolean; email: boolean; google: boolean }> {
  const { data } = await supabase.auth.getUser();
  const u = data.user;
  const email = u?.email ?? '';
  const providers = ((u?.app_metadata?.providers as string[] | undefined) ?? [u?.app_metadata?.provider])
    .filter(Boolean) as string[];
  const phone = /@phone\.taskdrop\.app$/i.test(email);
  const google = providers.includes('google');
  return { phone, email: google || (!phone && Boolean(u?.email_confirmed_at)), google };
}

// ------------------------------------------------------------- remote work --

export const remoteTasks = (limit = 5) => act<Task[]>('remoteTasks', { limit });

export const tasksNear = (near: { lat: number; lng: number }, radiusKm: number, limit = 5) =>
  act<(Task & { km: number })[]>('tasksNear', { lat: near.lat, lng: near.lng, radiusKm, limit });

/** A helper on a poster's map: the public card fields and the rounded area only. */
export type NearbyWorker = Pick<
  Profile,
  'id' | 'display_name' | 'username' | 'avatar_url' | 'skills' | 'worker_rating_avg' | 'worker_rating_count' | 'last_seen_at' | 'loc_lat' | 'loc_lng' | 'loc_label'
> & {
  km: number;
  /** Their newest open service listing, for the map label; null when they only list skills. */
  top_service?: { id: string; title: string; price_minor: number; category: string | null } | null;
  service_count?: number;
};

export const workersNear = (near: { lat: number; lng: number }, radiusKm: number, limit = 12) =>
  act<NearbyWorker[]>('workersNear', { lat: near.lat, lng: near.lng, radiusKm, limit });

/** One helper's open service listings, newest first (the helper sheet on the map). */
export const workerServices = (userId: string, limit = 10) => act<Task[]>('workerServices', { userId, limit });

export const urgentTasks = (limit = 3) => act<Task[]>('urgentTasks', { limit });
