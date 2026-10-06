import { apiError } from '../lib/errors';
import { callApi } from '../lib/gateway';
import { currentUserId, supabase } from '../lib/supabase';
import { subscribeLive } from '../lib/live';
import type { Tables } from '@taskdrop/db-types';
import { primeProfile, type Task, type Profile } from './api';

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

export const countUnreadFor = (side: 'poster' | 'worker') => quietly<number>('countUnreadFor', { side }, 0);

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

/** Workers around lately, most recently active first. */
export const listActiveWorkers = (limit = 12) => quietly<Profile[]>('listActiveWorkers', { limit }, []);

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

export const urgentTasks = (limit = 3) => act<Task[]>('urgentTasks', { limit });
