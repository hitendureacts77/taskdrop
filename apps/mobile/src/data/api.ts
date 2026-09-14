import { supabase } from '../lib/supabase';
import { distanceKm } from '@taskdrop/rules';
import type { Tables, Enums } from '@taskdrop/db-types';

/**
 * Every database read/write the app performs.
 *
 * Reads go straight through PostgREST (row-level security decides what comes
 * back). Anything that moves money or advances the task state calls an RPC, so
 * the rules are enforced server-side rather than trusted from the client.
 */

export type Task = Tables<'tasks'>;
export type Bid = Tables<'bids'>;
export type Assignment = Tables<'assignments'>;
export type Wallet = Tables<'wallets'>;
export type Profile = Tables<'profiles'>;

function unwrap<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  if (res.data === null) throw new Error('No data returned');
  return res.data;
}

// ---------------------------------------------------------------- reads ----

/** Open tasks for the worker feed, newest first. */
export async function listOpenTasks(limit = 30): Promise<Task[]> {
  return unwrap(
    await supabase
      .from('tasks')
      .select('*')
      .eq('status', 'OPEN')
      .order('created_at', { ascending: false })
      .limit(limit),
  );
}

/** Tasks this user posted. */
export async function listMyTasks(userId: string): Promise<Task[]> {
  return unwrap(
    await supabase
      .from('tasks')
      .select('*')
      .eq('poster_id', userId)
      .order('created_at', { ascending: false }),
  );
}

/** Quotes this user sent, with the task they belong to. */
export async function listMyBids(userId: string): Promise<(Bid & { tasks: Task | null })[]> {
  return unwrap(
    await supabase
      .from('bids')
      .select('*, tasks(*)')
      .eq('worker_id', userId)
      .order('created_at', { ascending: false }),
  );
}

/** Tasks this user is assigned to (as the worker). */
export async function listMyAssignments(
  userId: string,
): Promise<(Assignment & { tasks: Task | null })[]> {
  return unwrap(
    await supabase
      .from('assignments')
      .select('*, tasks(*)')
      .eq('worker_id', userId)
      .order('created_at', { ascending: false }),
  );
}

/** Incoming quotes on a task, cheapest first. */
export async function listBidsForTask(
  taskId: string,
): Promise<(Bid & { profiles: Profile | null })[]> {
  const rows = unwrap(
    await supabase.from('bids').select('*').eq('task_id', taskId).order('price_minor'),
  );
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((b) => b.worker_id))];
  const people = unwrap(await supabase.from('profiles').select('*').in('id', ids));
  const byId = new Map(people.map((p) => [p.id, p]));
  return rows.map((b) => ({ ...b, profiles: byId.get(b.worker_id) ?? null }));
}

/** How many quotes each of these tasks has, for the poster's own list. */
export async function countBidsByTask(taskIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (taskIds.length === 0) return counts;
  const rows = unwrap(await supabase.from('bids').select('task_id').in('task_id', taskIds));
  for (const r of rows) counts.set(r.task_id, (counts.get(r.task_id) ?? 0) + 1);
  return counts;
}
export type TaskSearch = {
  q?: string;
  pillar?: Enums<'pillar'> | null;
  minMinor?: number | null;
  maxMinor?: number | null;
  limit?: number;
  /** Only tasks within radiusKm of this point. Tasks with no pin are excluded. */
  near?: { lat: number; lng: number; radiusKm: number } | null;
};

/**
 * Open tasks matching the search screen's filters. Every filter is optional —
 * an empty search is just the feed. `q` matches the title or the description.
 */
