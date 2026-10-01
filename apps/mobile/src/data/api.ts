import { currentUserId, notExpired, supabase } from '../lib/supabase';
import { FEES, distanceKm, workerNetPayout } from '@taskdrop/rules';
import type { Tables, TablesInsert, Enums } from '@taskdrop/db-types';

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

/**
 * What a post is: a poster's request for work, or a worker's listed service.
 * Each side browses the other side's posts -- workers see requests, posters
 * see services (migration 050).
 */
export type TaskKind = 'request' | 'service';

/** The kind of post each mode browses. */
export const kindFor = (mode: 'worker' | 'poster'): TaskKind => (mode === 'worker' ? 'request' : 'service');

/** Open posts of one kind, newest first. */
export async function listOpenTasks(limit = 30, kind: TaskKind = 'request'): Promise<Task[]> {
  const uid = await myId();
  let query = supabase.from('tasks').select('*').eq('status', 'OPEN').or(notExpired()).eq('kind', kind);
  // Your own request is not something you can take on, so it does not belong
  // in a feed of work to take on. Leaving it in was how a poster ended up
  // pressing "Send a quote" on himself and meeting a policy error.
  if (uid) query = query.neq('poster_id', uid);
  return unwrap(await query.order('created_at', { ascending: false }).limit(limit));
}

