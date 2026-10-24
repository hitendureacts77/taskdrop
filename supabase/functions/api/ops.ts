/**
 * The operations the app may ask for, by name, and how one is run.
 *
 * The app sends `{ op: "placeBid", args: { ... } }` and gets back the result.
 * Which tables, columns, checks and calculations sit behind each name lives
 * here on the server, not in the bundle a customer downloads -- the same split
 * as a Spring Boot controller and the browser that calls it.
 *
 * Every operation runs as the signed-in caller (their own token), so row level
 * security and the SQL functions' own checks apply exactly as before.
 */

import { refusalFor } from "../_shared/controls.ts";
import { type Ctx, GENERIC, OpError, type Op } from "./core.ts";
import { MEDIA_OPS } from "./media.ts";
import { READ_OPS } from "./reads.ts";
import { WRITE_OPS } from "./writes.ts";

export { type Ctx, type Db, OpError, safeMessage } from "./core.ts";

export const OPS: Record<string, Op> = { ...READ_OPS, ...WRITE_OPS, ...MEDIA_OPS };

/**
 * Requests per person per minute, by kind. Generous for anyone using the app
 * by hand -- a busy screen makes a dozen reads -- and far below what a script
 * scraping the marketplace or hammering a money operation would need.
 */
export const RATE_LIMITS = { read: 300, write: 60, upload: 20 } as const;
export type RateBucket = keyof typeof RATE_LIMITS;

/**
 * People the limiter refused a moment ago, remembered by this instance.
 *
 * A read normally runs while the limiter's own round trip is still out (a
 * refused read changes nothing and its answer is dropped). Someone who is
 * already over the limit loses that overlap, so a refused call does no work.
 */
export class RecentlyLimited {
  private until = new Map<string, number>();

  constructor(private windowMs = 60_000, private now: () => number = Date.now) {}

  mark(userId: string): void {
    if (this.until.size >= 500) this.prune();
    this.until.set(userId, this.now() + this.windowMs);
  }

  has(userId: string): boolean {
    const t = this.until.get(userId);
    if (t === undefined) return false;
    if (t <= this.now()) {
      this.until.delete(userId);
      return false;
    }
    return true;
  }

  private prune(): void {
    for (const [id, t] of this.until) if (t <= this.now()) this.until.delete(id);
    // Still full of live entries: forget them rather than grow without bound.
    if (this.until.size >= 500) this.until.clear();
  }
}

/** Which limit an operation counts against. Unknown names count as reads (they are refused anyway). */
export function rateBucket(name: unknown): RateBucket {
  if (name === "createUpload" || name === "attachMedia") return "upload";
  if (typeof name === "string" && Object.prototype.hasOwnProperty.call(WRITE_OPS, name)) return "write";
  if (name === "removeMedia") return "write";
  return "read";
}

export type Reply =
  | { ok: true; data: unknown }
  | { ok: false; error: { message: string; code: string; details: string | null } };

/** Most calls one `batch` request may carry. */
export const MAX_BATCH = 20;

export type BatchCall = { op: string; args: Record<string, unknown> };

/** The calls inside a `batch` request, or null when the arguments are not a usable list of them. */
export function batchCalls(args: unknown): BatchCall[] | null {
  const raw = args && typeof args === "object" ? (args as { calls?: unknown }).calls : undefined;
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_BATCH) return null;
  const calls: BatchCall[] = [];
  for (const c of raw) {
    if (!c || typeof c !== "object" || typeof (c as { op?: unknown }).op !== "string") return null;
    const a = (c as { args?: unknown }).args;
    calls.push({ op: (c as { op: string }).op, args: a && typeof a === "object" && !Array.isArray(a) ? (a as Record<string, unknown>) : {} });
  }
  return calls;
}

/** How many requests a call counts against the limiter: one, or one per call inside a batch. */
export function rateCost(name: unknown, args: unknown): number {
  if (name !== "batch") return 1;
  const raw = args && typeof args === "object" ? (args as { calls?: unknown }).calls : undefined;
  return Array.isArray(raw) ? Math.max(1, Math.min(raw.length, MAX_BATCH)) : 1;
}

/**
 * Several reads in one request: one sign-in check and one round trip for what
 * the app would otherwise ask for one call at a time. Each call runs exactly as
 * it would alone (the admin switches, its own checks, its own answer); a failed
 * call does not spoil the others. Only reads may travel this way, so a money or
 * upload operation can never hide in a batch.
 */
export async function runBatch(args: unknown, ctx: Ctx, onUnexpected: (e: unknown) => void = () => {}): Promise<Reply> {
  const calls = batchCalls(args);
  if (!calls) return { ok: false, error: { message: "Invalid calls", code: "BAD_ARGS", details: null } };
  const replies = await Promise.all(
    calls.map((c): Promise<Reply> =>
      rateBucket(c.op) === "read"
        ? runOp(c.op, c.args, ctx, onUnexpected)
        : Promise.resolve({ ok: false, error: { message: "That cannot be sent in a batch", code: "NOT_BATCHABLE", details: null } })
    ),
  );
  return { ok: true, data: replies };
}

/** Run one operation. Anything that is not an `OpError` is hidden behind a generic message. */
export async function runOp(name: unknown, args: unknown, ctx: Ctx, onUnexpected: (e: unknown) => void = () => {}): Promise<Reply> {
  const op = typeof name === "string" && Object.prototype.hasOwnProperty.call(OPS, name) ? OPS[name] : undefined;
  if (!op) return { ok: false, error: { message: "Unknown request", code: "UNKNOWN_OP", details: null } };
  const a = args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : {};
  // The admin panel's switches (maintenance, minimum version, feature off),
  // decided here on the server whatever the app shows.
  const off = refusalFor(name, ctx.controls ?? null, a, { phoneVerified: ctx.phoneVerified });
  if (off) return { ok: false, error: off };
  try {
    return { ok: true, data: (await op(ctx, a)) ?? null };
  } catch (e) {
    if (e instanceof OpError) return { ok: false, error: { message: e.message, code: e.code, details: e.details } };
    onUnexpected(e);
    return { ok: false, error: { message: GENERIC, code: "INTERNAL", details: null } };
  }
}
