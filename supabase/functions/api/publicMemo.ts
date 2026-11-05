/**
 * The server's shared answers (plan task 3.5b, layer D): the closed list of
 * reads whose answer is the same for everyone who asks, and how long one
 * answer may be handed out again inside one server copy.
 *
 * Each op here was checked to return the same bytes for any caller: its SQL is
 * `security definer` with no `auth.uid()` (trending_categories, top_earners,
 * platform_highlights, ad_auction), or it reads `settings` rows every signed-in
 * person may read (promotionTiers). Anything whose answer depends on who is
 * asking (row rules, blocked people, the caller's own rows) must never be here:
 * `contract.test.ts` fails if a money, task, offer, chat, contact or admin op,
 * or anything in the app's `NEVER_REUSE`, is added.
 *
 * The memo (`PublicMemo`, below) keeps one answer per op and arguments for the
 * op's time, and lets callers asking for the same thing at the same moment share
 * one database call. It is used only while the admin switch "public cache: memo"
 * (`public_cache_memo`, migration 149) is on; off, every call runs exactly as
 * before. It is server-side only: the `api` answers stay "never store".
 *
 * No Deno imports on purpose, so this can be tested from Node.
 */

/** Shortest and longest time a shared answer may be kept. */
export const MEMO_MIN_TTL_MS = 15_000;
export const MEMO_MAX_TTL_MS = 60_000;

/** Most answers one server copy keeps at once. */
export const MEMO_MAX_ENTRIES = 500;

/** Op name -> how long its answer may be shared, in milliseconds. */
export const PUBLIC_MEMO_OPS = Object.freeze({
  trendingCategories: 60_000,
  topEarners: 60_000,
  platformHighlights: 30_000,
  promotionTiers: 60_000,
  adAuctionRanks: 15_000,
} as const satisfies Record<string, number>);

export type PublicMemoOp = keyof typeof PUBLIC_MEMO_OPS;

/** True when this op's answer may be shared between callers. */
export function isPublicMemoOp(name: unknown): name is PublicMemoOp {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(PUBLIC_MEMO_OPS, name);
}

/** How long this op's answer may be shared; null when it may not be shared at all. */
export function memoTtlMs(name: unknown): number | null {
  return isPublicMemoOp(name) ? PUBLIC_MEMO_OPS[name] : null;
}

/** JSON with object keys sorted at every depth, so the same arguments always give the same text. */
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? "null" : stable(x))).join(",")}]`;
  if (v && typeof v === "object") {
    const entries = Object.entries(v as Record<string, unknown>).filter(([, x]) => x !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`).join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

/**
 * The memo key: `op:sorted args`. Built from the op and its arguments only, never
 * from who is asking, so it is only ever used for ops on the shared list.
 */
export function memoKey(op: PublicMemoOp, args: Record<string, unknown> | null | undefined): string {
  return `${op}:${stable(args ?? {})}`;
}

// ------------------------------------------------------------ the memo ----

/** Answers that came from an error path (a fallback such as `{}`): handed out as they are, never kept. */
const NOT_KEPT = new WeakSet<object>();

/** Mark an error-path answer so the memo never keeps or shares it. Returns the same value, unchanged. */
export function noKeep<T extends object>(value: T): T {
  NOT_KEPT.add(value);
  return value;
}

/** True when `value` may be kept: a real answer, not nothing and not an error-path fallback. */
function keepable(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  return !(typeof value === "object" && NOT_KEPT.has(value));
}

/** The answer as JSON text, or null when it cannot be written as JSON (then it is not kept). */
function asText(value: unknown): string | null {
  try {
    const text = JSON.stringify(value);
    return typeof text === "string" ? text : null;
  } catch {
    return null;
  }
}

/** Per-op counts since the last report. Op names and numbers only, never arguments or who asked. */
export type MemoCounts = { hit: number; miss: number; coalesced: number; notKept: number };

export type MemoOptions = {
  maxEntries?: number;
  now?: () => number;
  /** Called with each op's counts at most once per `reportEveryMs`. Must not throw (a throw is ignored). */
  report?: (op: PublicMemoOp, counts: MemoCounts) => void;
  reportEveryMs?: number;
};

/** How long one op's answer is kept, always within 15 to 60 s. */
function ttlOf(op: PublicMemoOp): number {
  return Math.min(MEMO_MAX_TTL_MS, Math.max(MEMO_MIN_TTL_MS, PUBLIC_MEMO_OPS[op]));
}