/** Posts this user made: their requests, or (with 'service') their listings. */
export async function listMyTasks(userId: string, kind: TaskKind = 'request'): Promise<Task[]> {
  return unwrap(
    await supabase
      .from('tasks')
      .select('*')
      .eq('poster_id', userId)
      .eq('kind', kind)
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
  /** Which side's posts: requests (what workers browse) or services. */
  kind?: TaskKind;
  /** Only tasks within radiusKm of this point. Tasks with no pin are excluded. */
  near?: { lat: number; lng: number; radiusKm: number } | null;
};

/**
 * Open tasks matching the search screen's filters. Every filter is optional —
 * an empty search is just the feed. `q` matches the title or the description.
 */
export async function searchTasks(input: TaskSearch = {}): Promise<Task[]> {
  const uid = await myId();
  let query = supabase.from('tasks').select('*').eq('status', 'OPEN').or(notExpired()).eq('kind', input.kind ?? 'request');
  // Same reason as listOpenTasks: browse and search show work you could take,
  // and your own request is never that.
  if (uid) query = query.neq('poster_id', uid);

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
const myId = currentUserId;

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
/** Escrow tied up in live jobs. With a side, only that side: what a poster
 *  has paid in, or what a worker is owed. */
export async function getEscrowHeld(side?: 'poster' | 'worker'): Promise<number> {
  const uid = await myId();
  if (!uid) return 0;
  // Either side of the deal has money tied up: the worker is owed it, the
  // poster has paid it in. assignments only names the worker, so the poster
  // side comes through the task, and the pairing is decided here rather than
  // in a PostgREST filter that cannot span the join cleanly.
  const rows = unwrap(
    await supabase
      .from('assignments')
      .select('escrow_minor,status,worker_id,tasks!inner(poster_id,funded_at)')
      .in('status', ['assigned', 'started']),
  );
  return rows
    .filter((r) => {
      const task = r.tasks as { poster_id?: string; funded_at?: string | null } | null;
      // A job locked but not paid for holds no money.
      if (!task?.funded_at) return false;
      const poster = task.poster_id;
      if (side === 'poster') return poster === uid;
      if (side === 'worker') return r.worker_id === uid;
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
  /** 'incoming' is a worker's job in progress -- money on its way to them.
   *  'escrow' and 'released' are a poster's holds and payments. Kept apart so
   *  each side's wallet shows only its own money. */
  kind: 'released' | 'escrow' | 'incoming' | 'clearing' | 'payout' | 'topup';
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
/** A task whose money is locked: chosen and paid for, but not yet finished. */
const IN_PROGRESS = new Set(['LOCKED', 'TASK_STARTED', 'OVERDUE', 'WORK_DONE', 'REVISION_REQUESTED', 'DISPUTED']);

export async function listWalletActivity(userId: string, limit = 12): Promise<WalletEvent[]> {
  const [asWorker, asPoster, payouts, payments] = await Promise.all([
    supabase.from('assignments').select('*, tasks(title)').eq('worker_id', userId),
    supabase
      .from('tasks')
      .select('id,title,status,locked_minor,updated_at,funded_at,funded_minor,wallet_refunded_at,assignments(escrow_minor)')
      .eq('poster_id', userId),
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
        title: 'Earned',
        meta: title + ' · added to your wallet',
        amountMinor: workerNetPayout(Math.round(a.escrow_minor / (1 + FEES.POSTER_SERVICE_FEE_PCT))),
        incoming: true,
        at: a.updated_at,
      });
    } else if (a.status === 'started' || a.status === 'assigned') {
      events.push({
        id: 'w-' + a.id,
        kind: 'incoming',
        title: 'Coming to you',
        meta: title + (a.status === 'started' ? ' · in progress' : ' · not started yet'),
        // What reaches them once it's approved: the price, less commission.
        amountMinor: workerNetPayout(Math.round(a.escrow_minor / (1 + FEES.POSTER_SERVICE_FEE_PCT))),
        incoming: false,
        at: a.updated_at,
      });
    }
  }

  for (const t of asPoster.data ?? []) {
    // What the poster actually paid in: the price plus the service fee, as
    // held on the assignment. Showing the bare price here disagreed with the
    // "held" figure at the top of the wallet (₹700 here, ₹721 there).
    const escrows = (t.assignments as { escrow_minor: number }[] | null) ?? [];
    const paidMinor =
      t.funded_minor ?? (escrows.length ? Math.max(...escrows.map((a) => a.escrow_minor)) : (t.locked_minor ?? 0));
    // Only money actually paid in counts: a job locked but not yet paid for
    // has taken nothing from anyone.
    if (!t.funded_at && !t.wallet_refunded_at) continue;
    if (t.status === 'COMPLETED' || t.status === 'AUTO_COMPLETED') {
      events.push({
        id: 'p-' + t.id,
        kind: 'released',
        title: 'Paid to worker',
        meta: t.title + ' · completed',
        amountMinor: paidMinor,
        incoming: false,
        at: t.updated_at,
      });
    } else if (IN_PROGRESS.has(t.status)) {
      events.push({
        id: 'p-' + t.id,
        kind: 'escrow',
        title: 'Locked in a task',
        meta: t.title + ' · can’t be withdrawn until it’s done',
        amountMinor: paidMinor,
        incoming: false,
        at: t.updated_at,
      });
    } else if (t.status === 'CANCELLED' && t.wallet_refunded_at) {
      events.push({
        id: 'r-' + t.id,
        kind: 'topup',
        title: 'Returned to your wallet',
        meta: t.title + ' · not completed, full refund',
        amountMinor: paidMinor,
        incoming: true,
        at: t.wallet_refunded_at,
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
          ? 'Sent to your bank'
          : o.status === 'failed'
            ? 'Transfer failed'
            : o.status === 'cancelled'
              ? 'Withdrawal cancelled'
              : o.status === 'processing'
                ? 'Transfer on its way'
                : (o.destination ?? '').includes('@')
                  ? 'Withdrawal request via UPI'
                  : 'Withdrawal requested',
      meta: o.destination ?? 'To your account',
      amountMinor: o.amount_minor,
      // Cancelled and failed both put the money back in the wallet.
      incoming: o.status === 'cancelled' || o.status === 'failed',
      at: o.created_at,
    });
  }

  for (const pay of payments.data ?? []) {
    // An escrow payment is already on the list as that task's "Held in
    // escrow" / "Escrow released"; only top-ups are their own event.
    if (pay.purpose !== 'topup') continue;
    events.push({
      id: 'c-' + pay.id,
      kind: 'topup',
      title: 'Deposit via Razorpay',
      meta: 'Added to your wallet',
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

/**
 * Profiles are read by the header, the home sections, explore, the wallet and
 * more, often for the same person within the same second. They are kept for a
 * short while and concurrent reads share one request; every write in the app
 * primes or clears the entry, so an edit is never shown stale.
 */
const PROFILE_TTL_MS = 20_000;
const profileCache = new Map<string, { at: number; p: Promise<Profile | null> }>();

export function getProfile(userId: string, opts: { fresh?: boolean } = {}): Promise<Profile | null> {
  const hit = profileCache.get(userId);
  if (!opts.fresh && hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.p;
  const p = (async () => {
    const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data;
  })();
  profileCache.set(userId, { at: Date.now(), p });
  // A failed read must not be served from the cache.
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
 * Where a freshly-signed-in user should land: setup for a first run, home for
 * a returning one. Shared by every sign-in path (phone OTP, Google) so they
 * agree on what "first run" means. An unreadable profile is treated as first
 * run rather than thrown, since the trigger that creates it can lag the
 * client by a beat.
 */
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
 * The other side's phone number on one of my tasks, for the call button.
 * The server only answers once the work has started, and only to the poster
 * or the hired worker; a Google-only account has no number (null).
 */
export async function taskContactPhone(taskId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('task_contact_phone' as never, { p_task_id: taskId } as never);
  if (error) throw new Error(error.message);
  return typeof data === 'string' && data ? data : null;
}

/** Chat photos travel as an ordinary message whose body is this marker + a storage path. */
export const CHAT_MEDIA_PREFIX = '::media::';

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
  /** What the brief writer decided (migration 048). All optional. */
  category?: string | null;
  skills?: string[];
  difficulty?: 'easy' | 'medium' | 'hard' | null;
  /** 'auto' locks the first quote at or under the budget without asking. */
  assignmentMode?: 'bids' | 'auto';
  dueAt?: string | null;
  milestones?: { title: string; pct: number }[];
  /** A poster's request (the default) or a worker's service listing. */
  kind?: TaskKind;
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
        category: input.category ?? null,
        skills: input.skills ?? [],
        difficulty: input.difficulty ?? null,
        assignment_mode: input.assignmentMode ?? 'bids',
        due_at: input.dueAt ?? null,
        milestones: input.milestones ?? [],
        kind: input.kind ?? 'request',
      })
      .select(),
  );
  return rows[0]!;
}

/**
 * Turn a database refusal into something a person can act on.
 *
 * RLS answers "new row violates row-level security policy for table bids",
 * which is true, unhelpful, and alarming. The policy has three conditions and
 * each one means something different to the person who just tapped a button.
 */
function quoteRefusalMessage(raw: string): string {
  if (/duplicate|unique/i.test(raw)) return 'You have already sent an offer for this task';
  if (/row-level security|violates.*policy/i.test(raw)) {
    return 'You cannot send an offer for this one — it is either your own request, or it is no longer open.';
  }
  return raw;
}

export async function placeBid(input: {
  taskId: string;
  workerId: string;
  priceMinor: number;
  timeLimitMinutes: number;
  message?: string;
}): Promise<Bid> {
  const { data, error } = await supabase
    .from('bids')
    .insert({
      task_id: input.taskId,
      worker_id: input.workerId,
      price_minor: input.priceMinor,
      time_limit_minutes: input.timeLimitMinutes,
      message: input.message ?? null,
    })
    .select();
  // Translated here rather than at each call site, so every screen that places
  // a bid gets the same sentence instead of raw Postgres.
  if (error) throw new Error(quoteRefusalMessage(error.message));
  return (data ?? [])[0]!;
}

/** This worker's own quote on a task, if they sent one. */
export async function getMyBid(taskId: string, userId: string): Promise<Bid | null> {
  const { data, error } = await supabase
    .from('bids')
    .select('*')
    .eq('task_id', taskId)
    .eq('worker_id', userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

/**
 * Change a quote already sent. The bids_update_own policy only lets a worker
 * touch their own quote while it is not locked, so a quote the poster has
 * accepted can no longer be edited from here.
 */
export async function updateBid(
  bidId: string,
  edits: { priceMinor: number; timeLimitMinutes: number; message: string | null },
): Promise<Bid> {
  const { data, error } = await supabase
    .from('bids')
    .update({
      price_minor: edits.priceMinor,
      time_limit_minutes: edits.timeLimitMinutes,
      message: edits.message,
    })
    .eq('id', bidId)
    .eq('is_locked', false)
    .select();
  if (error) throw new Error(quoteRefusalMessage(error.message));
  const row = (data ?? [])[0];
  if (!row) throw new Error('This offer was already accepted, so it can no longer be changed');
  return row;
}

/**
 * Whether this person may quote on this task, and why not when they may not.
 *
 * The same three conditions the RLS policy checks, asked before the button is
 * offered rather than after it is pressed. A refusal a user could have been
 * told about in advance should never arrive as an error.
 */
export type QuoteVerdict =
  | { allowed: true }
  | { allowed: false; code: 'own' | 'closed' | 'duplicate'; reason: string };

export async function canQuoteOn(taskId: string, userId: string): Promise<QuoteVerdict> {
  const { data, error } = await supabase
    .from('tasks')
    .select('poster_id,status,kind')
    .eq('id', taskId)
    .maybeSingle();
  if (error || !data) return { allowed: true };  // let the server decide

  if (data.poster_id === userId) {
    return {
      allowed: false,
      code: 'own',
      reason: 'This is your own request — you cannot send an offer for it.',
    };
  }
  if (data.kind !== 'request') {
    return {
      allowed: false,
      code: 'closed',
      reason: 'This is a worker’s service, not a request — only requests take offers.',
    };
  }
  if (data.status !== 'OPEN') {
    return {
      allowed: false,
      code: 'closed',
      reason: 'This request is no longer open for offers.',
    };
  }

  const { data: mine } = await supabase
    .from('bids')
    .select('id')
    .eq('task_id', taskId)
    .eq('worker_id', userId)
    .maybeSingle();
  if (mine) {
    return {
      allowed: false,
      code: 'duplicate',
      reason: 'You have already sent an offer for this task.',
    };
  }

  return { allowed: true };
}

export type ProfileEdits = {
  displayName?: string;
  skills?: string[];
  locLabel?: string | null;
  locLat?: number | null;
  locLng?: number | null;
  /** Storage path of the profile photo in the task-media bucket, never a URL:
   *  the bucket is private, so display signs a short-lived URL on render. */
  avatarUrl?: string | null;
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
      | 'avatar_url'
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
  if (edits.avatarUrl !== undefined) patch.avatar_url = edits.avatarUrl;
  if (edits.payoutUpi !== undefined) patch.payout_upi = edits.payoutUpi;
  if (edits.onboarded) patch.onboarded_at = new Date().toISOString();

  const rows = unwrap(await supabase.from('profiles').update(patch).eq('id', userId).select());
  const row = rows[0];
  if (!row) throw new Error('Could not save your profile');
  primeProfile(row);
  return row;
}

// ------------------------------------------------- lifecycle (server-side) --

async function rpc<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  // Every function here needs a signed-in caller; asking without one is a
  // guaranteed 401 and a wasted round trip.
  if (!(await myId())) throw new Error('Sign in first');
  const { data, error } = await supabase.rpc(fn as never, args as never);
  if (error) {
    // Postgres puts the shortfall in DETAIL when a wallet cannot cover a job.
    const short = Number(error.details);
    if (error.message === 'Not enough money in your wallet' && short > 0) throw new WalletShortError(short);
    throw new Error(error.message);
  }
  return data as T;
}

/** The poster's wallet does not cover a job; `shortMinor` is exactly what is missing. */
export class WalletShortError extends Error {
  constructor(public shortMinor: number) {
    super('Not enough money in your wallet');
  }
}

/**
 * Poster locks a quote. The price plus the service fee is taken from their
 * wallet in the same step; a wallet that is short throws WalletShortError and
 * nothing is locked.
 */
export const lockBid = (bidId: string, payoutMode: Enums<'payout_mode'> = 'one_time') =>
  rpc<Task>('lock_bid', { p_bid_id: bidId, p_payout_mode: payoutMode });

/** Pay for a job that was locked unpaid (an auto-hire, say) from the wallet. */
export const payTaskFromWallet = (taskId: string) => rpc<Task>('pay_task_from_wallet', { p_task_id: taskId });

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
 * Move completed earnings whose seven days are up out of clearing and into the
 * spendable balance.
 *
 * Nothing called this. The function has existed since migration 023 and is
 * granted to `authenticated` precisely so it need not wait on an operator --
 * but its client wrapper went out with the owner console, so the sweep had no
 * caller anywhere in the product. Earnings reached `clearing_minor`, their
 * clearing period elapsed, and they stayed there: every wallet in the live
 * database is holding a balance of zero against money that has already cleared.
 *
 * It is idempotent (a task is swept at most once, via tasks.cleared_at) and it
 * settles only the caller's own work. It used to sweep everybody, which meant
 * one cheap request from any signed-in user drove a row-locking write across
 * every task in the table; migration 045 split that unscoped sweep off to the
 * nightly pg_cron job and left this half for the app. Call it before showing a
 * balance, never instead of reading one, and let it fail quietly -- a sweep
 * that does not run means a number is briefly stale, which is not worth an
 * error on this screen.
 */
export const settleClearedEarnings = () => rpc<number>('settle_my_cleared_earnings', {});

/**
 * Move money out of the wallet. The debit and the payout row happen in one
 * locked transaction server-side, so a double tap can't withdraw twice.
 */
/**
 * Ask for a withdrawal to one of the worker's saved accounts, then hand it to
 * RazorpayX straight away. The earnings leave the balance at the request; the
 * transfer itself is confirmed later (paid, or failed and refunded). If
 * RazorpayX is not set up, or cannot be reached, the request simply waits --
 * it is never lost -- and is sent by an admin instead.
 */
export async function requestWithdrawal(amountMinor: number, destinationId: string | null, destinationLabel?: string) {
  const row = await rpc<{ id: string }>('request_withdrawal', {
    p_amount_minor: amountMinor,
    p_destination: destinationLabel?.trim() ? destinationLabel.trim() : null,
    p_destination_id: destinationId,
  });
  await supabase.functions.invoke('razorpayx-payouts', { body: { action: 'send', payoutId: row.id } }).catch(() => {});
  return row;
}

/** A withdrawal, as the person who asked for it sees it. */
export type Payout = {
  id: string;
  amount_minor: number;
  status: 'requested' | 'processing' | 'paid' | 'failed' | 'cancelled';
  destination: string | null;
  failure_note: string | null;
  /** The bank's reference for the transfer, written when it is marked paid. */
  reference: string | null;
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
  // Never render a full account number back: it is the one part worth stealing
  // and the last four are enough to tell two accounts apart.
  return `${d.account_name ?? 'Bank account'} ····${tail}`;
}

export async function listPayoutDestinations(): Promise<PayoutDestination[]> {
  const uid = await myId();
  if (!uid) return [];
  const rows = unwrap(
    await supabase
      .from('payout_destinations')
      .select('*')
      .eq('user_id', uid)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: false }),
  );
  return rows as unknown as PayoutDestination[];
}

export async function addPayoutDestination(
  input:
    | { kind: 'upi'; upiId: string; label?: string }
    | { kind: 'bank'; accountName: string; accountNumber: string; ifsc: string; label?: string },
): Promise<PayoutDestination> {
  const uid = await myId();
  if (!uid) throw new Error('Sign in first');
  // One shape, so the column check constraint decides what is valid rather
  // than a TypeScript union that PostgREST cannot narrow.
  const row: TablesInsert<'payout_destinations'> = {
    user_id: uid,
    kind: input.kind,
    label: input.label ?? (input.kind === 'upi' ? 'UPI' : 'Bank'),
    upi_id: input.kind === 'upi' ? input.upiId.trim() : null,
    account_name: input.kind === 'bank' ? input.accountName.trim() : null,
    account_number: input.kind === 'bank' ? input.accountNumber.trim() : null,
    // IFSC is always upper case; accepting lower and storing it breaks the
    // format check for no reason.
    ifsc: input.kind === 'bank' ? input.ifsc.trim().toUpperCase() : null,
  };
  const rows = unwrap(await supabase.from('payout_destinations').insert(row).select());
  return rows[0] as unknown as PayoutDestination;
}

export async function removePayoutDestination(id: string): Promise<void> {
  unwrap(await supabase.from('payout_destinations').delete().eq('id', id).select());
}

export const setDefaultPayoutDestination = (id: string) =>
  rpc<PayoutDestination>('set_default_payout_destination', { p_destination_id: id });

export type PromotableTask = {
  id: string;
  title: string;
  benchmark_minor: number;
  status: string;
  quotes: number;
};

/**
 * The listings this person could pay to promote: their own, still open.
 *
 * The promote screen used to show one hard-coded task — "Vintage 35mm film
 * camera, 12 quotes" — belonging to nobody, with no way to choose a different
 * one.
 */
export async function promotableTasks(): Promise<PromotableTask[]> {
  const uid = await myId();
  if (!uid) return [];
  const rows = unwrap(
    await supabase
      .from('tasks')
      .select('id,title,benchmark_minor,status')
      .eq('poster_id', uid)
      .in('status', ['OPEN'])
      .order('created_at', { ascending: false })
      .limit(30),
  );
  if (rows.length === 0) return [];

  // How much interest each already has, which is the number that decides
  // whether promoting it is worth the money.
  const counts = unwrap(
    await supabase.from('bids').select('task_id').in('task_id', rows.map((r) => r.id)),
  );
  const byTask = new Map<string, number>();
  for (const b of counts) byTask.set(b.task_id, (byTask.get(b.task_id) ?? 0) + 1);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    benchmark_minor: r.benchmark_minor,
    status: r.status,
    quotes: byTask.get(r.id) ?? 0,
  }));
}

/** A poster's own numbers: what they have asked for and what it cost. */
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

/** A worker's own numbers: what they have won and what it paid. */
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

/**
 * This user's own figures, shaped for the role they are asking as.
 *
 * The only statistics in the product were platform-wide and admin-only, so a
 * poster could not see what they had spent and a worker could not see what they
 * had earned. Available to everyone, because these are their own numbers.
 */
export const myStats = (role: 'worker' | 'poster') =>
  rpc<MyStats>('my_stats', { p_role: role });

// The owner console was removed at the owner's request, so its client wrappers
// went with it. admin_mark_payout and admin_resolve_dispute are still in the
// database -- they remain the only mechanism by which a worker gets paid or a
// dispute is settled -- and are driven from outside the app: `npm run payouts`
// and the SQL in docs/RUNNING_THE_BUSINESS.md.
//
// settle_cleared_earnings came back (see settleClearedEarnings above). It was
// never an owner action: it is granted to `authenticated` because it only ever
// moves money that is already owed, and leaving it without a caller meant every
// worker's cleared earnings sat in clearing_minor for good.

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

/**
 * The live ad auction, already ordered. Rank 1 is the winning campaign.
 *
 * The ordering is the server's, not ours: it is bid x estimated action rate,
 * damped by pacing and with out-of-budget campaigns dropped. The client only
 * needs to know the running order, so that is all this returns.
 */
export async function adAuctionRanks(): Promise<Map<string, number>> {
  if (!(await myId())) return new Map();
  const { data, error } = await supabase.rpc('ad_auction');
  if (error) return new Map();
  return new Map(
    (data ?? []).map((r) => {
      const row = r as { task_id: string; rank: number | null };
      return [row.task_id, Number(row.rank ?? 0)];
    }),
  );
}

/** Bill one impression against the campaign's daily budget. Best-effort: a
 *  feed that renders must not fail because delivery could not be logged. */
export async function recordAdImpression(taskId: string): Promise<void> {
  await supabase.rpc('record_ad_impression', { p_task_id: taskId });
}

/** Free, but it feeds the action rate that decides future ranking. */
export async function recordAdClick(taskId: string): Promise<void> {
  await supabase.rpc('record_ad_click', { p_task_id: taskId });
}

// -------------------------------------------------------------- payments ---

export type PaymentLink = { paymentId: string; url: string; amountMinor: number };

/** What a settlement check found: the payment's state, and whether the task it
 *  was raised for is actually funded now. The two are not the same thing. */
export type PaymentCheck = {
  status: 'created' | 'paid' | 'cancelled';
  funded: boolean;
};

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
  /** Top-ups only. Escrow is priced by the server from the locked quote. */
  amountMinor?: number;
  taskId?: string | null;
  returnUrl?: string;
}): Promise<PaymentLink> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    body: { action: 'create-link', ...input },
  });
  if (error) throw await functionError(error, 'Could not start the payment');
  const out = data as {
    paymentId?: string;
    url?: string;
    amountMinor?: number;
    error?: string;
  };
  if (out.error) throw new Error(out.error);
  if (!out.paymentId || !out.url) throw new Error('Could not start the payment');
  // The server's figure, not the one we asked with.
  return {
    paymentId: out.paymentId,
    url: out.url,
    amountMinor: Number(out.amountMinor ?? input.amountMinor ?? 0),
  };
}