export async function searchTasks(input: TaskSearch = {}): Promise<Task[]> {
  let query = supabase.from('tasks').select('*').eq('status', 'OPEN');

  const q = input.q?.trim();
  if (q) {
    // Commas and parens would break out of PostgREST's or() filter grammar.
    const safe = q.replace(/[,()*]/g, ' ').trim();
    if (safe) query = query.or(`title.ilike.%${safe}%,description.ilike.%${safe}%`);
  }
  if (input.pillar) query = query.eq('pillar', input.pillar);
  if (typeof input.minMinor === 'number') query = query.gte('benchmark_minor', input.minMinor);
  if (typeof input.maxMinor === 'number') query = query.lte('benchmark_minor', input.maxMinor);

  const rows = unwrap(
    await query.order('created_at', { ascending: false }).limit(input.limit ?? 30),
  );

  // Distance is filtered here rather than in SQL: Postgres has no geo index on
  // this table, and the page is already capped, so a haversine over at most a
  // few dozen rows is cheaper than adding PostGIS for it. A task with no pin
  // cannot be shown to be within any radius, so it is not.
  const near = input.near;
  if (!near) return rows;
  return rows.filter((row) => {
    const km = distanceKm(
      { lat: near.lat, lng: near.lng },
      { lat: row.loc_lat, lng: row.loc_lng },
    );
    return km !== null && km <= near.radiusKm;
  });
}

export type TaskWithPoster = Task & { poster: Profile | null };

/** Attach the poster profile to a page of tasks, for feed rows that show identity. */
export async function attachPosters(tasks: Task[]): Promise<TaskWithPoster[]> {
  if (tasks.length === 0) return [];
  const ids = [...new Set(tasks.map((t) => t.poster_id))];
  const people = unwrap(await supabase.from('profiles').select('*').in('id', ids));
  const byId = new Map(people.map((x) => [x.id, x]));
  return tasks.map((t) => ({ ...t, poster: byId.get(t.poster_id) ?? null }));
}