/**
 * One server copy's shared answers, with single-flight.
 *
 *   - Keyed by `memoKey(op, args)` only: who is asking is never part of the key or the value.
 *   - Kept as JSON text and handed out as a fresh copy, so every caller gets the same bytes
 *     and no caller can change what the next one sees.
 *   - Only a successful, non-empty answer is kept. A thrown error, null, or a value marked
 *     with `noKeep` (an error fallback) is never kept.
 *   - Callers who arrive while the same answer is being fetched wait for that one call. If it
 *     fails or gives nothing worth keeping, each of them asks for itself, as without the memo,
 *     so one failed call never reaches anyone but its own caller and is gone straight away.
 *   - At most `maxEntries` answers: expired ones go first, then the oldest.
 */
export class PublicMemo {
  private entries = new Map<string, { until: number; text: string }>();
  private inflight = new Map<string, Promise<string | null>>();
  private counts = new Map<PublicMemoOp, MemoCounts>();
  private readonly maxEntries: number;
  private readonly now: () => number;
  private readonly report: ((op: PublicMemoOp, counts: MemoCounts) => void) | null;
  private readonly reportEveryMs: number;
  private lastReport: number;

  constructor(opts: MemoOptions = {}) {
    this.maxEntries = Math.max(1, opts.maxEntries ?? MEMO_MAX_ENTRIES);
    this.now = opts.now ?? Date.now;
    this.report = opts.report ?? null;
    this.reportEveryMs = opts.reportEveryMs ?? 60_000;
    this.lastReport = this.now();
  }

  /** How many answers are kept right now (for tests). */
  get size(): number {
    return this.entries.size;
  }

  async run<T>(op: PublicMemoOp, args: Record<string, unknown> | null | undefined, load: () => Promise<T>): Promise<T> {
    // Belt and braces: an op off the list is never kept, whoever calls this.
    if (!isPublicMemoOp(op)) return load();
    const key = memoKey(op, args);
    const hit = this.entries.get(key);
    if (hit) {
      if (hit.until > this.now()) {
        this.count(op, "hit");
        return JSON.parse(hit.text) as T;
      }
      this.entries.delete(key);
    }
    const pending = this.inflight.get(key);
    if (pending) {
      this.count(op, "coalesced");
      const text = await pending;
      if (text !== null) return JSON.parse(text) as T;
      return load();
    }
    this.count(op, "miss");
    let settle!: (text: string | null) => void;
    this.inflight.set(key, new Promise<string | null>((resolve) => (settle = resolve)));
    let text: string | null = null;
    try {
      const value = await load();
      text = keepable(value) ? asText(value) : null;
      if (text !== null) this.store(key, text, ttlOf(op));
      else this.count(op, "notKept");
      return value;
    } catch (e) {
      this.count(op, "notKept");
      throw e;
    } finally {
      this.inflight.delete(key);
      settle(text);
    }
  }

  private store(key: string, text: string, ttl: number): void {
    if (!this.entries.has(key) && this.entries.size >= this.maxEntries) {
      const now = this.now();
      for (const [k, e] of this.entries) if (e.until <= now) this.entries.delete(k);
      // Still full of live answers: drop the oldest until there is room.
      while (this.entries.size >= this.maxEntries) {
        const oldest = this.entries.keys().next();
        if (oldest.done) break;
        this.entries.delete(oldest.value);
      }
    }
    this.entries.delete(key); // re-inserted at the end, so the Map's order stays oldest first
    this.entries.set(key, { until: this.now() + ttl, text });
  }

  private count(op: PublicMemoOp, what: keyof MemoCounts): void {
    const c = this.counts.get(op) ?? { hit: 0, miss: 0, coalesced: 0, notKept: 0 };
    c[what]++;
    this.counts.set(op, c);
    if (!this.report || this.now() - this.lastReport < this.reportEveryMs) return;
    this.lastReport = this.now();
    const all = [...this.counts];
    this.counts.clear();
    for (const [name, counts] of all) {
      try {
        this.report(name, counts);
      } catch {
        /* a log line must never fail a request */
      }
    }
  }
}

/** What `sharedAnswer` needs from the op's context. */
export type MemoCtx = { memo?: PublicMemo | null; controls?: { public_cache_memo?: boolean } | null };

/**
 * Run `load` through the memo when, and only when, the op is on the shared list, the context
 * carries a memo, and the admin switch `public_cache_memo` is on (unreadable switches count as
 * off). Otherwise this is `load()` itself, exactly as before.
 */
export function sharedAnswer<T>(name: unknown, args: Record<string, unknown>, ctx: MemoCtx, load: () => Promise<T>): Promise<T> {
  if (!ctx.memo || ctx.controls?.public_cache_memo !== true || !isPublicMemoOp(name)) return load();
  return ctx.memo.run(name, args, load);
}