/**
 * Send a cancelled task's escrow back to the poster.
 *
 * How much is owed is worked out in Postgres — escrow, less what the worker
 * was already paid out of it, less anything refunded before — so a caller
 * cannot ask for a number. Safe to call on a task that owes nothing: it
 * returns zero rather than failing.
 */
export async function refundEscrow(
  taskId: string,
): Promise<{ refundedMinor: number; reason?: string }> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
    body: { action: 'refund-escrow', taskId },
  });
  if (error) throw await functionError(error, 'Could not start the refund');
  const out = data as { refundedMinor?: number; reason?: string; error?: string };
  if (out.error) throw new Error(out.error);
  return { refundedMinor: Number(out.refundedMinor ?? 0), reason: out.reason };
}

/**
 * Re-check a payment with Razorpay and settle our side of it.
 *
 * Returns the task's funding state as well, because "the card went through"
 * and "the job is funded" are different questions and only the second one
 * lets a worker start. Answering the first and showing the second is how a
 * poster gets told money is held in escrow when it is not.
 */
export async function syncPayment(paymentId: string): Promise<PaymentCheck> {
  const { data, error } = await supabase.functions.invoke('razorpay', {
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

/**
 * A worker's gig offer ("I will create thumbnails") is a task of kind
 * 'service' posted by the worker: the price is where it starts, the time
 * limit is the delivery time.
 */
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

export async function updateListing(id: string, input: ListingInput): Promise<Task> {
  const rows = unwrap(
    await supabase
      .from('tasks')
      .update({
        title: input.title,
        description: input.description,
        benchmark_minor: input.priceMinor,
        time_limit_minutes: input.deliveryDays * 1440,
        category: input.category,
        loc_label: input.locLabel,
        loc_lat: input.locLat,
        loc_lng: input.locLng,
      })
      .eq('id', id)
      .eq('kind', 'service')
      .select(),
  );
  if (!rows[0]) throw new Error('This service can no longer be edited');
  return rows[0];
}

/** Take a listing down. It stops showing to posters. */
export async function removeListing(id: string): Promise<void> {
  unwrap(await supabase.from('tasks').update({ status: 'CANCELLED' }).eq('id', id).eq('kind', 'service').select('id'));
}

// -------------------------------------------------------- proof of work -----

export type Proof = Omit<Tables<'task_proofs'>, 'files'> & { files: import('../lib/media').ProofFile[] };

/** What the worker says they did, with photos or documents. Required before "done". */
export async function submitProof(input: {
  taskId: string;
  workerId: string;
  summary: string;
  files: import('../lib/media').ProofFile[];
}): Promise<Proof> {
  const rows = unwrap(
    await supabase
      .from('task_proofs')
      .insert({ task_id: input.taskId, worker_id: input.workerId, summary: input.summary.trim(), files: input.files })
      .select(),
  );
  return rows[0] as Proof;
}

/** The latest proof for a task, for the worker who sent it or the poster reviewing it. */
export async function getProof(taskId: string): Promise<Proof | null> {
  const { data, error } = await supabase
    .from('task_proofs')
    .select('*')
    .eq('task_id', taskId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as Proof | null) ?? null;
}
