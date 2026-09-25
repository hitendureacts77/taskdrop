import { currentUserId, supabase } from '../lib/supabase';
import { distanceKm } from '@taskdrop/rules';
import type { Tables, TablesUpdate } from '@taskdrop/db-types';
import { primeProfile, type Task, type Profile } from './api';

/**
 * Reads and writes for the second-wave features: notifications, saved tasks,
 * help & support, feedback, referrals, explore / trending, public profiles,
 * the AI meter, presence and "go live".
 *
 * Same rules as api.ts: reads go through PostgREST and row-level security,
 * anything that changes state for someone else goes through an RPC that
 * checks the caller server-side (migration 048).
 */

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error('No data returned');
  return res.data;
}

const myId = currentUserId;

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  // Every function here needs a signed-in caller; asking without one is a
  // guaranteed 401 and a wasted round trip.
  if (!(await myId())) throw new Error('Sign in first');
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

// ------------------------------------------------------------ notifications --

export type Notification = Tables<'notifications'>;

export async function listNotifications(limit = 50): Promise<Notification[]> {
  const uid = await myId();
  if (!uid) return [];
  return unwrap(
    await supabase
      .from('notifications')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

export async function countUnreadNotifications(): Promise<number> {
  const uid = await myId();
  if (!uid) return 0;
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', uid)
    .is('read_at', null);
  if (error) return 0;
  return count ?? 0;
}

export async function markNotificationsRead(ids?: string[]): Promise<void> {
  const uid = await myId();
  if (!uid) return;
  let q = supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', uid).is('read_at', null);
  if (ids && ids.length) q = q.in('id', ids);
  const { error } = await q;
  if (error) throw new Error(error.message);
}

let notifChannelSeq = 0;

/**
 * New rows for this user, live. Returns an unsubscribe function.
 *
 * Each subscriber gets its own channel: supabase-js hands back the existing
 * channel for a repeated name, and the header, the bell screen and the push
 * bridge all listen at once.
 */
export function subscribeToNotifications(userId: string, onInsert: (n: Notification) => void): () => void {
  const channel = supabase
    .channel(`notifications:${userId}:${++notifChannelSeq}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      (payload) => onInsert(payload.new as Notification),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}

// ------------------------------------------------------------- saved tasks --

export async function listSavedTaskIds(): Promise<Set<string>> {
  const uid = await myId();
  if (!uid) return new Set();
  const rows = unwrap(await supabase.from('saved_tasks').select('task_id').eq('user_id', uid));
  return new Set(rows.map((r) => r.task_id));
}

/** Saved tasks that are still visible to this user (open, or theirs). */
export async function listSavedTasks(): Promise<Task[]> {
  const uid = await myId();
  if (!uid) return [];
  const rows = unwrap(
    await supabase
      .from('saved_tasks')
      .select('task_id, created_at, tasks(*)')
      .eq('user_id', uid)
      .order('created_at', { ascending: false }),
  );
  return rows.map((r) => r.tasks as Task | null).filter((x): x is Task => Boolean(x));
}

export async function setSaved(taskId: string, saved: boolean): Promise<void> {
  const uid = await myId();
  if (!uid) throw new Error('Sign in to save tasks');
  if (saved) {
    const { error } = await supabase.from('saved_tasks').upsert({ user_id: uid, task_id: taskId });
    if (error) throw new Error(error.message);
  } else {
    const { error } = await supabase.from('saved_tasks').delete().eq('user_id', uid).eq('task_id', taskId);
    if (error) throw new Error(error.message);
  }
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

export async function listTickets(): Promise<Ticket[]> {
  const uid = await myId();
  if (!uid) return [];
  return unwrap(
    await supabase.from('support_tickets').select('*').eq('user_id', uid).order('updated_at', { ascending: false }),
  );
}

export async function getTicket(id: string): Promise<{ ticket: Ticket; messages: TicketMessage[] } | null> {
  const { data: ticket, error } = await supabase.from('support_tickets').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!ticket) return null;
  const messages = unwrap(
    await supabase.from('support_messages').select('*').eq('ticket_id', id).order('created_at'),
  );
  return { ticket, messages };
}

export const openTicket = (category: TicketCategory, body: string, page?: string) =>
  rpc<Ticket>('open_support_ticket', { p_category: category, p_body: body, p_page: page ?? null });

export const replyTicket = (ticketId: string, body: string) =>
  rpc<TicketMessage>('reply_support_ticket', { p_ticket_id: ticketId, p_body: body });

export const resolveTicket = (ticketId: string) =>
  rpc<Ticket>('resolve_support_ticket', { p_ticket_id: ticketId });

// ---------------------------------------------------------------- feedback --

export type FeedbackKind = 'broken' | 'idea' | 'confusing' | 'praise';

export async function sendFeedback(kind: FeedbackKind, body: string, page?: string): Promise<void> {
  const uid = await myId();
  if (!uid) throw new Error('Sign in to send feedback');
  const text = body.trim();
  if (text.length < 3) throw new Error('Write a little more first');
  const { error } = await supabase.from('feedback').insert({ user_id: uid, kind, body: text, page: page ?? null });
  if (error) throw new Error(error.message);
}

// --------------------------------------------------------------- referrals --

export const applyReferralCode = (code: string) => rpc<boolean>('apply_referral_code', { p_code: code });

/** How many people joined with this user's code. */
export async function countMyReferrals(): Promise<number> {
  const uid = await myId();
  if (!uid) return 0;
  const { count, error } = await supabase
    .from('referrals')
    .select('referred_id', { count: 'exact', head: true })
    .eq('referrer_id', uid);
  if (error) return 0;
  return count ?? 0;
}

// ------------------------------------------------------- explore / trending --

export type Highlights = {
  activeNow: number;
  activeToday: number;
  openTasks: number;
  completedToday: number;
  liveWorkers: number;
};

export const platformHighlights = () => rpc<Highlights>('platform_highlights');

export type TrendingCategory = {
  category: string;
  open_count: number;
  recent_count: number;
  avg_budget_minor: number;
};

export const trendingCategories = (limit = 8) =>
  rpc<TrendingCategory[]>('trending_categories', { p_limit: limit });

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

export const topEarners = (kind: EarnerKind, limit = 10) =>
  rpc<Earner[]>('top_earners', { p_kind: kind, p_limit: limit });

export type PublicStats = { jobsDone: number; tasksPosted: number; tasksCompletedAsPoster: number };
export const publicProfileStats = (userId: string) =>
  rpc<PublicStats>('public_profile_stats', { p_user: userId });

/**
 * Open tasks in the categories this worker has skills for. Skills are free
 * text on the profile, so the match is loose: a task counts if its category,
 * skills or title mention any of the worker's skills.
 */
export async function recommendedTasks(skills: string[], limit = 10): Promise<Task[]> {
  const uid = await myId();
  let q = supabase.from('tasks').select('*').eq('status', 'OPEN').eq('kind', 'request');
  if (uid) q = q.neq('poster_id', uid);
  const rows = unwrap(await q.order('created_at', { ascending: false }).limit(60));
  if (skills.length === 0) return rows.slice(0, limit);
  const needles = skills.map((s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
  const score = (task: Task) => {
    const hay = [task.title, task.category ?? '', (task.skills ?? []).join(' '), task.description]
      .join(' ')
      .toLowerCase()
      .replace(/_/g, ' ');
    return needles.reduce((n, s) => n + (hay.includes(s) ? 1 : 0), 0);
  };
  return rows
    .map((task) => ({ task, s: score(task) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.task)
    .slice(0, limit);
}

// ----------------------------------------------------------------- inbox ----

export type Thread = {
  taskId: string;
  title: string;
  lastBody: string;
  lastAt: string;
  lastFromMe: boolean;
  status: string;
};

/**
 * Every task conversation this user is part of, newest first. RLS already
 * limits messages to the two parties, so reading the latest page and grouping
 * by task is enough.
 */
export async function listThreads(): Promise<Thread[]> {
  const uid = await myId();
  if (!uid) return [];
  const rows = unwrap(
    await supabase.from('messages').select('*').order('created_at', { ascending: false }).limit(300),
  );
  const latest = new Map<string, (typeof rows)[number]>();
  for (const m of rows) if (!latest.has(m.task_id)) latest.set(m.task_id, m);
  if (latest.size === 0) return [];
  const tasks = unwrap(
    await supabase.from('tasks').select('id,title,status').in('id', [...latest.keys()]),
  );
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return [...latest.values()].map((m) => ({
    taskId: m.task_id,
    title: byId.get(m.task_id)?.title ?? 'Task',
    status: byId.get(m.task_id)?.status ?? '',
    lastBody: m.body,
    lastAt: m.created_at,
    lastFromMe: m.sender_id === uid,
  }));
}

// ---------------------------------------------------------------- disputes --

/** Tasks this person is party to that are, or were, in dispute. */
export async function listMyDisputes(): Promise<Task[]> {
  const uid = await myId();
  if (!uid) return [];
  const [mine, worked] = await Promise.all([
    supabase.from('tasks').select('*').eq('poster_id', uid).eq('status', 'DISPUTED'),
    supabase.from('assignments').select('tasks(*)').eq('worker_id', uid),
  ]);
  if (mine.error) throw new Error(mine.error.message);
  if (worked.error) throw new Error(worked.error.message);
  const asWorker = (worked.data ?? [])
    .map((r) => r.tasks as Task | null)
    .filter((x): x is Task => Boolean(x) && x!.status === 'DISPUTED');
  const all = [...(mine.data ?? []), ...asWorker];
  const seen = new Set<string>();
  return all.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

// ------------------------------------------------------ profile & presence --

/** Is this @handle free? Case-folded, same rule as the database check. */
export async function usernameAvailable(username: string): Promise<boolean> {
  const handle = username.trim().toLowerCase();
  if (!/^[a-z0-9_]{3,20}$/.test(handle)) return false;
  const uid = await myId();
  const { data, error } = await supabase.from('profiles').select('id').eq('username', handle).maybeSingle();
  if (error) return false;
  return !data || data.id === uid;
}

export type ProfileExtras = {
  username?: string | null;
  bio?: string | null;
  languages?: string[];
  intent?: 'post' | 'earn' | 'both' | null;
};

export async function updateProfileExtras(userId: string, edits: ProfileExtras): Promise<Profile> {
  const patch: TablesUpdate<'profiles'> = {};
  if (edits.username !== undefined) patch.username = edits.username ? edits.username.trim().toLowerCase() : null;
  if (edits.bio !== undefined) patch.bio = edits.bio?.trim() || null;
  if (edits.languages !== undefined) patch.languages = edits.languages;
  if (edits.intent !== undefined) patch.intent = edits.intent;
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', userId).select();
  if (error) {
    if (/profiles_username_key|duplicate/i.test(error.message)) throw new Error('That username is taken');
    if (/profiles_username_format/i.test(error.message)) {
      throw new Error('Usernames are 3–20 characters: lowercase letters, numbers and _');
    }
    throw new Error(error.message);
  }
  const row = (data ?? [])[0];
  if (!row) throw new Error('Could not save your profile');
  primeProfile(row);
  return row;
}

let lastPresence = 0;

/**
 * Record that this person has TaskDrop open. Called about once a minute while
 * the app is in front (PresenceBeat); anything closer together than 45s is
 * skipped. Best-effort; never throws.
 */
export async function touchPresence(userId: string): Promise<void> {
  if (Date.now() - lastPresence < 45_000) return;
  lastPresence = Date.now();
  try {
    await supabase.from('profiles').update({ last_seen_at: new Date().toISOString() }).eq('id', userId);
  } catch {
    /* presence is a nicety */
  }
}

/**
 * Workers who have been around lately, most recently active first: the ones
 * with TaskDrop open now at the top, then those who stepped away within the
 * last half hour. Only people who offer work (skills set). The caller is left
 * out so nobody sees themselves.
 */
export async function listActiveWorkers(limit = 12): Promise<Profile[]> {
  const uid = await myId();
  let q = supabase
    .from('profiles')
    .select('*')
    .gt('last_seen_at', new Date(Date.now() - 30 * 60_000).toISOString())
    .not('onboarded_at', 'is', null)
    .neq('skills', []);
  if (uid) q = q.neq('id', uid);
  const { data, error } = await q.order('last_seen_at', { ascending: false }).limit(limit);
  if (error) return [];
  return data ?? [];
}

// ------------------------------------------------------------------ fees -----

export type Fees = { commission: number; posterFee: number; aiDaily: number; clearingDays: number };

/** The live fee settings (readable by any signed-in user), with the
 *  @taskdrop/rules defaults if a key is missing. */
export async function platformFees(): Promise<Fees> {
  const { data } = await supabase
    .from('settings')
    .select('key,value')
    .in('key', ['worker_commission_pct', 'poster_service_fee_pct', 'ai_daily_credits', 'clearing_period_days']);
  const get = (k: string, d: number) => {
    const v = Number((data ?? []).find((r) => r.key === k)?.value);
    return Number.isFinite(v) ? v : d;
  };
  return {
    commission: get('worker_commission_pct', 0.2),
    posterFee: get('poster_service_fee_pct', 0.03),
    aiDaily: get('ai_daily_credits', 10),
    clearingDays: get('clearing_period_days', 7),
  };
}

/**
 * Platform fees this person actually paid since `since`: the poster service
 * fee is what escrow held above the accepted quote on tasks they funded, and
 * the worker commission is the share of each completed job kept by TaskDrop.
 * Both come from the rows that moved the money, not from a percentage guess.
 */
export async function feesSince(since: Date | null, commission: number): Promise<{ serviceMinor: number; commissionMinor: number }> {
  const uid = await myId();
  if (!uid) return { serviceMinor: 0, commissionMinor: 0 };
  const iso = since?.toISOString() ?? '1970-01-01T00:00:00Z';
  const [posted, worked] = await Promise.all([
    supabase
      .from('tasks')
      .select('id, locked_minor, funded_at, assignments(escrow_minor)')
      .eq('poster_id', uid)
      .not('funded_at', 'is', null)
      .gte('funded_at', iso),
    supabase
      .from('assignments')
      .select('worker_id, tasks!inner(locked_minor, status, completed_at)')
      .eq('worker_id', uid),
  ]);
  let serviceMinor = 0;
  for (const t of posted.data ?? []) {
    const escrows = (t.assignments as { escrow_minor: number }[] | null) ?? [];
    const held = Math.max(0, ...escrows.map((a) => a.escrow_minor));
    serviceMinor += Math.max(0, held - (t.locked_minor ?? 0));
  }
  let commissionMinor = 0;
  for (const a of worked.data ?? []) {
    const t = a.tasks as { locked_minor: number | null; status: string; completed_at: string | null } | null;
    if (!t || !['COMPLETED', 'AUTO_COMPLETED'].includes(t.status)) continue;
    if (t.completed_at && t.completed_at < iso) continue;
    commissionMinor += Math.round((t.locked_minor ?? 0) * commission);
  }
  return { serviceMinor, commissionMinor };
}

// ------------------------------------------------------------ AI meter -------

/** Credits used today (IST) and the daily allowance. */
export async function aiCreditsToday(): Promise<{ used: number; limit: number }> {
  const uid = await myId();
  const limitRow = await supabase.from('settings').select('value').eq('key', 'ai_daily_credits').maybeSingle();
  const limit = Number(limitRow.data?.value ?? 10) || 10;
  if (!uid) return { used: 0, limit };
  const day = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
  const { data } = await supabase.from('ai_usage').select('used').eq('user_id', uid).eq('day', day).maybeSingle();
  return { used: data?.used ?? 0, limit };
}

// ---------------------------------------------------------- password auth ---

const PW_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/password-auth`;

/** Sign in with @username + password (see the password-auth function). */
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
  if (error) throw new Error(error.message);
}

/** Set or change the password for username sign-in. */
export async function setPassword(password: string): Promise<void> {
  if (password.length < 8) throw new Error('Use at least 8 characters');
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}

/** Which sign-in methods this account has. Phone accounts sit on a
 *  placeholder email, so the provider tells us what is verified. */
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

/**
 * Open requests that can be done from anywhere: posted as "Remote", or with no
 * pin at all. Newest first, never your own.
 */
export async function remoteTasks(limit = 5): Promise<Task[]> {
  const uid = await myId();
  let q = supabase
    .from('tasks')
    .select('*')
    .eq('status', 'OPEN')
    .eq('kind', 'request')
    .is('loc_lat', null);
  if (uid) q = q.neq('poster_id', uid);
  return unwrap(await q.order('created_at', { ascending: false }).limit(limit));
}

/** Open, pinned requests closest to a point, within a radius, nearest first. */
export async function tasksNear(near: { lat: number; lng: number }, radiusKm: number, limit = 5): Promise<(Task & { km: number })[]> {
  const uid = await myId();
  let q = supabase
    .from('tasks')
    .select('*')
    .eq('status', 'OPEN')
    .eq('kind', 'request')
    .not('loc_lat', 'is', null);
  if (uid) q = q.neq('poster_id', uid);
  const rows = unwrap(await q.order('created_at', { ascending: false }).limit(200));
  return rows
    .map((task) => ({ ...task, km: distanceKm(near, { lat: task.loc_lat, lng: task.loc_lng }) ?? Infinity }))
    .filter((x) => x.km <= radiusKm)
    .sort((a, b) => a.km - b.km)
    .slice(0, limit);
}

/** Open requests flagged urgent, soonest deadline first. */
export async function urgentTasks(limit = 3): Promise<Task[]> {
  const uid = await myId();
  let q = supabase.from('tasks').select('*').eq('status', 'OPEN').eq('kind', 'request').eq('flag', 'urgent');
  if (uid) q = q.neq('poster_id', uid);
  return unwrap(await q.order('due_at', { ascending: true, nullsFirst: false }).limit(limit));
}
