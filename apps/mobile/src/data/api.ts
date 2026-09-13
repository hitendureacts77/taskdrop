import { supabase } from '../lib/supabase';
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

  return unwrap(await query.order('created_at', { ascending: false }).limit(input.limit ?? 30));
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
export async function getWallet(): Promise<Wallet | null> {
  const { data, error } = await supabase.from('wallets').select('*').maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Escrow currently held for this user's live assignments. It sits on the
 * assignment rather than the wallet, so it has to be summed.
 */
export async function getEscrowHeld(): Promise<number> {
  const rows = unwrap(
    await supabase.from('assignments').select('escrow_minor,status').in('status', ['assigned', 'started']),
  );
  return rows.reduce((sum, r) => sum + (r.escrow_minor ?? 0), 0);
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
export async function getProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
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
  locLabel?: string | null;
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
        loc_label: input.locLabel ?? null,
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
  /** Stamp the profile as having finished setup. */
  onboarded?: boolean;
};

/** Save the setup/profile screen's fields. RLS limits this to your own row. */
export async function updateProfile(userId: string, edits: ProfileEdits): Promise<Profile> {
  const patch: Partial<Pick<Profile, 'display_name' | 'skills' | 'loc_label' | 'onboarded_at'>> = {};
  if (edits.displayName !== undefined) patch.display_name = edits.displayName;
  if (edits.skills !== undefined) patch.skills = edits.skills;
  if (edits.locLabel !== undefined) patch.loc_label = edits.locLabel;
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
