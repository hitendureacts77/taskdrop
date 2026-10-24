/**
 * Several reads asked for at the same moment travel as one request.
 *
 * A screen that opens asks for a dozen things at once (the profile, the counts,
 * three lists). Each used to be its own round trip to the server, and each paid
 * for its own sign-in check. Calls for the reads below that arrive within a few
 * milliseconds of each other now go out together as one `batch` request, and
 * every caller still gets its own answer or its own error.
 *
 * No React Native imports on purpose, so this can be tested from Node.
 */

/**
 * The reads that may travel in a batch. The server accepts only reads in one
 * (`batch` in supabase/functions/api/ops.ts), and a test keeps this list inside
 * the server's own read operations.
 */
export const BATCHABLE_OPS: ReadonlySet<string> = new Set([
  'listOpenTasks', 'listMyTasks', 'listMyBids', 'listMyAssignments', 'listBidsForTask', 'countBidsByTask',
  'searchTasks', 'attachPosters', 'getTask', 'getTaskDetail', 'getPosterStats', 'getMyBid', 'canQuoteOn',
  'promotableTasks', 'recommendedTasks', 'remoteTasks', 'tasksNear', 'urgentTasks', 'listSavedTaskIds',
  'listSavedTasks', 'getProfile', 'isAdmin', 'listReviewsAbout', 'publicProfileStats', 'ageStatus', 'getWallet',
  'getEscrowHeld', 'listWalletActivity', 'listPayouts', 'listPayoutDestinations', 'listPromotions',
  'adAuctionRanks', 'platformFees', 'myStats', 'countNeedsAttention', 'listThreads', 'listMessages',
  'listNotifications', 'countUnreadNotifications', 'countUnreadFor', 'countMyReferrals', 'signMedia',
]);

export type Args = Record<string, unknown>;
export type Reply = { ok: true; data: unknown } | { ok: false; error: { message: string; code?: string | null; details?: string | null } };

type Pending = { op: string; args: Args; resolve: (v: never) => void; reject: (e: unknown) => void };

export type BatcherOptions = {
  /** Send one batch request; resolves with one reply per call, in order. Rejects when the request itself fails. */
  send: (calls: { op: string; args: Args }[]) => Promise<Reply[]>;
  /** Ask for one thing on its own (the way every call used to go). */
  single: (op: string, args: Args) => Promise<unknown>;
  /** Turn a refusal inside a batch into the error a lone call would have thrown. */
  refuse: (error: { message: string; code?: string | null; details?: string | null }, op: string) => unknown;
  /** Codes of a failed batch request that mean "this server cannot batch": the calls are asked one by one instead. */
  unsupported?: ReadonlySet<string>;
  batchable?: ReadonlySet<string>;
  /** How long a call waits for company. */
  windowMs?: number;
  max?: number;
};

const codeOf = (e: unknown): string | null => (e && typeof e === 'object' && typeof (e as { code?: unknown }).code === 'string' ? (e as { code: string }).code : null);

export class Batcher {
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private canBatch = true;
  private readonly batchable: ReadonlySet<string>;
  private readonly windowMs: number;
  private readonly max: number;
  private readonly unsupported: ReadonlySet<string>;
  private readonly o: BatcherOptions;

  constructor(o: BatcherOptions) {
    this.o = o;
    this.batchable = o.batchable ?? BATCHABLE_OPS;
    this.windowMs = o.windowMs ?? 10;
    this.max = o.max ?? 20;
    // An older server answers a batch with "Unknown request"; one call per request still works there.
    this.unsupported = o.unsupported ?? new Set(['UNKNOWN_OP', 'BAD_ARGS']);
  }

  call<T>(op: string, args: Args = {}): Promise<T> {
    if (!this.canBatch || !this.batchable.has(op)) return this.o.single(op, args) as Promise<T>;
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ op, args, resolve: resolve as (v: never) => void, reject });
      if (this.queue.length >= this.max) this.flush();
      else if (!this.timer) this.timer = setTimeout(() => this.flush(), this.windowMs);
    });
  }

  private flush(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.queue.splice(0);
    if (batch.length === 0) return;
    // Nobody to travel with: exactly the request that would have gone anyway.
    if (batch.length === 1) return this.alone(batch[0]!);

    this.o.send(batch.map(({ op, args }) => ({ op, args }))).then(
      (replies) => {
        if (!Array.isArray(replies) || replies.length !== batch.length) {
          // A reply we cannot line up with its calls: ask again one by one rather than guess.
          this.canBatch = false;
          for (const p of batch) this.alone(p);
          return;
        }
        batch.forEach((p, i) => {
          const r = replies[i]!;
          if (r && r.ok === true) p.resolve(r.data as never);
          else if (r && r.ok === false && r.error) p.reject(this.o.refuse(r.error, p.op));
          else this.alone(p);
        });
      },
      (e) => {
        const code = codeOf(e);
        if (code && this.unsupported.has(code)) {
          this.canBatch = false;
          for (const p of batch) this.alone(p);
        } else {
          // The request itself failed (offline, signed out, held back): every call would have failed the same way.
          for (const p of batch) p.reject(e);
        }
      },
    );
  }

  private alone(p: Pending): void {
    this.o.single(p.op, p.args).then(p.resolve as (v: unknown) => void, p.reject);
  }
}
