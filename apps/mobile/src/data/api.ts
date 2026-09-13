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

export async function getTask(taskId: string): Promise<Task | null> {
  const { data, error } = await supabase.from('tasks').select('*').eq('id', taskId).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
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

// -------------------------------------------------------------- payments ---

export type PaymentLink = { paymentId: string; url: string };

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
  if (error) {
    const detail = (data as { error?: string } | null)?.error;
    throw new Error(detail ?? error.message);
  }
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
  if (error) throw new Error(error.message);
  const out = data as { status?: string; error?: string };
  if (out.error) throw new Error(out.error);
  return (out.status as 'created' | 'paid' | 'cancelled') ?? 'created';
}