export async function getTask(taskId: string): Promise<Task | null> {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Everything the live-task screens need about one task in a single round trip:
 * the task, the assignment holding the escrow, and the counterparty. Screens
 * were falling back to sample amounts and invented contact names because none
 * of this was fetched.
 */
export type TaskDetail = {
  task: Task;
  assignment: Assignment | null;
  poster: Profile | null;
  worker: Profile | null;
};

export async function getTaskDetail(taskId: string): Promise<TaskDetail | null> {
  const task = await getTask(taskId);
  if (!task) return null;

  const assignments = unwrap(
    await supabase
      .from('assignments')
      .select('*')
      .eq('task_id', taskId)
      .order('created_at', { ascending: false }),
  );
  // A task can carry stale holds from workers who lost the race to start.
  const assignment =
    assignments.find((a) => a.status === 'started' || a.status === 'released') ??
    assignments[0] ??
    null;

  const ids = [task.poster_id, assignment?.worker_id].filter(Boolean) as string[];
  const people = ids.length ? unwrap(await supabase.from('profiles').select('*').in('id', ids)) : [];
  const byId = new Map(people.map((p) => [p.id, p]));

  return {
    task,
    assignment,
    poster: byId.get(task.poster_id) ?? null,
    worker: assignment ? (byId.get(assignment.worker_id) ?? null) : null,
  };
}
/**
 * Who is asking.
 *
 * "My row" queries must say whose row they mean rather than leaning on RLS to
 * have filtered for them. An admin's policies deliberately match every row, so
 * a query that relies on RLS alone silently turns into "everybody's rows" the
 * moment the person running it has a staff account.
 */
async function myId(): Promise<string | null> {
  const { data } = await supabase.auth.getUser();
  return data.user?.id ?? null;
}

export async function getWallet(): Promise<Wallet | null> {
  const uid = await myId();
  if (!uid) return null;
  // Explicitly mine. Without the filter an admin matches all seven wallets,
  // maybeSingle() throws on the extra rows, and the screen quietly falls back
  // to whatever it had -- which is how a balance nobody owns ends up on screen.
  const { data, error } = await supabase
    .from('wallets')
    .select('*')
    .eq('user_id', uid)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Escrow currently held for this user's live assignments. It sits on the
 * assignment rather than the wallet, so it has to be summed.
 */
export async function getEscrowHeld(): Promise<number> {
  const uid = await myId();
  if (!uid) return 0;
  // Either side of the deal has money tied up: the worker is owed it, the
  // poster has paid it in. assignments only names the worker, so the poster
  // side comes through the task, and the pairing is decided here rather than
  // in a PostgREST filter that cannot span the join cleanly.
  const rows = unwrap(
    await supabase
      .from('assignments')
      .select('escrow_minor,status,worker_id,tasks!inner(poster_id)')
      .in('status', ['assigned', 'started']),
  );
  return rows
    .filter((r) => {
      const poster = (r.tasks as { poster_id?: string } | null)?.poster_id;
      return r.worker_id === uid || poster === uid;
    })
    .reduce((sum, r) => sum + (r.escrow_minor ?? 0), 0);
}

export type Review = Tables<'reviews'> & { author: Profile | null };

/**
 * Reviews written about someone in one role. Poster and worker reputations are
 * deliberately separate, so they are never merged.
 */
export async function listReviewsAbout(
  userId: string,
  role: Enums<'app_role'>,
  limit = 10,
): Promise<Review[]> {
  const rows = unwrap(
    await supabase
      .from('reviews')
      .select('*')
      .eq('subject_id', userId)
      .eq('about_role', role)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
  if (rows.length === 0) return [];
  const ids = [...new Set(rows.map((r) => r.author_id))];
  const people = unwrap(await supabase.from('profiles').select('*').in('id', ids));
  const byId = new Map(people.map((x) => [x.id, x]));
  return rows.map((r) => ({ ...r, author: byId.get(r.author_id) ?? null }));
}
export type PosterStats = {
  profile: Profile | null;
  requestsPosted: number;
};

/**
 * Who a poster is, as a worker sees them before quoting: their profile and how
 * many requests they have actually posted. The screen used to parse these out
 * of a display string, which meant live rows showed a dash.
 */
export async function getPosterStats(posterId: string): Promise<PosterStats> {
  const [profile, tasks] = await Promise.all([
    getProfile(posterId),
    supabase.from('tasks').select('id').eq('poster_id', posterId),
  ]);
  if (tasks.error) throw new Error(tasks.error.message);
  return { profile, requestsPosted: tasks.data?.length ?? 0 };
}

export type WalletEvent = {
  id: string;
  kind: 'released' | 'escrow' | 'clearing' | 'payout' | 'topup';
  title: string;
  meta: string;
  amountMinor: number;
  /** Positive events read as money in; the rest are holds or money out. */
  incoming: boolean;
  at: string;
};

/**
 * What actually happened to this user's money, newest first.
 *
 * Assembled from the assignments they are party to plus their payouts and
 * top-ups. The wallet screen used to show three invented rows — including a
 * "+₹3,600 payout received" to people holding ₹0 — which is the last place an
 * app should be making things up.
 */
export async function listWalletActivity(userId: string, limit = 12): Promise<WalletEvent[]> {
  const [asWorker, asPoster, payouts, payments] = await Promise.all([
    supabase.from('assignments').select('*, tasks(title)').eq('worker_id', userId),
    supabase.from('tasks').select('id,title,status,locked_minor,updated_at').eq('poster_id', userId),
    supabase.from('payouts').select('*').eq('user_id', userId),
    supabase.from('payments').select('*').eq('user_id', userId).eq('status', 'paid'),
  ]);
  for (const r of [asWorker, asPoster, payouts, payments]) {
    if (r.error) throw new Error(r.error.message);
  }

  const events: WalletEvent[] = [];

  for (const a of asWorker.data ?? []) {
    const title = (a.tasks as { title?: string } | null)?.title ?? 'Task';
    if (a.status === 'released') {
      events.push({
        id: 'w-' + a.id,
        kind: 'clearing',
        title: 'Earnings clearing',
        meta: title + ' · released to you',
        amountMinor: Math.round(a.escrow_minor / 1.03 * 0.8),
        incoming: true,
        at: a.updated_at,
      });
    } else if (a.status === 'started' || a.status === 'assigned') {
      events.push({
        id: 'w-' + a.id,
        kind: 'escrow',
        title: 'Escrow funded for you',
        meta: title + (a.status === 'started' ? ' · in progress' : ' · not started yet'),
        amountMinor: a.escrow_minor,
        incoming: false,
        at: a.updated_at,
      });
    }
  }

  for (const t of asPoster.data ?? []) {
    if (t.status === 'COMPLETED' || t.status === 'AUTO_COMPLETED') {
      events.push({
        id: 'p-' + t.id,
        kind: 'released',
        title: 'Escrow released',
        meta: t.title + ' · completed',
        amountMinor: t.locked_minor ?? 0,
        incoming: false,
        at: t.updated_at,
      });
    } else if (t.status === 'LOCKED' || t.status === 'TASK_STARTED' || t.status === 'WORK_DONE') {
      events.push({
        id: 'p-' + t.id,
        kind: 'escrow',
        title: 'Held in escrow',
        meta: t.title + ' · awaiting completion',
        amountMinor: t.locked_minor ?? 0,
        incoming: false,
        at: t.updated_at,
      });
    }
  }

  for (const o of payouts.data ?? []) {
    events.push({
      id: 'o-' + o.id,
      kind: 'payout',
      // A cancelled payout is money that came back, not money on its way out;
      // labelling it "on its way" told people their withdrawal was still live
      // after they had just taken it back.
      title:
        o.status === 'paid'
          ? 'Payout sent'
          : o.status === 'failed'
            ? 'Payout failed'
            : o.status === 'cancelled'
              ? 'Withdrawal cancelled'
              : o.status === 'processing'
                ? 'Payout on its way'
                : 'Withdrawal requested',
      meta: o.destination ?? 'To your account',
      amountMinor: o.amount_minor,
      // Cancelled and failed both put the money back in the wallet.
      incoming: o.status === 'cancelled' || o.status === 'failed',
      at: o.created_at,
    });
  }

  for (const pay of payments.data ?? []) {
    events.push({
      id: 'c-' + pay.id,
      kind: 'topup',
      title: pay.purpose === 'topup' ? 'Money added' : 'Escrow funded',
      meta: pay.provider,
      amountMinor: pay.amount_minor,
      incoming: pay.purpose === 'topup',
      at: pay.paid_at ?? pay.created_at,
    });
  }

  events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
  return events.slice(0, limit);
}

/**
 * How many things are waiting on this user right now.
 *
 * Nothing in the app told anyone that something had happened — a poster never
 * learned a quote arrived, a worker never learned they had been picked — so
 * there was no reason to come back. This is the cheap, honest version of that:
 * derived from the tables that already exist, no polling infrastructure, and it
 * only counts things the person can actually act on.
 */
export async function countNeedsAttention(
  userId: string,
  mode: 'poster' | 'worker',
): Promise<number> {
  if (mode === 'poster') {
    const mine = unwrap(
      await supabase.from('tasks').select('id,status').eq('poster_id', userId),
    );
    // Work submitted and waiting on them to release.
    let count = mine.filter((t) => t.status === 'WORK_DONE').length;

    // Quotes arrived on something still open.
    const openIds = mine.filter((t) => t.status === 'OPEN').map((t) => t.id);
    if (openIds.length > 0) {
      const counts = await countBidsByTask(openIds);
      count += openIds.filter((id) => (counts.get(id) ?? 0) > 0).length;
    }
    return count;
  }

  const assignments = unwrap(
    await supabase
      .from('assignments')
      .select('status, tasks(status)')
      .eq('worker_id', userId)
      .in('status', ['assigned', 'started']),
  );
  // Picked but not started yet is the one that actually needs them.
  return assignments.filter(
    (a) => (a.tasks as { status?: string } | null)?.status === 'LOCKED',
  ).length;
}

export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
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

/** Whether this account can see the platform's numbers at all. */
export async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('user_roles')
    .select('role')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .maybeSingle();
  if (error) return false;
  return Boolean(data);
}

/**
 * Every figure the dashboard shows, in one round trip. The server refuses
 * outright unless the caller is an admin — these numbers span every user's
 * rows, so the check cannot live in the client.
 */
export const platformStats = (days = 30) =>
  rpc<PlatformStats>('platform_stats', { p_days: days });

// -------------------------------------------------------------- messages ---

export type Message = {
  id: string;
  task_id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

/** The thread for one task, oldest first. RLS limits this to its two parties. */
export async function listMessages(taskId: string): Promise<Message[]> {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at');
  if (error) throw new Error(error.message);
  return (data ?? []) as Message[];
}

export async function sendMessage(taskId: string, senderId: string, body: string): Promise<Message> {
  const text = body.trim();
  if (!text) throw new Error('Nothing to send');
  const { data, error } = await supabase
    .from('messages')
    .insert({ task_id: taskId, sender_id: senderId, body: text })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as Message;
}

/**
 * Live updates for a task's thread. Returns an unsubscribe function; call it on
 * unmount or the channel leaks across screens.
 */
export function subscribeToMessages(taskId: string, onInsert: (m: Message) => void): () => void {
  const channel = supabase
    .channel(`messages:${taskId}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'messages', filter: `task_id=eq.${taskId}` },
      (payload) => onInsert(payload.new as Message),
    )
    .subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
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
  /** Storage path + kind for an attached photo or video, if there is one. */
  media?: { kind: 'image' | 'video'; path: string; seconds?: number } | null;
  locLabel?: string | null;
  /** Real coordinates, so distance between two people is computable. */
  locLat?: number | null;
  locLng?: number | null;
};

export async function createTask(input: NewTask): Promise<Task> {
  const rows = unwrap(
    await supabase
      .from('tasks')
      .insert({
        poster_id: input.posterId,
        pillar: input.pillar,
        title: input.title,
        description: input.description ?? '',
        benchmark_minor: input.benchmarkMinor,
        time_limit_minutes: input.timeLimitMinutes,
        flag: input.flag ?? 'none',
        media_kind: input.media?.kind ?? null,
        media_path: input.media?.path ?? null,
        media_seconds: input.media?.seconds ?? null,
        loc_label: input.locLabel ?? null,
        loc_lat: input.locLat ?? null,
        loc_lng: input.locLng ?? null,
      })
      .select(),
  );
  return rows[0]!;
}

export async function placeBid(input: {
  taskId: string;
  workerId: string;
  priceMinor: number;
  timeLimitMinutes: number;
  message?: string;
}): Promise<Bid> {
  const rows = unwrap(
    await supabase
      .from('bids')
      .insert({
        task_id: input.taskId,
        worker_id: input.workerId,
        price_minor: input.priceMinor,
        time_limit_minutes: input.timeLimitMinutes,
        message: input.message ?? null,
      })
      .select(),
  );
  return rows[0]!;
}

export type ProfileEdits = {
  displayName?: string;
  skills?: string[];
  locLabel?: string | null;
  locLat?: number | null;
  locLng?: number | null;
  /** UPI handle money is paid out to. The user owns this; never invent one. */
  payoutUpi?: string | null;
  /** Stamp the profile as having finished setup. */
  onboarded?: boolean;
};

/** Save the setup/profile screen's fields. RLS limits this to your own row. */
export async function updateProfile(userId: string, edits: ProfileEdits): Promise<Profile> {
  const patch: Partial<
    Pick<
      Profile,
      | 'display_name'
      | 'skills'
      | 'loc_label'
      | 'loc_lat'
      | 'loc_lng'
      | 'payout_upi'
      | 'onboarded_at'
    >
  > = {};
  if (edits.displayName !== undefined) patch.display_name = edits.displayName;
  if (edits.skills !== undefined) patch.skills = edits.skills;
  if (edits.locLabel !== undefined) patch.loc_label = edits.locLabel;
  if (edits.locLat !== undefined) patch.loc_lat = edits.locLat;
  if (edits.locLng !== undefined) patch.loc_lng = edits.locLng;
  if (edits.payoutUpi !== undefined) patch.payout_upi = edits.payoutUpi;
  if (edits.onboarded) patch.onboarded_at = new Date().toISOString();

  const rows = unwrap(await supabase.from('profiles').update(patch).eq('id', userId).select());
  const row = rows[0];
  if (!row) throw new Error('Could not save your profile');
  return row;
}

// ------------------------------------------------- lifecycle (server-side) --

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) throw new Error(error.message);
  return data as T;
}

/** Poster locks a quote: assignment created, escrow recorded, task LOCKED. */
export const lockBid = (bidId: string, payoutMode: Enums<'payout_mode'> = 'one_time') =>
  rpc<Task>('lock_bid', { p_bid_id: bidId, p_payout_mode: payoutMode });

/** Worker starts. First to start wins; the other holds are released. */
export const startTask = (taskId: string) => rpc<Task>('start_task', { p_task_id: taskId });

/** Worker submits the work; opens the poster's review window. */
export const markWorkDone = (taskId: string) => rpc<Task>('mark_work_done', { p_task_id: taskId });

/** Poster accepts: commission deducted, worker paid into clearing. */
export const confirmRelease = (taskId: string) =>
  rpc<Task>('confirm_release', { p_task_id: taskId });

/** Poster sends the work back. Escrow stays put; the worker gets another go. */
export const requestRevision = (taskId: string, note?: string) =>
  rpc<Task>('request_revision', { p_task_id: taskId, p_note: note?.trim() || null });

/**
 * Withdraw from a task. A poster cancelling after the worker has started pays
 * them a 5% fine; a worker stepping off hands the task back to the market
 * rather than killing it. The server decides all of that.
 */
export const cancelTask = (taskId: string, reason?: string) =>
  rpc<Task>('cancel_task', { p_task_id: taskId, p_reason: reason?.trim() || null });

/** Either side escalates. Deliberately moves no money — an admin resolves it. */
export const openDispute = (taskId: string, reason?: string) =>
  rpc<Task>('open_dispute', { p_task_id: taskId, p_reason: reason?.trim() || null });

/**
 * Rate the other side of a finished task. The server decides who the subject is
 * and recomputes their average, so neither can be forged from here.
 */
export const submitReview = (taskId: string, rating: number, comment?: string) =>
  rpc<unknown>('submit_review', {
    p_task_id: taskId,
    p_rating: rating,
    p_comment: comment?.trim() ? comment.trim() : null,
  });

/**
 * Move money out of the wallet. The debit and the payout row happen in one
 * locked transaction server-side, so a double tap can't withdraw twice.
 */
export const requestWithdrawal = (amountMinor: number, destination?: string) =>
  rpc<unknown>('request_withdrawal', {
    p_amount_minor: amountMinor,
    p_destination: destination?.trim() ? destination.trim() : null,
  });

/** A withdrawal, as the person who asked for it sees it. */
export type Payout = {
  id: string;
  amount_minor: number;
  status: 'requested' | 'processing' | 'paid' | 'failed' | 'cancelled';
  destination: string | null;
  failure_note: string | null;
  created_at: string;
  updated_at: string;
};

/** Every withdrawal this person has ever asked for, newest first. */
export async function listPayouts(limit = 20): Promise<Payout[]> {
  const uid = await myId();
  if (!uid) return [];
  const rows = unwrap(
    await supabase
      .from('payouts')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(limit),
  );
  return rows as unknown as Payout[];
}

/**
 * Take a withdrawal back while it is still only requested.
 *
 * The server decides whether that is still allowed and refunds the wallet in
 * the same locked transaction, so this cannot be raced into a double refund.
 */
export const cancelWithdrawal = (payoutId: string) =>
  rpc<unknown>('cancel_withdrawal', { p_payout_id: payoutId });

// ----------------------------------------------------------------- admin ---

export type AdminPayout = Payout & { profile: Profile | null };

/** Everything waiting to be sent, oldest first: a queue, so work it in order. */
export async function adminPayoutQueue(): Promise<AdminPayout[]> {
  const rows = unwrap(
    await supabase
      .from('payouts')
      .select('*')
      .in('status', ['requested', 'processing'])
      .order('created_at', { ascending: true })
      .limit(100),
  );
  const ids = [...new Set(rows.map((r) => r.user_id))];
  const people = ids.length
    ? unwrap(await supabase.from('profiles').select('*').in('id', ids))
    : [];
  const byId = new Map(people.map((x) => [x.id, x]));
  return rows.map((r) => ({
    ...(r as unknown as Payout),
    profile: byId.get(r.user_id) ?? null,
  }));
}

/** Move a payout on, or fail it (which refunds the wallet). */
export const adminMarkPayout = (
  payoutId: string,
  status: 'processing' | 'paid' | 'failed',
  note?: string,
) =>
  rpc<Payout>('admin_mark_payout', {
    p_payout_id: payoutId,
    p_status: status,
    p_note: note?.trim() ? note.trim() : null,
  });

export type AdminDispute = {
  id: string;
  title: string;
  locked_minor: number | null;
  updated_at: string;
  poster: Profile | null;
};

/** Tasks frozen in dispute, waiting on a decision. */
export async function adminDisputes(): Promise<AdminDispute[]> {
  const rows = unwrap(
    await supabase
      .from('tasks')
      .select('id,title,locked_minor,updated_at,poster_id')
      .eq('status', 'DISPUTED')
      .order('updated_at', { ascending: true })
      .limit(50),
  );
  const ids = [...new Set(rows.map((r) => r.poster_id))];
  const people = ids.length
    ? unwrap(await supabase.from('profiles').select('*').in('id', ids))
    : [];
  const byId = new Map(people.map((x) => [x.id, x]));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    locked_minor: r.locked_minor,
    updated_at: r.updated_at,
    poster: byId.get(r.poster_id) ?? null,
  }));
}

/** Settle a dispute for one side. The only way escrow moves once frozen. */
export const adminResolveDispute = (
  taskId: string,
  outcome: 'worker' | 'poster',
  note?: string,
) =>
  rpc<unknown>('admin_resolve_dispute', {
    p_task_id: taskId,
    p_outcome: outcome,
    p_note: note?.trim() ? note.trim() : null,
  });

/**
 * Move every earning past its clearing period into the spendable balance.
 * Returns how many tasks were settled.
 */
export const settleClearedEarnings = () => rpc<number>('settle_cleared_earnings', {});

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

/** Open a campaign. It stays pending until its payment settles. */
export const startPromotion = (taskId: string, days: number, amountMinor: number) =>
  rpc<Promotion>('start_promotion', {
    p_task_id: taskId,
    p_days: days,
    p_amount_minor: amountMinor,
  });

/** Turn a paid campaign on. The server checks the payment really settled. */
export const activatePromotion = (promotionId: string, paymentId: string) =>
  rpc<Promotion>('activate_promotion', {
    p_promotion_id: promotionId,
    p_payment_id: paymentId,
  });

export const cancelPromotion = (promotionId: string) =>
  rpc<Promotion>('cancel_promotion', { p_promotion_id: promotionId });

/** This user's campaigns, newest first. */
export async function listPromotions(): Promise<Promotion[]> {
  const uid = await myId();
  if (!uid) return [];
  const rows = unwrap(
    await supabase
      .from('task_promotions')
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: false })
      .limit(20),
  );
  return rows as unknown as Promotion[];
}

/** Task ids that are sponsored right now, for marking feed cards. */
export async function sponsoredTaskIds(): Promise<Set<string>> {
  const { data, error } = await supabase.from('sponsored_tasks').select('task_id');
  if (error) return new Set();
  return new Set((data ?? []).map((r) => (r as { task_id: string }).task_id));
}

// -------------------------------------------------------------- payments ---

export type PaymentLink = { paymentId: string; url: string };

/**
 * supabase-js turns any non-2xx from an Edge Function into the unhelpful
 * "Edge Function returned a non-2xx status code" and hides the body on
 * `error.context`. Our functions always answer with `{ error: "..." }`, so dig
 * that out and show the real reason instead.
 */
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
  return new Error(error instanceof Error ? error.message : fallback);
}

/**
 * Open a Razorpay payment link to fund a task's escrow or top up the wallet.
 * Payment Links are used so the same flow works on web and in Expo Go without
 * a native SDK. Throws a readable error if Razorpay keys aren't configured.
 */
export async function createPaymentLink(input: {
  purpose: 'escrow' | 'topup';
  amountMinor: number;
  taskId?: string | null;
  returnUrl?: string;
}): Promise<PaymentLink> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    body: { action: 'create-link', ...input },
  });
  if (error) throw await functionError(error, 'Could not start the payment');
  const out = data as { paymentId?: string; url?: string; error?: string };
  if (out.error) throw new Error(out.error);
  if (!out.paymentId || !out.url) throw new Error('Could not start the payment');
  return { paymentId: out.paymentId, url: out.url };
}

/** Re-check a payment with Razorpay and settle our side of it. */
export async function syncPayment(paymentId: string): Promise<'created' | 'paid' | 'cancelled'> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    body: { action: 'sync', paymentId },
  });
  if (error) throw await functionError(error, 'Could not check the payment');
  const out = data as { status?: string; error?: string };
  if (out.error) throw new Error(out.error);
  return (out.status as 'created' | 'paid' | 'cancelled') ?? 'created';
}
